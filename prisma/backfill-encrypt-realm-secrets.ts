/**
 * One-shot backfill: encrypts any realm secrets that are still plaintext
 * from before this fix (smtpPassword, recaptchaSecretKey, hcaptchaSecretKey,
 * and the apiKey/serverToken sub-fields of emailProviderConfig).
 *
 * Application code (RealmsService.create/update) now encrypts these on
 * write, and EmailService decrypts on read while tolerating legacy
 * plaintext — so this script is not required for correctness, only to
 * close the "a database dump exposes these secrets" exposure for rows
 * written before the fix shipped. Idempotent: safe to run repeatedly, and
 * safe to run against a DB that's already fully encrypted (does nothing).
 *
 * Run once per environment, operator-triggered (not on boot — a boot-time
 * pass would race across replicas):
 *   npx ts-node prisma/backfill-encrypt-realm-secrets.ts
 *
 * smsProviderConfig is intentionally not touched here: there is currently
 * no write path for it (not on CreateRealmDto/UpdateRealmDto) and no read
 * path (SMS providers source credentials from env vars, not this column),
 * so there is nothing for this script — or the app — to encrypt yet.
 */
import { PrismaClient, type Prisma } from '@prisma/client';
import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  scryptSync,
} from 'crypto';

// Duplicated from src/crypto/crypto.service.ts rather than imported, to
// avoid pulling a Nest @Injectable() service into a plain ts-node script
// (the same tradeoff prisma/seed.ts makes for the scope catalog). Keep in
// sync with CryptoService.encrypt/decrypt.
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const DEFAULT_WEBHOOK_SECRET_KEY = 'dev-webhook-secret-key-replace-me';
const DEFAULT_WEBHOOK_ENCRYPTION_SALT = 'idenplane-webhook-salt';

const encryptionKey = scryptSync(
  process.env['WEBHOOK_SECRET_KEY'] ?? DEFAULT_WEBHOOK_SECRET_KEY,
  process.env['WEBHOOK_ENCRYPTION_SALT'] ?? DEFAULT_WEBHOOK_ENCRYPTION_SALT,
  32,
);

function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function isEncrypted(value: string): boolean {
  try {
    const packed = Buffer.from(value, 'base64');
    const iv = packed.subarray(0, IV_BYTES);
    const tag = packed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const encrypted = packed.subarray(IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv(ALGORITHM, encryptionKey, iv);
    decipher.setAuthTag(tag);
    decipher.update(encrypted);
    decipher.final();
    return true;
  } catch {
    return false;
  }
}

function encryptSecret(
  value: string | null | undefined,
): string | null | undefined {
  if (!value) return value;
  if (isEncrypted(value)) return value;
  return encrypt(value);
}

const PROVIDER_SECRET_FIELD: Record<string, 'apiKey' | 'serverToken'> = {
  resend: 'apiKey',
  sendgrid: 'apiKey',
  mailgun: 'apiKey',
  postmark: 'serverToken',
};

function encryptEmailProviderConfig(
  config: unknown,
): { config: Record<string, unknown>; changed: boolean } | null {
  if (!config || typeof config !== 'object') return null;

  const cfg = config as Record<string, Record<string, unknown> | undefined>;
  const result: Record<string, unknown> = { ...cfg };
  let changed = false;

  for (const [provider, secretField] of Object.entries(PROVIDER_SECRET_FIELD)) {
    const sub = cfg[provider];
    if (!sub) continue;
    const before = sub[secretField];
    const after = encryptSecret(before as string | undefined);
    if (after !== before) {
      result[provider] = { ...sub, [secretField]: after };
      changed = true;
    }
  }

  return changed ? { config: result, changed } : null;
}

async function main() {
  const databaseUrl = process.env['DATABASE_URL'] ?? '';
  let prisma: PrismaClient;
  if (databaseUrl.startsWith('file:')) {
    prisma = new PrismaClient();
  } else {
    const { PrismaPg } = await import('@prisma/adapter-pg');
    const adapter = new PrismaPg({ connectionString: databaseUrl });
    prisma = new PrismaClient({ adapter });
  }

  const realms = await prisma.realm.findMany({
    select: {
      id: true,
      name: true,
      smtpPassword: true,
      recaptchaSecretKey: true,
      hcaptchaSecretKey: true,
      emailProviderConfig: true,
    },
  });

  let updatedRealms = 0;
  let encryptedFields = 0;

  for (const realm of realms) {
    const data: Prisma.RealmUpdateInput = {};

    const smtpPassword = encryptSecret(realm.smtpPassword);
    if (smtpPassword !== realm.smtpPassword) {
      data.smtpPassword = smtpPassword;
      encryptedFields++;
    }

    const recaptchaSecretKey = encryptSecret(realm.recaptchaSecretKey);
    if (recaptchaSecretKey !== realm.recaptchaSecretKey) {
      data.recaptchaSecretKey = recaptchaSecretKey;
      encryptedFields++;
    }

    const hcaptchaSecretKey = encryptSecret(realm.hcaptchaSecretKey);
    if (hcaptchaSecretKey !== realm.hcaptchaSecretKey) {
      data.hcaptchaSecretKey = hcaptchaSecretKey;
      encryptedFields++;
    }

    const emailProviderConfig = encryptEmailProviderConfig(
      realm.emailProviderConfig,
    );
    if (emailProviderConfig) {
      data.emailProviderConfig =
        emailProviderConfig.config as Prisma.InputJsonValue;
      encryptedFields++;
    }

    if (Object.keys(data).length > 0) {
      await prisma.realm.update({ where: { id: realm.id }, data });
      updatedRealms++;
      console.log(
        `  Encrypted ${Object.keys(data).length} field(s) on realm "${realm.name}"`,
      );
    }
  }

  console.log(
    `Done. Scanned ${realms.length} realm(s), updated ${updatedRealms}, encrypted ${encryptedFields} field(s) total.`,
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
