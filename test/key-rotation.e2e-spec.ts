import { createCipheriv, randomBytes, scryptSync } from 'crypto';
import { createTestApp, type SeededRealm, type TestContext } from './setup';
import { CryptoService } from '../src/crypto/crypto.service';
import {
  KEY_CHECK_ID,
  KEY_CHECK_PLAINTEXT,
  SWEEP_BATCH,
  SecretsAtRestService,
  StoredSecretsKeyError,
} from '../src/secrets-at-rest/secrets-at-rest.service';

type Row = Record<string, any>;

const KEY_VARS = [
  'WEBHOOK_SECRET_KEY',
  'WEBHOOK_ENCRYPTION_SALT',
  'WEBHOOK_SECRET_KEY_PREVIOUS',
  'WEBHOOK_ENCRYPTION_SALT_PREVIOUS',
] as const;
type KeyEnv = Partial<Record<(typeof KEY_VARS)[number], string>>;

/** A CryptoService built under exactly these key variables. */
function cryptoWith(env: KeyEnv): CryptoService {
  const saved = KEY_VARS.map((k) => [k, process.env[k]] as const);
  for (const k of KEY_VARS) {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    return new CryptoService();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** The key variables the test app runs with (the development key). */
const APP_ENV: KeyEnv = {
  WEBHOOK_SECRET_KEY: process.env['WEBHOOK_SECRET_KEY'],
  WEBHOOK_ENCRYPTION_SALT: process.env['WEBHOOK_ENCRYPTION_SALT'],
};
const RAW_A = APP_ENV.WEBHOOK_SECRET_KEY ?? 'dev-webhook-secret-key-replace-me';
const SALT_A = APP_ENV.WEBHOOK_ENCRYPTION_SALT ?? 'idenplane-webhook-salt';
const B_ENV: KeyEnv = {
  WEBHOOK_SECRET_KEY: 'rotation-e2e-key-b-0123456789abcdef',
  WEBHOOK_ENCRYPTION_SALT: 'rotation-e2e-salt-b',
};

/** Ciphertext as versions before key rotation wrote it: no key id. */
function legacyEncrypt(plaintext: string): string {
  const key = scryptSync(RAW_A, SALT_A, 32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}

/**
 * Key rotation: secrets encrypted under key A (the test app's key) are moved
 * to key B by the start-up sweep when B is configured with A as the previous
 * key; a second run is a no-op, a wrong previous key is refused with nothing
 * written, and concurrent sweeps agree. The suite rotates back to A at the
 * end, so the other suites keep their key.
 */
describe('Encryption key rotation (e2e)', () => {
  let ctx: TestContext;
  let seeded: SeededRealm;
  const REALM = 'e2e-key-rotation';
  const TOTP_USERS = SWEEP_BATCH * 2 + 7;

  const a = cryptoWith(APP_ENV);
  const b = cryptoWith(B_ENV);
  const bAfterA = cryptoWith({
    ...B_ENV,
    WEBHOOK_SECRET_KEY_PREVIOUS: RAW_A,
    WEBHOOK_ENCRYPTION_SALT_PREVIOUS: SALT_A,
  });
  const aAfterB = cryptoWith({
    ...APP_ENV,
    WEBHOOK_SECRET_KEY_PREVIOUS: B_ENV.WEBHOOK_SECRET_KEY,
    WEBHOOK_ENCRYPTION_SALT_PREVIOUS: B_ENV.WEBHOOK_ENCRYPTION_SALT,
  });
  const sweep = (crypto: CryptoService) =>
    new SecretsAtRestService(ctx.prisma, crypto).run();

  /** The plaintext of every secret this suite seeded, by location. */
  const expected = new Map<string, string>();

  beforeAll(async () => {
    ctx = await createTestApp();
    await ctx.prisma.realm.delete({ where: { name: REALM } }).catch(() => {});
    seeded = await ctx.seedTestRealm(REALM);
    const realmId = seeded.realm.id;

    // Whatever other suites left behind is under A; start from a clean pass.
    await sweep(a);

    const idp = await ctx.prisma.identityProvider.create({
      data: {
        realmId,
        alias: 'rot-idp',
        clientId: 'c',
        clientSecret: a.encrypt('idp-secret'),
        authorizationUrl: 'https://rot.example.test/a',
        tokenUrl: 'https://rot.example.test/t',
      },
    });
    expected.set(`idp ${idp.id}`, 'idp-secret');
    const ldap = await ctx.prisma.userFederation.create({
      data: {
        realmId,
        name: 'rot-ldap',
        connectionUrl: 'ldap://rot.example.test',
        bindDn: 'cn=x',
        // Written before key ids existed: the legacy format.
        bindCredential: legacyEncrypt('bind-secret'),
        usersDn: 'ou=u',
      },
    });
    expected.set(`ldap ${ldap.id}`, 'bind-secret');
    const stream = await ctx.prisma.auditLogStream.create({
      data: {
        realmId,
        name: 'rot-stream',
        streamType: 'http',
        url: 'https://rot.example.test/s',
        httpHeaders: { Authorization: a.encrypt('Bearer header-secret') },
      },
    });
    expected.set(`stream ${stream.id}`, 'Bearer header-secret');
    const org = await ctx.prisma.organization.create({
      data: { realmId, name: 'Rot', slug: 'rot-org' },
    });
    const sso = await ctx.prisma.organizationSsoConnection.create({
      data: {
        organizationId: org.id,
        type: 'oidc',
        name: 'rot',
        config: { clientId: 'l', clientSecret: a.encrypt('sso-secret') },
      },
    });
    expected.set(`sso ${sso.id}`, 'sso-secret');
    const hook = await ctx.prisma.webhook.create({
      data: {
        realmId,
        url: 'https://rot.example.test/hook',
        secret: a.encrypt('hook-secret'),
      },
    });
    expected.set(`webhook ${hook.id}`, 'hook-secret');
    const nhi = await ctx.prisma.nhiIdentity.create({
      data: { realmId, name: 'rot-device' },
    });
    const nhiCred = await ctx.prisma.nhiCredential.create({
      data: {
        realmId,
        nhiIdentityId: nhi.id,
        credentialType: 'API_KEY',
        name: 'rot-key',
        privateKeyPem: a.encrypt('nhi-private-key'),
      },
    });
    expected.set(`nhi ${nhiCred.id}`, 'nhi-private-key');
    await ctx.prisma.realm.update({
      where: { id: realmId },
      data: {
        smtpPassword: a.encrypt('smtp-secret'),
        emailProviderConfig: {
          resend: { apiKey: legacyEncrypt('resend-secret') },
        },
      },
    });
    expected.set(`realm smtp`, 'smtp-secret');
    expected.set(`realm resend`, 'resend-secret');
    const signingKey = await ctx.prisma.realmSigningKey.findFirstOrThrow({
      where: { realmId },
    });
    // seedTestRealm writes it in plaintext; the clean pass encrypted it.
    expected.set(`signing ${signingKey.id}`, a.decrypt(signingKey.privateKey));

    // Enough TOTP users for several batches, and one SMS factor.
    await ctx.prisma.user.createMany({
      data: Array.from({ length: TOTP_USERS }, (_, i) => ({
        realmId,
        username: `rot-user-${i}`,
      })),
    });
    const users = await ctx.prisma.user.findMany({
      where: { realmId, username: { startsWith: 'rot-user-' } },
      select: { id: true, username: true },
    });
    await ctx.prisma.userCredential.createMany({
      data: users.map((u, i) => ({
        userId: u.id,
        type: 'totp',
        // A few in the legacy format.
        secretKey:
          i % 100 === 0
            ? legacyEncrypt(`seed-${u.username}`)
            : a.encrypt(`seed-${u.username}`),
        verified: true,
      })),
    });
    const sms = await ctx.prisma.userCredential.create({
      data: {
        userId: seeded.user.id,
        type: 'sms',
        secretKey: '',
        phoneNumber: a.encrypt('+15550001234'),
        verified: true,
      },
    });
    expected.set(`sms ${sms.id}`, '+15550001234');
  }, 120_000);

  afterAll(async () => {
    // Leave the database under the app's key, whatever happened above.
    const check = await ctx.prisma.encryptionKeyCheck.findUnique({
      where: { id: KEY_CHECK_ID },
    });
    if (check && b.open(check.keyCheck)) await sweep(aAfterB);
    await ctx.prisma.realm.delete({ where: { name: REALM } }).catch(() => {});
    await ctx.cleanup();
  }, 120_000);

  /** Every value this suite seeded, as stored now. */
  const stored = async (): Promise<Map<string, string>> => {
    const realmId = seeded.realm.id;
    const out = new Map<string, string>();
    for (const r of await ctx.prisma.identityProvider.findMany({
      where: { realmId, alias: 'rot-idp' },
    })) {
      out.set(`idp ${r.id}`, r.clientSecret);
    }
    for (const r of await ctx.prisma.userFederation.findMany({
      where: { realmId, name: 'rot-ldap' },
    })) {
      out.set(`ldap ${r.id}`, r.bindCredential);
    }
    for (const r of await ctx.prisma.auditLogStream.findMany({
      where: { realmId, name: 'rot-stream' },
    })) {
      out.set(`stream ${r.id}`, (r.httpHeaders as Row).Authorization);
    }
    for (const r of await ctx.prisma.organizationSsoConnection.findMany({
      where: { name: 'rot', organization: { slug: 'rot-org' } },
    })) {
      out.set(`sso ${r.id}`, (r.config as Row).clientSecret);
    }
    for (const r of await ctx.prisma.webhook.findMany({ where: { realmId } })) {
      out.set(`webhook ${r.id}`, r.secret);
    }
    for (const r of await ctx.prisma.nhiCredential.findMany({
      where: { realmId },
    })) {
      out.set(`nhi ${r.id}`, r.privateKeyPem!);
    }
    const realm = await ctx.prisma.realm.findUniqueOrThrow({
      where: { id: realmId },
    });
    out.set('realm smtp', realm.smtpPassword!);
    out.set(
      'realm resend',
      (realm.emailProviderConfig as Row).resend.apiKey as string,
    );
    for (const r of await ctx.prisma.realmSigningKey.findMany({
      where: { realmId },
    })) {
      out.set(`signing ${r.id}`, r.privateKey);
    }
    for (const r of await ctx.prisma.userCredential.findMany({
      where: { user: { realmId } },
      include: { user: { select: { username: true } } },
    })) {
      out.set(
        `${r.type} ${r.type === 'totp' ? r.user.username : r.id}`,
        r.type === 'sms' ? r.phoneNumber! : r.secretKey,
      );
    }
    return out;
  };

  /** Plaintext of each stored value with `crypto`, and the key it opened with. */
  const openAll = async (crypto: CryptoService) => {
    const out = new Map<string, { plaintext: string; slot: string }>();
    for (const [what, value] of await stored()) {
      const opened = crypto.open(value);
      if (!opened) throw new Error(`${what} does not open`);
      out.set(what, opened);
    }
    return out;
  };

  const expectAllUnder = async (crypto: CryptoService) => {
    const opened = await openAll(crypto);
    expect(opened.size).toBe(expected.size + TOTP_USERS);
    for (const [what, value] of opened) {
      expect({ what, slot: value.slot }).toEqual({ what, slot: 'current' });
      if (what.startsWith('totp ')) {
        expect(value.plaintext).toBe(`seed-${what.slice(5)}`);
      } else {
        expect({ what, plaintext: value.plaintext }).toEqual({
          what,
          plaintext: expected.get(what),
        });
      }
    }
  };

  it('starts with everything under key A', async () => {
    await expectAllUnder(a);
  });

  it('a wrong previous key is refused, and nothing is written', async () => {
    const wrong = cryptoWith({
      ...B_ENV,
      WEBHOOK_SECRET_KEY_PREVIOUS: 'not-the-key-in-use',
    });
    const before = await stored();
    const checkBefore = await ctx.prisma.encryptionKeyCheck.findUniqueOrThrow({
      where: { id: KEY_CHECK_ID },
    });
    await expect(sweep(wrong)).rejects.toThrow(StoredSecretsKeyError);
    expect(await stored()).toEqual(before);
    expect(
      await ctx.prisma.encryptionKeyCheck.findUniqueOrThrow({
        where: { id: KEY_CHECK_ID },
      }),
    ).toEqual(checkBefore);
  });

  it('a value neither key decrypts is refused before anything is written', async () => {
    const third = cryptoWith({ WEBHOOK_SECRET_KEY: 'a-third-key' });
    const hook = await ctx.prisma.webhook.create({
      data: {
        realmId: seeded.realm.id,
        url: 'https://rot.example.test/lost',
        secret: third.encrypt('lost'),
      },
    });
    try {
      const before = await stored();
      await expect(sweep(bAfterA)).rejects.toThrow(
        new RegExp(`webhooks ${hook.id} secret`),
      );
      expect(await stored()).toEqual(before);
      expect(
        a.open(
          (
            await ctx.prisma.encryptionKeyCheck.findUniqueOrThrow({
              where: { id: KEY_CHECK_ID },
            })
          ).keyCheck,
        )?.slot,
      ).toBe('current');
    } finally {
      await ctx.prisma.webhook.delete({ where: { id: hook.id } });
    }
  });

  it('with B current and A previous, moves every value to B and the key check last', async () => {
    const started = Date.now();
    const result = await sweep(bAfterA);
    const ms = Date.now() - started;
    expect(result.rotated).toBe(true);
    expect(result.unreadable).toEqual([]);
    expect(result.encrypted['user_credentials']).toBeGreaterThanOrEqual(
      TOTP_USERS + 1,
    );
    // Readable with B alone: nothing is left under A.
    await expectAllUnder(b);
    const check = await ctx.prisma.encryptionKeyCheck.findUniqueOrThrow({
      where: { id: KEY_CHECK_ID },
    });
    expect(b.decrypt(check.keyCheck)).toBe(KEY_CHECK_PLAINTEXT);
    expect(() => a.decrypt(check.keyCheck)).toThrow();
    // Not a timing assertion; recorded for the documentation.
    console.log(
      `key rotation e2e: ${TOTP_USERS} TOTP rows and the rest in ${ms} ms`,
    );
  });

  it('a second run is a no-op', async () => {
    const before = await stored();
    const result = await sweep(bAfterA);
    expect(result.encrypted).toEqual({});
    expect(await stored()).toEqual(before);
  });

  it('B alone starts once the rotation is done; A alone no longer does', async () => {
    await expect(sweep(b)).resolves.toMatchObject({ encrypted: {} });
    await expect(sweep(a)).rejects.toThrow(StoredSecretsKeyError);
  });

  it('concurrent sweeps rotating back to A agree and lose nothing', async () => {
    // Every TOTP seed and SMS phone in the database is under B now.
    const credentials = await ctx.prisma.userCredential.count({
      where: {
        OR: [
          { type: 'totp', secretKey: { not: '' } },
          { type: 'sms', phoneNumber: { not: null } },
        ],
      },
    });
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => sweep(aAfterB)),
    );
    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
    const written = results.map(
      (r) =>
        (r as PromiseFulfilledResult<{ encrypted: Row }>).value.encrypted[
          'user_credentials'
        ] ?? 0,
    );
    // Each one was moved exactly once, by whichever process got to it.
    expect(written.reduce((x: number, y: number) => x + y, 0)).toBe(
      credentials,
    );
    await expectAllUnder(a);
    const check = await ctx.prisma.encryptionKeyCheck.findUniqueOrThrow({
      where: { id: KEY_CHECK_ID },
    });
    expect(a.decrypt(check.keyCheck)).toBe(KEY_CHECK_PLAINTEXT);
    // And the app's own key starts again.
    await expect(sweep(a)).resolves.toMatchObject({ encrypted: {} });
  });
});
