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
  const updates: Record<string, Array<{ data: Record<string, any> }>> = {};
  const record = (name: string, result: unknown) =>
    jest.fn((args: { data: Record<string, any> }) => {
      writes.push(name);
      (updates[name] ??= []).push(args);
      return Promise.resolve(result);
    });
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
      create: record('encryptionKeyCheck.create', {}),
      update: record('encryptionKeyCheck.update', {}),
    },
    webhook: {
      findMany: jest.fn(() => Promise.resolve(opts.webhooks ?? [])),
      updateMany: record('webhook.updateMany', { count: 1 }),
    },
    nhiCredential: { findMany: jest.fn(empty) },
    realm: {
      findMany: jest.fn(() => Promise.resolve(opts.realms ?? [])),
      updateMany: record('realm.updateMany', { count: 1 }),
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
  return { prisma, writes, updates };
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

describe('SecretsAtRestService key rotation', () => {
  const oldKey = cryptoWithKey('the-old-key');
  const unknown = cryptoWithKey('a-third-key');
  const rotating = (() => {
    const saved = process.env['WEBHOOK_SECRET_KEY_PREVIOUS'];
    process.env['WEBHOOK_SECRET_KEY_PREVIOUS'] = 'the-old-key';
    try {
      return cryptoWithKey('the-new-key');
    } finally {
      if (saved === undefined)
        delete process.env['WEBHOOK_SECRET_KEY_PREVIOUS'];
      else process.env['WEBHOOK_SECRET_KEY_PREVIOUS'] = saved;
    }
  })();
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
  const underOld = {
    keyCheck: oldKey.encrypt(KEY_CHECK_PLAINTEXT),
    sweepVersion: 1,
  };
  const savedAccept = process.env['STORED_SECRETS_ACCEPT_UNREADABLE'];
  afterEach(() => {
    if (savedAccept === undefined)
      delete process.env['STORED_SECRETS_ACCEPT_UNREADABLE'];
    else process.env['STORED_SECRETS_ACCEPT_UNREADABLE'] = savedAccept;
  });

  it('re-encrypts values under the previous key, then moves the key check last', async () => {
    const { prisma, writes, updates } = fakeDb({
      keyCheck: underOld,
      realms: [realmRow(oldKey.encrypt('smtp-pass'))],
      webhooks: [{ id: 'w', secret: oldKey.encrypt('hook') }],
    });
    const result = await new SecretsAtRestService(
      prisma as any,
      rotating,
    ).run();
    expect(writes).toEqual([
      'webhook.updateMany',
      'realm.updateMany',
      'encryptionKeyCheck.update',
    ]);
    expect(result.rotated).toBe(true);
    expect(result.encrypted).toEqual({ webhooks: 1, realms: 1 });
    const realmData = updates['realm.updateMany'][0].data;
    expect(rotating.open(realmData.smtpPassword)).toEqual({
      plaintext: 'smtp-pass',
      slot: 'current',
    });
    const keyCheck = updates['encryptionKeyCheck.update'][0].data.keyCheck;
    expect(rotating.open(keyCheck)?.slot).toBe('current');
    expect(rotating.decrypt(keyCheck)).toBe(KEY_CHECK_PLAINTEXT);
  });

  it('leaves values already under the current key alone', async () => {
    const { prisma, writes } = fakeDb({
      keyCheck: {
        keyCheck: rotating.encrypt(KEY_CHECK_PLAINTEXT),
        sweepVersion: 1,
      },
      realms: [realmRow(rotating.encrypt('smtp-pass'))],
    });
    await new SecretsAtRestService(prisma as any, rotating).run();
    expect(writes).toEqual(['encryptionKeyCheck.update']);
  });

  it('refuses a previous key that is not the one in use, writing nothing', async () => {
    const { prisma, writes } = fakeDb({
      keyCheck: {
        keyCheck: unknown.encrypt(KEY_CHECK_PLAINTEXT),
        sweepVersion: 1,
      },
      realms: [realmRow(unknown.encrypt('smtp-pass'))],
    });
    await expect(
      new SecretsAtRestService(prisma as any, rotating).run(),
    ).rejects.toThrow(/WEBHOOK_SECRET_KEY_PREVIOUS/);
    expect(writes).toEqual([]);
  });

  it('refuses a value neither key decrypts before writing anything', async () => {
    const { prisma, writes } = fakeDb({
      keyCheck: underOld,
      realms: [realmRow(unknown.encrypt('smtp-pass'))],
      webhooks: [{ id: 'w', secret: oldKey.encrypt('hook') }],
    });
    await expect(
      new SecretsAtRestService(prisma as any, rotating).run(),
    ).rejects.toThrow(/realms acme smtpPassword/);
    expect(writes).toEqual([]);
  });

  it('a webhook secret neither key decrypts is unreadable, whatever it looks like', async () => {
    const { prisma, writes } = fakeDb({
      keyCheck: underOld,
      webhooks: [{ id: 'w', secret: 'not-ciphertext-at-all' }],
    });
    await expect(
      new SecretsAtRestService(prisma as any, rotating).run(),
    ).rejects.toThrow(/webhooks w secret/);
    expect(writes).toEqual([]);
  });

  it('STORED_SECRETS_ACCEPT_UNREADABLE leaves such values as they are and completes', async () => {
    process.env['STORED_SECRETS_ACCEPT_UNREADABLE'] = 'true';
    const { prisma, writes } = fakeDb({
      keyCheck: underOld,
      realms: [realmRow(unknown.encrypt('smtp-pass'))],
    });
    const result = await new SecretsAtRestService(
      prisma as any,
      rotating,
    ).run();
    expect(result.unreadable).toEqual(['realms acme smtpPassword']);
    expect(writes).toEqual(['encryptionKeyCheck.update']);
  });

  it('still encrypts legacy plaintext while rotating', async () => {
    const { prisma, writes, updates } = fakeDb({
      keyCheck: underOld,
      realms: [realmRow('plain-pass')],
    });
    await new SecretsAtRestService(prisma as any, rotating).run();
    expect(writes).toContain('realm.updateMany');
    expect(
      rotating.decrypt(updates['realm.updateMany'][0].data.smtpPassword),
    ).toBe('plain-pass');
  });

  it('will not rotate a database that never ran encryption at rest', async () => {
    const { prisma, writes } = fakeDb({
      realms: [realmRow(oldKey.encrypt('smtp-pass'))],
    });
    await expect(
      new SecretsAtRestService(prisma as any, rotating).run(),
    ).rejects.toThrow(/never run on this database/);
    expect(writes).toEqual([]);
  });

  it('without a previous key, an envelope of an unknown key fails the start', async () => {
    const { prisma, writes } = fakeDb({
      keyCheck: {
        keyCheck: rotating.encrypt(KEY_CHECK_PLAINTEXT),
        sweepVersion: 1,
      },
      realms: [realmRow(oldKey.encrypt('smtp-pass'))],
    });
    await expect(
      new SecretsAtRestService(
        prisma as any,
        cryptoWithKey('the-new-key'),
      ).run(),
    ).rejects.toThrow(StoredSecretsKeyError);
    expect(writes).toEqual([]);
  });
});
