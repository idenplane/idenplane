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
      { enabled: false },
      { retryAfter: async () => null, recordFailure: async () => {} } as never,
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
        assertion: false,
      });
      expect(
        authenticator.readCredentials({ body: { client_id: 'spa' } }),
      ).toEqual({
        clientId: 'spa',
        secret: undefined,
        assertion: false,
      });
      expect(
        authenticator.readCredentials({
          body: { client_id: 'spa', client_assertion_type: 'x' },
        }).assertion,
      ).toBe(true);
      expect(lookup).not.toHaveBeenCalled();
    });
  });

  it('has no certificate resolvers on its own', () => {
    expect(authenticator.certificateResolvers.resolvers()).toHaveLength(0);
  });

  describe('a registered token_endpoint_auth_method', () => {
    it('accepts only client_secret_basic when that is registered', async () => {
      clients.set('backend', {
        ...confidential,
        tokenEndpointAuthMethod: 'client_secret_basic',
      });
      expect(
        (await run({ authorization: basic('backend', 'right') })).method,
      ).toBe('client_secret_basic');
      const err = await failure({
        body: { client_id: 'backend', client_secret: 'right' },
      });
      expect(err.reason).toBe('wrong_method');
      expect(err.code).toBe('invalid_client');
      expect(verify).toHaveBeenCalledTimes(1);
    });

    it('accepts only client_secret_post when that is registered', async () => {
      clients.set('backend', {
        ...confidential,
        tokenEndpointAuthMethod: 'client_secret_post',
      });
      expect(
        (await failure({ authorization: basic('backend', 'right') })).reason,
      ).toBe('wrong_method');
    });

    it('fails closed when the method contradicts the client type', async () => {
      clients.set('backend', {
        ...confidential,
        tokenEndpointAuthMethod: 'none',
      });
      expect((await failure({ body: { client_id: 'backend' } })).reason).toBe(
        'unsupported_method',
      );
      clients.set('spa', {
        ...publicClient,
        tokenEndpointAuthMethod: 'client_secret_post',
      });
      expect((await failure({ body: { client_id: 'spa' } })).reason).toBe(
        'unsupported_method',
      );
    });
  });
});

describe('ClientAuthenticator certificate methods', () => {
  const cert = (x5tS256 = 'thumb') =>
    ({ x5tS256, source: 'tls' }) as unknown as PresentedClientCertificate;
  const tlsClient = {
    ...confidential,
    id: 'c-3',
    clientId: 'device',
    clientSecret: null,
    tokenEndpointAuthMethod: 'tls_client_auth',
    tlsClientCertificateBoundAccessTokens: true,
  } as Client;
  const selfSignedClient = {
    ...tlsClient,
    id: 'c-4',
    clientId: 'pinned',
    tokenEndpointAuthMethod: 'self_signed_tls_client_auth',
    tlsClientCertificateBoundAccessTokens: false,
  } as Client;
  const mtlsRealm = { id: 'realm-1', mtlsClientAuthEnabled: true };

  let resolve: jest.Mock;
  let retryAfter: jest.Mock;
  let recordFailure: jest.Mock;
  let verify: jest.Mock;
  let enabled: boolean;
  let registry: ClientCertificateResolverRegistry;
  let authenticator: ClientAuthenticator;
  const clients = new Map<string, Client>([
    [tlsClient.clientId, tlsClient],
    [selfSignedClient.clientId, selfSignedClient],
    [confidential.clientId, confidential],
  ]);

  beforeEach(() => {
    enabled = true;
    resolve = jest.fn(async ({ client, method }) => ({
      clientId: client.clientId,
      method,
      bindToCertificate: client.tlsClientCertificateBoundAccessTokens,
    }));
    retryAfter = jest.fn(async () => null);
    recordFailure = jest.fn(async () => {});
    verify = jest.fn(async (_c: Client, s: string) => s === 'right');
    registry = new ClientCertificateResolverRegistry();
    registry.register({ name: 'test', resolve });
    authenticator = new ClientAuthenticator(
      {
        client: async (_realm: string, id: string) => clients.get(id) ?? null,
      } as never,
      { verify } as never,
      registry,
      {
        get enabled() {
          return enabled;
        },
      },
      { retryAfter, recordFailure } as never,
    );
  });

  const run = (input: Partial<ClientAuthInput>) =>
    authenticator.authenticate({ realm: mtlsRealm, body: {}, ...input });

  async function failure(
    input: Partial<ClientAuthInput>,
  ): Promise<ClientAuthError> {
    try {
      await run(input);
    } catch (err) {
      expect(err).toBeInstanceOf(ClientAuthError);
      return err as ClientAuthError;
    }
    throw new Error('expected authentication to fail');
  }

  it('authenticates tls_client_auth through the resolvers', async () => {
    const certificate = cert();
    const result = await run({
      body: { client_id: 'device' },
      clientCert: certificate,
    });
    expect(result).toMatchObject({
      clientId: 'device',
      method: 'tls_client_auth',
      x5tS256: 'thumb',
      bindToCertificate: true,
      certificate,
    });
    expect(resolve).toHaveBeenCalledWith({
      realm: mtlsRealm,
      client: tlsClient,
      method: 'tls_client_auth',
      certificate,
    });
    expect(recordFailure).not.toHaveBeenCalled();
  });

  it('authenticates self_signed_tls_client_auth', async () => {
    const result = await run({
      body: { client_id: 'pinned' },
      clientCert: cert(),
    });
    expect(result).toMatchObject({
      method: 'self_signed_tls_client_auth',
      x5tS256: 'thumb',
      bindToCertificate: false,
    });
  });

  it('is invalid_client while MTLS_ENABLED is off, certificate or not', async () => {
    enabled = false;
    const err = await failure({
      body: { client_id: 'device' },
      clientCert: cert(),
    });
    expect(err.reason).toBe('unsupported_method');
    expect(err.httpStatus).toBe(401);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('is invalid_client while the realm flag is off or missing', async () => {
    for (const realm of [
      { id: 'realm-1', mtlsClientAuthEnabled: false },
      { id: 'realm-1' },
    ]) {
      const err = await failure({
        realm,
        body: { client_id: 'device' },
        clientCert: cert(),
      });
      expect(err.reason).toBe('unsupported_method');
    }
    expect(resolve).not.toHaveBeenCalled();
  });

  it('is invalid_client without a certificate', async () => {
    const err = await failure({ body: { client_id: 'device' } });
    expect(err.reason).toBe('missing_certificate');
    expect(err.code).toBe('invalid_client');
  });

  it('is invalid_request with a secret, Basic, or an assertion as well', async () => {
    for (const input of [
      { body: { client_id: 'device', client_secret: 'x' } },
      { body: { client_id: 'device', client_secret: '' } },
      { authorization: basic('device', 'x') },
      {
        body: {
          client_id: 'device',
          client_assertion_type:
            'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
          client_assertion: 'a.b.c',
        },
      },
    ]) {
      const err = await failure({ ...input, clientCert: cert() });
      expect(err.reason).toBe('credential_with_certificate_method');
      expect(err.code).toBe('invalid_request');
      expect(err.httpStatus).toBe(400);
    }
    expect(resolve).not.toHaveBeenCalled();
  });

  it('is invalid_client with one description when a resolver rejects', async () => {
    resolve.mockResolvedValueOnce({ rejected: 'untrusted' });
    const err = await failure({
      body: { client_id: 'device' },
      clientCert: cert(),
    });
    expect(err.reason).toBe('invalid_certificate');
    expect(err.description).toBe('Invalid client certificate');
    expect(err.detail).toBe('untrusted');
    expect(recordFailure).toHaveBeenCalledWith('realm-1', 'thumb');
  });

  it('is invalid_client when no resolver knows the client', async () => {
    resolve.mockResolvedValueOnce(null);
    const err = await failure({
      body: { client_id: 'device' },
      clientCert: cert(),
    });
    expect(err.detail).toBe('no_resolver');
    expect(recordFailure).toHaveBeenCalled();
  });

  it('turns a resolver error into invalid_client, not a 500', async () => {
    resolve.mockRejectedValueOnce(new Error('corrupt PEM'));
    const err = await failure({
      body: { client_id: 'device' },
      clientCert: cert(),
    });
    expect(err.reason).toBe('invalid_certificate');
    expect(err.httpStatus).toBe(401);
  });

  it('refuses a resolution for another client or method', async () => {
    resolve.mockResolvedValueOnce({
      clientId: 'other',
      method: 'tls_client_auth',
      bindToCertificate: false,
    });
    expect(
      (await failure({ body: { client_id: 'device' }, clientCert: cert() }))
        .detail,
    ).toBe('resolver_mismatch');
  });

  it('answers 429 slow_down once the failure budget is spent', async () => {
    retryAfter.mockResolvedValueOnce(42);
    const err = await failure({
      body: { client_id: 'device' },
      clientCert: cert(),
    });
    expect(err.reason).toBe('too_many_failures');
    expect(err.code).toBe('slow_down');
    expect(err.httpStatus).toBe(429);
    expect(err.retryAfterSeconds).toBe(42);
    expect(retryAfter).toHaveBeenCalledWith('realm-1', 'thumb');
    expect(resolve).not.toHaveBeenCalled();
    expect(recordFailure).not.toHaveBeenCalled();
  });

  it('still fails closed when the failure cannot be counted', async () => {
    resolve.mockResolvedValueOnce({ rejected: 'expired' });
    recordFailure.mockRejectedValueOnce(new Error('db down'));
    expect(
      (await failure({ body: { client_id: 'device' }, clientCert: cert() }))
        .reason,
    ).toBe('invalid_certificate');
  });

  it('ignores a certificate presented by a secret client', async () => {
    const certificate = cert();
    const result = await run({
      body: { client_id: 'backend', client_secret: 'right' },
      clientCert: certificate,
    });
    expect(result).toMatchObject({
      method: 'client_secret_post',
      certificate,
      x5tS256: null,
      bindToCertificate: false,
    });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('still requires the secret of a secret client that presents a certificate', async () => {
    expect(
      (await failure({ body: { client_id: 'backend' }, clientCert: cert() }))
        .reason,
    ).toBe('missing_secret');
  });

  it('runs beforeCredentialCheck before the certificate checks', async () => {
    const check = jest.fn(() => {
      throw new OAuthTokenError('unauthorized_client', 'nope');
    });
    await expect(
      run({
        body: { client_id: 'device' },
        clientCert: cert(),
        beforeCredentialCheck: check,
      }),
    ).rejects.toMatchObject({ code: 'unauthorized_client' });
    expect(resolve).not.toHaveBeenCalled();
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
