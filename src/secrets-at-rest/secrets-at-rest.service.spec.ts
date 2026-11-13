import { CryptoService } from '../crypto/crypto.service.js';
import {
  KEY_CHECK_PLAINTEXT,
  SecretsAtRestService,
  StoredSecretsKeyError,
  looksEncrypted,
} from './secrets-at-rest.service.js';

/** A CryptoService built while WEBHOOK_SECRET_KEY is `key`. */
function cryptoWithKey(key: string | undefined): CryptoService {
  const saved = process.env['WEBHOOK_SECRET_KEY'];
  if (key === undefined) delete process.env['WEBHOOK_SECRET_KEY'];
  else process.env['WEBHOOK_SECRET_KEY'] = key;
  try {
    return new CryptoService();
  } finally {
    if (saved === undefined) delete process.env['WEBHOOK_SECRET_KEY'];
    else process.env['WEBHOOK_SECRET_KEY'] = saved;
  }
}

/**
 * A database with nothing but `realms` and the given key check row; every
 * write is recorded.
 */
function fakeDb(opts: {
  realms?: Array<Record<string, unknown>>;
  webhooks?: Array<{ id: string; secret: string }>;
  keyCheck?: { keyCheck: string; sweepVersion: number } | null;
}) {
  const writes: string[] = [];
  const empty = () => Promise.resolve([]);
  const tx = {
    $executeRawUnsafe: jest.fn(() => Promise.resolve(0)),
    encryptionKeyCheck: {
      findUnique: jest.fn(() =>
        Promise.resolve(
          opts.keyCheck
            ? { ...opts.keyCheck, sweptAt: null, updatedAt: new Date(0) }
            : null,
        ),
      ),
      create: jest.fn(() => {
        writes.push('encryptionKeyCheck.create');
        return Promise.resolve({});
      }),
      update: jest.fn(() => {
        writes.push('encryptionKeyCheck.update');
        return Promise.resolve({});
      }),
    },
    webhook: { findMany: jest.fn(() => Promise.resolve(opts.webhooks ?? [])) },
    nhiCredential: { findMany: jest.fn(empty) },
    realm: {
      findMany: jest.fn(() => Promise.resolve(opts.realms ?? [])),
      updateMany: jest.fn(() => {
        writes.push('realm.updateMany');
        return Promise.resolve({ count: 1 });
      }),
    },
    identityProvider: { findMany: jest.fn(empty) },
    userFederation: { findMany: jest.fn(empty) },
    realmSigningKey: { findMany: jest.fn(empty) },
    auditLogStream: { findMany: jest.fn(empty) },
    organizationSsoConnection: { findMany: jest.fn(empty) },
    wizardState: { findMany: jest.fn(empty) },
    userCredential: { findMany: jest.fn(empty) },
  };
  const prisma = {
    ...tx,
    $transaction: jest.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return { prisma, writes };
}

describe('SecretsAtRestService', () => {
  const right = cryptoWithKey('the-right-key');
  const wrong = cryptoWithKey('a-wrong-key');
  const realmRow = (smtpPassword: string | null) => ({
    id: 'r1',
    name: 'acme',
    updatedAt: new Date(0),
    smtpPassword,
    recaptchaSecretKey: null,
    hcaptchaSecretKey: null,
    emailProviderConfig: null,
    smsProviderConfig: null,
  });
  const savedAccept = process.env['STORED_SECRETS_ACCEPT_KEY'];
  afterEach(() => {
    if (savedAccept === undefined)
      delete process.env['STORED_SECRETS_ACCEPT_KEY'];
    else process.env['STORED_SECRETS_ACCEPT_KEY'] = savedAccept;
  });

  it('first run without webhooks: refuses a key that cannot read the realm secrets', async () => {
    // An SMTP password encrypted by the previous release, with the right key.
    const { prisma, writes } = fakeDb({
      realms: [realmRow(right.encryptSecret('smtp-pass'))],
    });
    await expect(
      new SecretsAtRestService(prisma as any, wrong).run(),
    ).rejects.toThrow(StoredSecretsKeyError);
    // Nothing written: no key check, no second encryption of the password.
    expect(writes).toEqual([]);
  });

  it('first run without webhooks: the right key writes the key check', async () => {
    const { prisma, writes } = fakeDb({
      realms: [realmRow(right.encryptSecret('smtp-pass'))],
    });
    const result = await new SecretsAtRestService(prisma as any, right).run();
    expect(result.keyCheckCreated).toBe(true);
    expect(writes).toContain('encryptionKeyCheck.create');
    expect(writes).not.toContain('realm.updateMany');
  });

  it('first run with only plaintext: nothing to check, encrypts it', async () => {
    const { prisma, writes } = fakeDb({ realms: [realmRow('plain-pass')] });
    await new SecretsAtRestService(prisma as any, wrong).run();
    expect(writes).toEqual([
      'encryptionKeyCheck.create',
      'realm.updateMany',
      'encryptionKeyCheck.update',
    ]);
  });

  it('first run: STORED_SECRETS_ACCEPT_KEY overrides a refusal explicitly', async () => {
    process.env['STORED_SECRETS_ACCEPT_KEY'] = 'true';
    const { prisma, writes } = fakeDb({
      webhooks: [{ id: 'w', secret: right.encrypt('hook') }],
    });
    await new SecretsAtRestService(prisma as any, wrong).run();
    expect(writes).toContain('encryptionKeyCheck.create');
  });

  it('later runs: refuses a key that cannot read the key check', async () => {
    const { prisma, writes } = fakeDb({
      keyCheck: {
        keyCheck: right.encrypt(KEY_CHECK_PLAINTEXT),
        sweepVersion: 1,
      },
      realms: [realmRow('plain-pass')],
    });
    await expect(
      new SecretsAtRestService(prisma as any, wrong).run(),
    ).rejects.toThrow(StoredSecretsKeyError);
    expect(writes).toEqual([]);
  });

  it('in production, refuses to run without a configured key', async () => {
    const saved = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';
    const { prisma, writes } = fakeDb({});
    try {
      await expect(
        new SecretsAtRestService(prisma as any, cryptoWithKey(undefined)).run(),
      ).rejects.toThrow(/must be set/);
    } finally {
      process.env['NODE_ENV'] = saved;
    }
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it('looksEncrypted: ciphertext yes, typical plaintext secrets no', () => {
    expect(looksEncrypted(right.encryptSecret('x'))).toBe(true);
    for (const plain of [
      'hunter2',
      're_123456789',
      'SG.abc.def',
      'JBSWY3DPEHPK3PXP',
      '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
      'not base64 but long enough to be considered at all!!',
    ]) {
      expect(looksEncrypted(plain)).toBe(false);
    }
  });
});
