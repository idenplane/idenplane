jest.mock('../crypto/jwk.service.js', () => ({ JwkService: jest.fn() }));

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { InstanceBootstrapService } from './instance-bootstrap.service.js';

const USER_PASSWORD = 'dummy-initial-password';
const CLIENT_SECRET = 'dummy-client-secret-0123456789abcdef';

function writeFile(doc: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'bootstrap-svc-'));
  const file = join(dir, 'bootstrap.json');
  writeFileSync(file, typeof doc === 'string' ? doc : JSON.stringify(doc));
  return file;
}

const realm = (name: string, extra: Record<string, unknown> = {}) => ({
  version: 2,
  realm: { name, displayName: name.toUpperCase() },
  ...extra,
});

describe('InstanceBootstrapService', () => {
  let env: Record<string, string | undefined>;
  let tx: {
    realm: { findMany: jest.Mock; findUniqueOrThrow: jest.Mock };
    user: { update: jest.Mock };
  };
  let wizard: { completeUnattended: jest.Mock };
  let realmImport: {
    prepareV2Import: jest.Mock;
    refreshAfterImport: jest.Mock;
  };
  let crypto: { hashPassword: jest.Mock; isSecretHash: jest.Mock };
  let written: string[];

  const build = () =>
    new InstanceBootstrapService(
      { get: (key: string) => env[key] } as never,
      crypto as never,
      realmImport as never,
      wizard as never,
    );

  beforeEach(() => {
    env = {};
    written = [];
    tx = {
      realm: {
        findMany: jest.fn(async () => []),
        findUniqueOrThrow: jest.fn(async () => ({ id: 'realm-id' })),
      },
      user: { update: jest.fn(async () => ({})) },
    };
    wizard = {
      completeUnattended: jest.fn(
        async (apply: (t: typeof tx) => Promise<unknown>) => ({
          status: 'applied',
          result: await apply(tx),
        }),
      ),
    };
    realmImport = {
      prepareV2Import: jest.fn(async (doc: { realm: { name: string } }) => ({
        realmName: doc.realm.name,
        write: jest.fn(async () => {
          written.push(doc.realm.name);
          return { realmName: doc.realm.name, warnings: [] };
        }),
      })),
      refreshAfterImport: jest.fn(async () => undefined),
    };
    crypto = {
      hashPassword: jest.fn(async (p: string) => `hash-of-${p.length}`),
      isSecretHash: jest.fn(() => false),
    };
  });

  it('does nothing without BOOTSTRAP_FILE', async () => {
    await expect(build().run()).resolves.toEqual({ status: 'not-configured' });
    expect(wizard.completeUnattended).not.toHaveBeenCalled();
  });

  it('creates the declared realms and closes the wizard in one transaction', async () => {
    env['BOOTSTRAP_FILE'] = writeFile({
      version: 1,
      realms: [realm('acme'), realm('beta')],
    });

    await expect(build().run()).resolves.toEqual({
      status: 'applied',
      realms: ['acme', 'beta'],
    });
    expect(wizard.completeUnattended).toHaveBeenCalledTimes(1);
    expect(wizard.completeUnattended.mock.calls[0][1]).toEqual({
      realmName: 'acme',
      realmDisplayName: 'ACME',
    });
    expect(written).toEqual(['acme', 'beta']);
    expect(realmImport.refreshAfterImport).toHaveBeenCalled();
  });

  it('closes the wizard with an empty realm list', async () => {
    env['BOOTSTRAP_FILE'] = writeFile({ version: 1 });
    await expect(build().run()).resolves.toEqual({
      status: 'applied',
      realms: [],
    });
    expect(wizard.completeUnattended).toHaveBeenCalledTimes(1);
  });

  it('sets initial passwords, hashed, in the same transaction', async () => {
    env['BOOTSTRAP_FILE'] = writeFile({
      version: 1,
      realms: [
        realm('acme', {
          users: [{ username: 'owner', initialPassword: '${env:OWNER_PW}' }],
        }),
      ],
    });
    // ${env:NAME} is looked up in the process environment.
    process.env['OWNER_PW'] = USER_PASSWORD;
    try {
      await build().run();
    } finally {
      delete process.env['OWNER_PW'];
    }

    expect(crypto.hashPassword).toHaveBeenCalledWith(USER_PASSWORD);
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { realmId_username: { realmId: 'realm-id', username: 'owner' } },
      data: {
        passwordHash: `hash-of-${USER_PASSWORD.length}`,
        passwordChangedAt: expect.any(Date),
      },
    });
    const imported = realmImport.prepareV2Import.mock.calls[0][0] as {
      users: Array<Record<string, unknown>>;
    };
    expect(imported.users[0]).not.toHaveProperty('initialPassword');
  });

  it('changes nothing once setup is complete', async () => {
    env['BOOTSTRAP_FILE'] = writeFile({ version: 1, realms: [realm('acme')] });
    wizard.completeUnattended.mockResolvedValue({ status: 'already-complete' });

    await expect(build().run()).resolves.toEqual({ status: 'already-set-up' });
    expect(written).toEqual([]);
    expect(realmImport.refreshAfterImport).not.toHaveBeenCalled();
  });

  it('changes nothing on an instance that already has realms', async () => {
    env['BOOTSTRAP_FILE'] = writeFile({ version: 1, realms: [realm('acme')] });
    tx.realm.findMany.mockResolvedValue([{ name: 'existing' }]);
    wizard.completeUnattended.mockImplementation(
      async (apply: (t: typeof tx) => Promise<unknown>) => ({
        status: 'applied',
        result: await apply(tx),
      }),
    );

    await expect(build().run()).resolves.toEqual({
      status: 'not-fresh',
      existingRealms: ['existing'],
    });
    expect(written).toEqual([]);
  });

  it('fails loudly, before the lock, on an invalid file', async () => {
    env['BOOTSTRAP_FILE'] = writeFile({
      version: 1,
      realms: [realm('acme', { clients: [{ clientId: 'app' }] })],
    });

    await expect(build().onApplicationBootstrap()).rejects.toThrow(
      /Instance bootstrap \(BOOTSTRAP_FILE\) failed; nothing was applied.*clients\[0\]\.clientSecret/,
    );
    expect(wizard.completeUnattended).not.toHaveBeenCalled();
  });

  it('fails loudly on a missing file', async () => {
    env['BOOTSTRAP_FILE'] = '/nonexistent/bootstrap.json';
    await expect(build().onApplicationBootstrap()).rejects.toThrow(
      /cannot be read/,
    );
  });

  it('names the realm when the import refuses its document', async () => {
    env['BOOTSTRAP_FILE'] = writeFile({ version: 1, realms: [realm('acme')] });
    realmImport.prepareV2Import.mockRejectedValue(
      new BadRequestException({
        message:
          'Invalid realm import: clients[0].redirectUris: must be an array',
      }),
    );

    await expect(build().run()).rejects.toThrow(
      "realm 'acme': Invalid realm import: clients[0].redirectUris: must be an array",
    );
    expect(wizard.completeUnattended).not.toHaveBeenCalled();
  });

  it('propagates a failed write (the transaction rolls back)', async () => {
    env['BOOTSTRAP_FILE'] = writeFile({
      version: 1,
      realms: [
        realm('acme', {
          clients: [{ clientId: 'app', clientSecret: CLIENT_SECRET }],
        }),
      ],
    });
    realmImport.prepareV2Import.mockResolvedValue({
      realmName: 'acme',
      write: jest.fn(async () => {
        throw new Error('duplicate value');
      }),
    });

    await expect(build().run()).rejects.toThrow(
      "nothing was applied and the server will not start: realm 'acme': duplicate value",
    );
    expect(realmImport.refreshAfterImport).not.toHaveBeenCalled();
  });

  it('reads the document from BOOTSTRAP_JSON (docker run without a mount)', async () => {
    env['BOOTSTRAP_JSON'] = JSON.stringify({
      version: 1,
      realms: [realm('acme')],
    });
    await expect(build().run()).resolves.toEqual({
      status: 'applied',
      realms: ['acme'],
    });
  });

  it('refuses BOOTSTRAP_FILE and BOOTSTRAP_JSON together', async () => {
    env['BOOTSTRAP_FILE'] = writeFile({ version: 1 });
    env['BOOTSTRAP_JSON'] = '{"version":1}';
    await expect(build().onApplicationBootstrap()).rejects.toThrow(
      /not both/,
    );
    expect(wizard.completeUnattended).not.toHaveBeenCalled();
  });

  it('names BOOTSTRAP_JSON when its JSON is invalid', async () => {
    env['BOOTSTRAP_JSON'] = '{not json';
    await expect(build().run()).rejects.toThrow(
      /Instance bootstrap \(BOOTSTRAP_JSON\) failed.*not valid JSON/,
    );
  });
});
