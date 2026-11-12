import type { Client } from '@prisma/client';
import {
  ClientAuthenticator,
  ClientAuthError,
  type ClientAuthInput,
} from './client-authenticator.js';
import { ClientCertificateResolverRegistry } from './client-certificate-resolver.js';
import { OAuthTokenError } from '../auth/oauth-token-error.js';
import type { PresentedClientCertificate } from '../mtls/client-certificate.source.js';

const realm = { id: 'realm-1' };

const confidential = {
  id: 'c-1',
  realmId: realm.id,
  clientId: 'backend',
  clientType: 'CONFIDENTIAL',
  clientSecret: 'stored-hash',
  enabled: true,
} as Client;

const publicClient = {
  id: 'c-2',
  realmId: realm.id,
  clientId: 'spa',
  clientType: 'PUBLIC',
  clientSecret: null,
  enabled: true,
} as Client;

function basic(id: string, secret: string): string {
  return `Basic ${Buffer.from(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`).toString('base64')}`;
}

describe('ClientAuthenticator', () => {
  let clients: Map<string, Client>;
  let verify: jest.Mock;
  let lookup: jest.Mock;
  let authenticator: ClientAuthenticator;

  beforeEach(() => {
    clients = new Map([
      [confidential.clientId, confidential],
      [publicClient.clientId, publicClient],
    ]);
    lookup = jest.fn(
      async (_realmId: string, clientId: string) =>
        clients.get(clientId) ?? null,
    );
    verify = jest.fn(
      async (_client: Client, presented: string) => presented === 'right',
    );
    authenticator = new ClientAuthenticator(
      { client: lookup } as never,
      { verify } as never,
      new ClientCertificateResolverRegistry(),
    );
  });

  const run = (input: Partial<ClientAuthInput>) =>
    authenticator.authenticate({ realm, body: {}, ...input });

  async function failure(
    input: Partial<ClientAuthInput>,
  ): Promise<ClientAuthError> {
    try {
      await run(input);
    } catch (err) {
      expect(err).toBeInstanceOf(ClientAuthError);
      expect(err).toBeInstanceOf(OAuthTokenError);
      return err as ClientAuthError;
    }
    throw new Error('expected authentication to fail');
  }

  describe('client_secret_basic', () => {
    it('authenticates a confidential client', async () => {
      const result = await run({ authorization: basic('backend', 'right') });
      expect(result).toMatchObject({
        clientId: 'backend',
        method: 'client_secret_basic',
        certificate: null,
      });
      expect(verify).toHaveBeenCalledWith(confidential, 'right');
    });

    it('accepts a body client_id equal to the Basic one', async () => {
      const result = await run({
        authorization: basic('backend', 'right'),
        body: { client_id: 'backend' },
      });
      expect(result.method).toBe('client_secret_basic');
    });

    it('decodes form-encoded credentials', async () => {
      clients.set('a b', { ...confidential, clientId: 'a b' });
      const header = `Basic ${Buffer.from('a+b:right').toString('base64')}`;
      expect((await run({ authorization: header })).clientId).toBe('a b');
    });

    it('rejects a wrong secret as 401 invalid_client', async () => {
      const err = await failure({ authorization: basic('backend', 'wrong') });
      expect(err.reason).toBe('invalid_secret');
      expect(err.code).toBe('invalid_client');
      expect(err.httpStatus).toBe(401);
      expect(err.description).toBe('Invalid client credentials');
    });

    it('rejects a malformed header as 401 invalid_client', async () => {
      const err = await failure({
        authorization: `Basic ${Buffer.from('no-colon').toString('base64')}`,
      });
      expect(err.reason).toBe('malformed_basic');
      expect(err.httpStatus).toBe(401);
    });

    it('ignores a non-Basic Authorization header', async () => {
      const result = await run({
        authorization: 'Bearer abc',
        body: { client_id: 'backend', client_secret: 'right' },
      });
      expect(result.method).toBe('client_secret_post');
    });
  });

  describe('client_secret_post', () => {
    it('authenticates a confidential client', async () => {
      const result = await run({
        body: { client_id: 'backend', client_secret: 'right' },
      });
      expect(result).toMatchObject({
        clientId: 'backend',
        method: 'client_secret_post',
      });
    });

    it('rejects a missing secret', async () => {
      const err = await failure({ body: { client_id: 'backend' } });
      expect(err.reason).toBe('missing_secret');
      expect(err.description).toBe('client_secret is required');
      expect(verify).not.toHaveBeenCalled();
    });

    it('rejects an empty secret without checking it', async () => {
      expect(
        (await failure({ body: { client_id: 'backend', client_secret: '' } }))
          .reason,
      ).toBe('missing_secret');
      expect(verify).not.toHaveBeenCalled();
    });

    it('rejects a confidential client that has no stored secret', async () => {
      clients.set('backend', { ...confidential, clientSecret: null });
      const err = await failure({
        body: { client_id: 'backend', client_secret: 'right' },
      });
      expect(err.reason).toBe('no_secret_configured');
    });
  });

  describe('none', () => {
    it('authenticates a public client by client_id alone', async () => {
      const result = await run({ body: { client_id: 'spa' } });
      expect(result).toMatchObject({ clientId: 'spa', method: 'none' });
      expect(verify).not.toHaveBeenCalled();
    });

    it('ignores a secret a public client sends, as before', async () => {
      expect(
        (await run({ body: { client_id: 'spa', client_secret: 'whatever' } }))
          .method,
      ).toBe('none');
      expect(
        (await run({ authorization: basic('spa', 'whatever') })).method,
      ).toBe('none');
      expect(verify).not.toHaveBeenCalled();
    });
  });

  describe('one method per request', () => {
    it('rejects Basic together with client_secret as 400 invalid_request', async () => {
      const err = await failure({
        authorization: basic('backend', 'right'),
        body: { client_secret: 'right' },
      });
      expect(err.reason).toBe('multiple_methods');
      expect(err.code).toBe('invalid_request');
      expect(err.httpStatus).toBe(400);
      expect(lookup).not.toHaveBeenCalled();
    });

    it('rejects Basic together with an empty client_secret', async () => {
      const err = await failure({
        authorization: basic('backend', 'right'),
        body: { client_secret: '' },
      });
      expect(err.reason).toBe('multiple_methods');
    });

    it('rejects a body client_id that differs from Basic', async () => {
      const err = await failure({
        authorization: basic('backend', 'right'),
        body: { client_id: 'spa' },
      });
      expect(err.reason).toBe('client_id_mismatch');
      expect(err.code).toBe('invalid_request');
      expect(err.description).toBe(
        'client_id does not match the HTTP Basic credentials',
      );
    });

    it('does not count a presented certificate as a second method', async () => {
      const certificate = { x5tS256: 'abc' } as PresentedClientCertificate;
      const result = await run({
        authorization: basic('backend', 'right'),
        clientCert: certificate,
      });
      expect(result.method).toBe('client_secret_basic');
      expect(result.certificate).toBe(certificate);
    });
  });

  describe('client lookup', () => {
    it('requires a client_id', async () => {
      const err = await failure({ body: {} });
      expect(err.reason).toBe('missing_client_id');
      expect(err.description).toBe('client_id is required');
      expect(err.httpStatus).toBe(401);
    });

    it('treats a non-string client_id as missing', async () => {
      expect((await failure({ body: { client_id: ['backend'] } })).reason).toBe(
        'missing_client_id',
      );
    });

    it('rejects an unknown client', async () => {
      const err = await failure({
        body: { client_id: 'nobody', client_secret: 'right' },
      });
      expect(err.reason).toBe('unknown_client');
      expect(err.description).toBe('Invalid client');
    });

    it('rejects a disabled client even with the right secret', async () => {
      clients.set('backend', { ...confidential, enabled: false });
      const err = await failure({
        body: { client_id: 'backend', client_secret: 'right' },
      });
      expect(err.reason).toBe('unknown_client');
      expect(err.code).toBe('invalid_client');
      expect(verify).not.toHaveBeenCalled();
    });

    it('looks the client up in the given realm', async () => {
      await run({ body: { client_id: 'spa' } });
      expect(lookup).toHaveBeenCalledWith('realm-1', 'spa');
    });
  });

  describe('legacy parity hooks', () => {
    it('runs beforeCredentialCheck after lookup and before the secret check', async () => {
      const check = jest.fn(() => {
        throw new OAuthTokenError(
          'unauthorized_client',
          'Grant type not allowed',
        );
      });
      await expect(
        run({
          body: { client_id: 'backend', client_secret: 'wrong' },
          beforeCredentialCheck: check,
        }),
      ).rejects.toMatchObject({ code: 'unauthorized_client' });
      expect(check).toHaveBeenCalledWith(confidential);
      expect(verify).not.toHaveBeenCalled();
    });

    it('skips the credential check for a server-side client', async () => {
      const result = await run({
        body: { client_id: 'backend' },
        skipCredentialCheck: true,
      });
      expect(result.clientId).toBe('backend');
      expect(verify).not.toHaveBeenCalled();
    });

    it('still rejects an unknown client when skipping the credential check', async () => {
      expect(
        (
          await failure({
            body: { client_id: 'nobody' },
            skipCredentialCheck: true,
          })
        ).reason,
      ).toBe('unknown_client');
    });
  });

  describe('readCredentials', () => {
    it('reports what was presented without a lookup', () => {
      expect(
        authenticator.readCredentials({
          body: {},
          authorization: basic('backend', 's'),
        }),
      ).toEqual({
        clientId: 'backend',
        secret: { method: 'client_secret_basic', value: 's' },
      });
      expect(
        authenticator.readCredentials({ body: { client_id: 'spa' } }),
      ).toEqual({
        clientId: 'spa',
        secret: undefined,
      });
      expect(lookup).not.toHaveBeenCalled();
    });
  });

  it('has no certificate resolvers yet', () => {
    expect(authenticator.certificateResolvers.resolvers()).toHaveLength(0);
  });
});

describe('ClientCertificateResolverRegistry', () => {
  it('refuses a second resolver with the same name', () => {
    const registry = new ClientCertificateResolverRegistry();
    const resolver = { name: 'client-table', resolve: async () => null };
    registry.register(resolver);
    expect(() => registry.register(resolver)).toThrow(/already registered/);
    expect(registry.resolvers()).toEqual([resolver]);
  });
});
