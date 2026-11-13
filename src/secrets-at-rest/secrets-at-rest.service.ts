import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import {
  mapSecretStrings,
  type SecretJsonShape,
} from '../crypto/stored-secrets.js';
import { STREAM_HEADERS_SHAPE } from '../events/audit-stream-secrets.js';
import { SSO_CONFIG_SHAPE } from '../organizations/sso-connection-secrets.js';
import { EMAIL_SECRET_FIELDS } from '../realms/realm-secrets.util.js';
import { SMS_SECRET_FIELDS } from '../realms/dto/sms-config.dto.js';

/** The advisory lock the sweep takes (an arbitrary constant). */
export const SECRETS_SWEEP_LOCK_KEY = 7_204_311_863;

/** The one EncryptionKeyCheck row. */
export const KEY_CHECK_ID = 'stored-secrets';

/** What the key check row holds, encrypted. */
export const KEY_CHECK_PLAINTEXT = 'idenplane-stored-secrets-key-check-v1';

/** The version of the full sweep below; raise it when a field is added. */
export const SWEEP_VERSION = 1;

/** TOTP rows read per transaction. */
const TOTP_BATCH = 500;

/**
 * Later sweeps revisit TOTP rows created this long before the previous one
 * started: rows written in plaintext by a process of the older version
 * still running during a rolling upgrade.
 */
const TOTP_RESWEEP_MARGIN_MS = 24 * 60 * 60 * 1000;

/** The sweep's transactions wait this long for the lock and run this long. */
const TX_OPTIONS = { maxWait: 120_000, timeout: 300_000 };

/** Thrown when the configured key is not the one the secrets use. */
export class StoredSecretsKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoredSecretsKeyError';
  }
}

type Tx = Prisma.TransactionClient;

export interface SweepResult {
  /** Secret values encrypted by this run, per table. */
  encrypted: Record<string, number>;
  /** Whether this run wrote the key check row. */
  keyCheckCreated: boolean;
}

/**
 * Encrypts at rest, on start, the secrets stored in plaintext before this
 * version (or written by an older process during a rolling upgrade), and
 * refuses to start with a key other than the one they are encrypted with.
 *
 * Why at start and not in an SQL migration: SQL cannot use the application
 * key. Why it is safe to run on every start of every process
 * (WEB_CONCURRENCY workers, cluster replicas):
 *
 * - each pass runs in a transaction holding a PostgreSQL advisory lock
 *   (transaction-level, so it is released with the pooled connection), so
 *   processes take turns, and each row is written with a compare-and-set on
 *   the value (or `updatedAt`) it read: a secret an admin changed meanwhile
 *   is never overwritten;
 * - it is idempotent: a value that already decrypts is left alone, so a
 *   second pass writes nothing;
 * - it never loses a secret: the key check row is decrypted first, and on
 *   the first pass, before that row exists, webhook secrets and NHI private
 *   keys (always encrypted) must decrypt. With the wrong key, ciphertext
 *   would look like plaintext and be encrypted again; instead the start
 *   fails, and nothing is written.
 *
 * Reads stay tolerant of plaintext (CryptoService.decryptSecret), so a row
 * this pass has not reached yet keeps working.
 */
@Injectable()
export class SecretsAtRestService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SecretsAtRestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const result = await this.run();
      const total = Object.values(result.encrypted).reduce((a, b) => a + b, 0);
      if (total > 0) {
        this.logger.log(
          `Encrypted ${total} stored secret(s) at rest: ${JSON.stringify(result.encrypted)}`,
        );
      }
    } catch (err) {
      this.logger.error(
        `FATAL: stored secrets: ${(err as Error).message}`,
        (err as Error).stack,
      );
      throw err;
    }
  }

  /** One full pass: key check, configuration secrets, then TOTP seeds. */
  async run(): Promise<SweepResult> {
    if (
      !this.crypto.usesConfiguredKey() &&
      process.env['NODE_ENV'] === 'production'
    ) {
      throw new StoredSecretsKeyError(
        'WEBHOOK_SECRET_KEY and WEBHOOK_ENCRYPTION_SALT must be set before stored secrets can be encrypted; refusing to start.',
      );
    }
    if (!this.crypto.usesConfiguredKey()) {
      this.logger.warn(
        'Stored secrets are encrypted with the built-in development key (WEBHOOK_SECRET_KEY is not set). Set a key before storing real secrets: secrets encrypted with this one cannot be read with another.',
      );
    }

    const encrypted: Record<string, number> = {};
    const count = (table: string, n: number) => {
      if (n > 0) encrypted[table] = (encrypted[table] ?? 0) + n;
    };
    const startedAt = new Date();

    const { keyCheckCreated, sweepVersion, sweptAt } =
      await this.prisma.$transaction(async (tx) => {
        await this.lock(tx);
        const check = await this.checkKey(tx);
        await this.sweepConfiguration(tx, count);
        return check;
      }, TX_OPTIONS);

    // TOTP seeds: one row per enrolled user, so in batches. The first
    // complete pass covers every row; later ones only the recent ones.
    const since =
      sweepVersion >= SWEEP_VERSION && sweptAt
        ? new Date(sweptAt.getTime() - TOTP_RESWEEP_MARGIN_MS)
        : undefined;
    let cursor: string | undefined;
    for (;;) {
      const page = await this.prisma.$transaction(async (tx) => {
        await this.lock(tx);
        // Several processes start together: once another one has completed
        // a full pass while this one was running, this pass can stop.
        const state = await tx.encryptionKeyCheck.findUnique({
          where: { id: KEY_CHECK_ID },
          select: { sweepVersion: true, updatedAt: true },
        });
        if (
          state &&
          state.sweepVersion >= SWEEP_VERSION &&
          state.updatedAt >= startedAt
        ) {
          return { next: undefined, done: true };
        }
        return this.sweepTotpBatch(tx, cursor, since, count);
      }, TX_OPTIONS);
      if ('done' in page) return { encrypted, keyCheckCreated };
      if (!page.next) break;
      cursor = page.next;
    }

    await this.prisma.encryptionKeyCheck.update({
      where: { id: KEY_CHECK_ID },
      data: { sweepVersion: SWEEP_VERSION, sweptAt: startedAt },
    });
    return { encrypted, keyCheckCreated };
  }

  private async lock(tx: Tx): Promise<void> {
    await tx.$executeRawUnsafe(
      `SELECT pg_advisory_xact_lock(${SECRETS_SWEEP_LOCK_KEY})`,
    );
  }

  /** True if `value` decrypts with the configured key. */
  private decrypts(value: string): boolean {
    try {
      this.crypto.decrypt(value);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Prove the configured key is the one the stored secrets use, or throw.
   * Writes the key check row on the first pass.
   */
  private async checkKey(tx: Tx): Promise<{
    keyCheckCreated: boolean;
    sweepVersion: number;
    sweptAt: Date | null;
  }> {
    const row = await tx.encryptionKeyCheck.findUnique({
      where: { id: KEY_CHECK_ID },
    });
    if (row) {
      let plaintext: string | undefined;
      try {
        plaintext = this.crypto.decrypt(row.keyCheck);
      } catch {
        plaintext = undefined;
      }
      if (plaintext !== KEY_CHECK_PLAINTEXT) {
        throw new StoredSecretsKeyError(
          'WEBHOOK_SECRET_KEY / WEBHOOK_ENCRYPTION_SALT are not the ones the stored secrets were encrypted with. ' +
            'Restore the previous values (back them up with the database); refusing to start so that no secret is read or rewritten with the wrong key.',
        );
      }
      return {
        keyCheckCreated: false,
        sweepVersion: row.sweepVersion,
        sweptAt: row.sweptAt,
      };
    }

    // First pass: find out whether the key is right before anything is
    // rewritten. Webhook secrets and NHI private keys are always encrypted
    // (CryptoService.encrypt). The realm secrets have been encrypted on write
    // since an earlier release, so a realm value shaped like ciphertext was
    // encrypted with the key of that time; it is a probe too, so that an
    // instance without webhooks is checked as well.
    const probes = await this.firstRunProbes(tx);
    const failed = probes.filter((p) => !this.decrypts(p.value));
    if (
      probes.length > 0 &&
      failed.length === probes.length &&
      process.env['STORED_SECRETS_ACCEPT_KEY'] !== 'true'
    ) {
      throw new StoredSecretsKeyError(
        `None of the ${probes.length} stored secrets that look encrypted (${probes
          .slice(0, 5)
          .map((p) => p.what)
          .join(
            ', ',
          )}${probes.length > 5 ? ', …' : ''}) decrypt with the configured WEBHOOK_SECRET_KEY / WEBHOOK_ENCRYPTION_SALT. ` +
          'Restore the key they were encrypted with; refusing to start so that no secret is encrypted a second time with the wrong key. ' +
          'If this key is right and those values are plaintext that only looks like ciphertext, start once with STORED_SECRETS_ACCEPT_KEY=true.',
      );
    }
    if (failed.length > 0 && failed.length < probes.length) {
      // Some decrypt: the key is right and these rows are damaged (or are
      // plaintext shaped like ciphertext).
      this.logger.error(
        `These stored secrets do not decrypt with the configured key: ${failed.map((f) => f.what).join(', ')}`,
      );
    }
    await tx.encryptionKeyCheck.create({
      data: {
        id: KEY_CHECK_ID,
        keyCheck: this.crypto.encrypt(KEY_CHECK_PLAINTEXT),
      },
    });
    return { keyCheckCreated: true, sweepVersion: 0, sweptAt: null };
  }

  /**
   * Values that should decrypt with the key the secrets were encrypted
   * with: webhook secrets, NHI private keys, and realm secrets shaped like
   * ciphertext.
   */
  private async firstRunProbes(
    tx: Tx,
  ): Promise<Array<{ what: string; value: string }>> {
    const [webhooks, nhi, realms] = await Promise.all([
      tx.webhook.findMany({ select: { id: true, secret: true }, take: 50 }),
      tx.nhiCredential.findMany({
        where: { privateKeyPem: { not: null } },
        select: { id: true, privateKeyPem: true },
        take: 50,
      }),
      tx.realm.findMany({
        select: {
          name: true,
          smtpPassword: true,
          recaptchaSecretKey: true,
          hcaptchaSecretKey: true,
          emailProviderConfig: true,
          smsProviderConfig: true,
        },
      }),
    ]);
    const probes = [
      ...webhooks.map((w) => ({ what: `webhook ${w.id}`, value: w.secret })),
      ...nhi.map((n) => ({
        what: `NHI credential ${n.id}`,
        value: n.privateKeyPem!,
      })),
    ];
    for (const realm of realms) {
      const values: Array<[string, unknown]> = [
        ['smtpPassword', realm.smtpPassword],
        ['recaptchaSecretKey', realm.recaptchaSecretKey],
        ['hcaptchaSecretKey', realm.hcaptchaSecretKey],
      ];
      const email = realm.emailProviderConfig;
      if (isRecord(email)) {
        for (const [section, field] of Object.entries(EMAIL_SECRET_FIELDS)) {
          const values_ = email[section];
          if (isRecord(values_)) {
            values.push([
              `emailProviderConfig.${section}.${field}`,
              values_[field],
            ]);
          }
        }
      }
      const sms = realm.smsProviderConfig;
      if (isRecord(sms)) {
        for (const field of SMS_SECRET_FIELDS) {
          values.push([`smsProviderConfig.${field}`, sms[field]]);
        }
      }
      for (const [field, value] of values) {
        if (typeof value === 'string' && looksEncrypted(value)) {
          probes.push({ what: `realm ${realm.name} ${field}`, value });
        }
      }
    }
    return probes;
  }

  /** encryptSecret, and whether it changed anything. */
  private seal(value: string): { value: string; changed: boolean } {
    const sealed = this.crypto.encryptSecret(value);
    return { value: sealed, changed: sealed !== value };
  }

  /** The JSON with its secrets sealed, or undefined if none changed. */
  private sealJson(json: unknown, shape: SecretJsonShape): unknown {
    let changed = 0;
    const out = mapSecretStrings(json, shape, (value) => {
      const s = this.seal(value);
      if (s.changed) changed++;
      return s.value;
    });
    return changed > 0 ? out : undefined;
  }

  private async sweepConfiguration(
    tx: Tx,
    count: (table: string, n: number) => void,
  ): Promise<void> {
    // ── Single string columns: compare-and-set on the value read ──
    for (const idp of await tx.identityProvider.findMany({
      where: { clientSecret: { not: '' } },
      select: { id: true, clientSecret: true },
    })) {
      const s = this.seal(idp.clientSecret);
      if (!s.changed) continue;
      const { count: n } = await tx.identityProvider.updateMany({
        where: { id: idp.id, clientSecret: idp.clientSecret },
        data: { clientSecret: s.value },
      });
      count('identity_providers', n);
    }

    for (const f of await tx.userFederation.findMany({
      where: { bindCredential: { not: '' } },
      select: { id: true, bindCredential: true },
    })) {
      const s = this.seal(f.bindCredential);
      if (!s.changed) continue;
      const { count: n } = await tx.userFederation.updateMany({
        where: { id: f.id, bindCredential: f.bindCredential },
        data: { bindCredential: s.value },
      });
      count('user_federations', n);
    }

    for (const key of await tx.realmSigningKey.findMany({
      select: { id: true, privateKey: true },
    })) {
      if (!key.privateKey) continue;
      const s = this.seal(key.privateKey);
      if (!s.changed) continue;
      const { count: n } = await tx.realmSigningKey.updateMany({
        where: { id: key.id, privateKey: key.privateKey },
        data: { privateKey: s.value },
      });
      count('realm_signing_keys', n);
    }

    // ── JSON columns: compare-and-set on updatedAt ──
    for (const stream of await tx.auditLogStream.findMany({
      where: { httpHeaders: { not: Prisma.DbNull } },
      select: { id: true, httpHeaders: true, updatedAt: true },
    })) {
      const sealed = this.sealJson(stream.httpHeaders, STREAM_HEADERS_SHAPE);
      if (sealed === undefined) continue;
      const { count: n } = await tx.auditLogStream.updateMany({
        where: { id: stream.id, updatedAt: stream.updatedAt },
        data: { httpHeaders: sealed as Prisma.InputJsonValue },
      });
      count('audit_log_streams', n);
    }

    for (const conn of await tx.organizationSsoConnection.findMany({
      select: { id: true, config: true, updatedAt: true },
    })) {
      const sealed = this.sealJson(conn.config, SSO_CONFIG_SHAPE);
      if (sealed === undefined) continue;
      const { count: n } = await tx.organizationSsoConnection.updateMany({
        where: { id: conn.id, updatedAt: conn.updatedAt },
        data: { config: sealed as Prisma.InputJsonValue },
      });
      count('organization_sso_connections', n);
    }

    for (const state of await tx.wizardState.findMany({
      select: { id: true, smtpConfig: true, updatedAt: true },
    })) {
      const config = state.smtpConfig;
      if (!isRecord(config) || typeof config['password'] !== 'string') {
        continue;
      }
      const s = this.seal(config['password']);
      if (!s.changed) continue;
      const { count: n } = await tx.wizardState.updateMany({
        where: { id: state.id, updatedAt: state.updatedAt },
        data: { smtpConfig: { ...config, password: s.value } },
      });
      count('wizard_states', n);
    }

    // ── Realm secrets (encrypted on write since an earlier release; rows
    // from before it, or written by the setup wizard, may be plaintext) ──
    for (const realm of await tx.realm.findMany({
      select: {
        id: true,
        updatedAt: true,
        smtpPassword: true,
        recaptchaSecretKey: true,
        hcaptchaSecretKey: true,
        emailProviderConfig: true,
        smsProviderConfig: true,
      },
    })) {
      const data: Prisma.RealmUpdateManyMutationInput = {};
      let changed = 0;
      for (const field of [
        'smtpPassword',
        'recaptchaSecretKey',
        'hcaptchaSecretKey',
      ] as const) {
        const value = realm[field];
        if (!value) continue;
        const s = this.seal(value);
        if (s.changed) {
          data[field] = s.value;
          changed++;
        }
      }
      const email = this.sealSections(realm.emailProviderConfig);
      if (email) {
        data.emailProviderConfig = email.config as Prisma.InputJsonValue;
        changed += email.changed;
      }
      const sms = this.sealFields(realm.smsProviderConfig, SMS_SECRET_FIELDS);
      if (sms) {
        data.smsProviderConfig = sms.config as Prisma.InputJsonValue;
        changed += sms.changed;
      }
      if (changed === 0) continue;
      const { count: n } = await tx.realm.updateMany({
        where: { id: realm.id, updatedAt: realm.updatedAt },
        data,
      });
      if (n > 0) count('realms', changed);
    }
  }

  /** emailProviderConfig with each provider's secret sealed. */
  private sealSections(
    config: unknown,
  ): { config: Record<string, unknown>; changed: number } | undefined {
    if (!isRecord(config)) return undefined;
    const out: Record<string, unknown> = { ...config };
    let changed = 0;
    for (const [section, field] of Object.entries(EMAIL_SECRET_FIELDS)) {
      const sealed = this.sealFields(config[section], [field]);
      if (sealed) {
        out[section] = sealed.config;
        changed += sealed.changed;
      }
    }
    return changed > 0 ? { config: out, changed } : undefined;
  }

  /** `config` with its `fields` sealed, or undefined if none changed. */
  private sealFields(
    config: unknown,
    fields: readonly string[],
  ): { config: Record<string, unknown>; changed: number } | undefined {
    if (!isRecord(config)) return undefined;
    const out: Record<string, unknown> = { ...config };
    let changed = 0;
    for (const field of fields) {
      const value = out[field];
      if (typeof value !== 'string' || !value) continue;
      const s = this.seal(value);
      if (s.changed) {
        out[field] = s.value;
        changed++;
      }
    }
    return changed > 0 ? { config: out, changed } : undefined;
  }

  private async sweepTotpBatch(
    tx: Tx,
    cursor: string | undefined,
    since: Date | undefined,
    count: (table: string, n: number) => void,
  ): Promise<{ next?: string }> {
    const rows = await tx.userCredential.findMany({
      where: {
        type: 'totp',
        secretKey: { not: '' },
        ...(cursor ? { id: { gt: cursor } } : {}),
        ...(since ? { createdAt: { gte: since } } : {}),
      },
      select: { id: true, secretKey: true },
      orderBy: { id: 'asc' },
      take: TOTP_BATCH,
    });
    for (const row of rows) {
      const s = this.seal(row.secretKey);
      if (!s.changed) continue;
      const { count: n } = await tx.userCredential.updateMany({
        where: { id: row.id, secretKey: row.secretKey },
        data: { secretKey: s.value },
      });
      count('user_credentials', n);
    }
    return rows.length === TOTP_BATCH ? { next: rows[rows.length - 1].id } : {};
  }
}

/**
 * Shaped like CryptoService.encrypt output: canonical base64 of at least
 * IV (12) + tag (16) + 1 bytes. Checked without a regular expression.
 */
export function looksEncrypted(value: string): boolean {
  if (value.length < 40 || value.length % 4 !== 0) return false;
  const bytes = Buffer.from(value, 'base64');
  return bytes.length >= 29 && bytes.toString('base64') === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
