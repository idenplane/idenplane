import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { looksEncrypted } from '../crypto/key-ring.js';
import {
  mapSecretStrings,
  type SecretJsonShape,
} from '../crypto/stored-secrets.js';
import { STREAM_HEADERS_SHAPE } from '../events/audit-stream-secrets.js';
import { SSO_CONFIG_SHAPE } from '../organizations/sso-connection-secrets.js';
import { EMAIL_SECRET_FIELDS } from '../realms/realm-secrets.util.js';
import { SMS_SECRET_FIELDS } from '../realms/dto/sms-config.dto.js';

export { looksEncrypted };

/** The advisory lock the sweep takes (an arbitrary constant). */
export const SECRETS_SWEEP_LOCK_KEY = 7_204_311_863;

/** The one EncryptionKeyCheck row. */
export const KEY_CHECK_ID = 'stored-secrets';

/** What the key check row holds, encrypted. */
export const KEY_CHECK_PLAINTEXT = 'idenplane-stored-secrets-key-check-v1';

/** The version of the full sweep below; raise it when a field is added. */
export const SWEEP_VERSION = 1;

/** Rows of a large table (TOTP and SMS factors, NHI keys) per transaction. */
export const SWEEP_BATCH = 2000;

/** Unreadable values named in an error or log line; the rest are counted. */
const MAX_NAMED = 20;

/**
 * Later sweeps revisit TOTP rows created this long before the previous one
 * started: rows written in plaintext by a process of the older version
 * still running during a rolling upgrade.
 */
const TOTP_RESWEEP_MARGIN_MS = 24 * 60 * 60 * 1000;

/** The sweep's transactions wait this long for the lock and run this long. */
const TX_OPTIONS = { maxWait: 120_000, timeout: 300_000 };

/** Set to `true` to start although some secrets decrypt with no key. */
const ACCEPT_UNREADABLE_ENV = 'STORED_SECRETS_ACCEPT_UNREADABLE';

/** Thrown when the configured key is not the one the secrets use. */
export class StoredSecretsKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoredSecretsKeyError';
  }
}

type Tx = Prisma.TransactionClient;

export interface SweepResult {
  /** Secret values written by this run (encrypted or re-encrypted), per table. */
  encrypted: Record<string, number>;
  /** Whether this run wrote the key check row. */
  keyCheckCreated: boolean;
  /** A previous key was configured, and this run completed the rotation. */
  rotated: boolean;
  /** Values no configured key decrypts, left in place (escape hatch only). */
  unreadable: string[];
}

/** One pass over the stored secrets. */
interface Pass {
  /** A previous key is configured: move every value to the current key. */
  rotating: boolean;
  /** Classify only: count what would change, write nothing. */
  dryRun: boolean;
  /** Values written (or, dry, to write), per table. */
  written: Record<string, number>;
  /** Where a value no configured key decrypts was found. */
  unreadable: string[];
  /** Only TOTP rows created since then (later non-rotating sweeps). */
  since?: Date;
}

/** What the key check row says about the configured keys. */
interface KeyCheckState {
  keyCheckCreated: boolean;
  sweepVersion: number;
  sweptAt: Date | null;
}

/**
 * Encrypts at rest, on start, the secrets stored in plaintext before this
 * version (or written by an older process during a rolling upgrade),
 * refuses to start with a key other than the one they are encrypted with,
 * and moves every secret to the current key after a key rotation
 * (WEBHOOK_SECRET_KEY_PREVIOUS).
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
 * - it is idempotent: a value that already decrypts with the current key is
 *   left alone, so a second pass writes nothing;
 * - it never loses a secret: the key check row is decrypted first, and on
 *   the first pass, before that row exists, webhook secrets and NHI private
 *   keys (always encrypted) must decrypt. With the wrong key, ciphertext
 *   would look like plaintext and be encrypted again; instead the start
 *   fails, and nothing is written.
 *
 * Key rotation (a previous key is configured):
 *
 * - the key check row must decrypt with the current or the previous key,
 *   or the start fails before anything is written;
 * - a read-only pass first visits every encrypted value. A value that is
 *   ciphertext under neither key fails the start, still with nothing
 *   written, unless STORED_SECRETS_ACCEPT_UNREADABLE=true (it is then left
 *   as it is, and logged);
 * - the writing pass re-encrypts every value under the previous key with the
 *   current one, in batches for the large tables, then the key check row is
 *   rewritten under the current key, last. A run cut short leaves the row
 *   under the previous key, so the next start does it all again; values
 *   already moved are skipped.
 *
 * Reads stay tolerant of plaintext and of the previous key
 * (CryptoService.decryptSecret), so a row this pass has not reached yet
 * keeps working.
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
      const started = Date.now();
      const result = await this.run();
      const total = Object.values(result.encrypted).reduce((a, b) => a + b, 0);
      if (total > 0) {
        this.logger.log(
          `${result.rotated ? 'Re-encrypted with the current key' : 'Encrypted at rest'} ${total} stored secret(s) in ${Date.now() - started} ms: ${JSON.stringify(result.encrypted)}`,
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

  /** One full run: key check, then (rotating) a dry pass, then the sweep. */
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

    const rotating = this.crypto.hasPreviousKey();
    const startedAt = new Date();

    const check = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx);
      return this.checkKey(tx, rotating);
    }, TX_OPTIONS);

    const since =
      !rotating && check.sweepVersion >= SWEEP_VERSION && check.sweptAt
        ? new Date(check.sweptAt.getTime() - TOTP_RESWEEP_MARGIN_MS)
        : undefined;
    const result: SweepResult = {
      encrypted: {},
      keyCheckCreated: check.keyCheckCreated,
      rotated: false,
      unreadable: [],
    };

    if (rotating) {
      // Classify every value before writing any: a value neither key
      // decrypts must stop the start with nothing rewritten.
      const dry: Pass = {
        rotating,
        dryRun: true,
        written: {},
        unreadable: [],
      };
      if (await this.pass(dry, startedAt)) return result;
      this.gate(dry);
      result.unreadable = dry.unreadable;
    }

    const pass: Pass = {
      rotating,
      dryRun: false,
      written: result.encrypted,
      unreadable: [],
      since,
    };
    if (await this.pass(pass, startedAt)) return result;
    if (!rotating) result.unreadable = pass.unreadable;
    if (result.unreadable.length > 0) {
      this.logger.error(
        `${result.unreadable.length} stored secret(s) decrypt ${keysPhrase(rotating)} and were left as they are (${ACCEPT_UNREADABLE_ENV}=true); they stay unusable until set again: ${listed(result.unreadable)}`,
      );
    }

    // Last: the key check row under the current key, and the sweep marker.
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx);
      let keyCheck: string | undefined;
      if (rotating) {
        const row = await tx.encryptionKeyCheck.findUnique({
          where: { id: KEY_CHECK_ID },
          select: { keyCheck: true },
        });
        if (row && this.crypto.open(row.keyCheck)?.slot !== 'current') {
          keyCheck = this.crypto.encrypt(KEY_CHECK_PLAINTEXT);
        }
      }
      await tx.encryptionKeyCheck.update({
        where: { id: KEY_CHECK_ID },
        data: {
          sweepVersion: SWEEP_VERSION,
          sweptAt: startedAt,
          ...(keyCheck ? { keyCheck } : {}),
        },
      });
    }, TX_OPTIONS);

    if (rotating) {
      result.rotated = true;
      this.logger.warn(
        `Key rotation complete: every stored secret is encrypted with the current key (id ${this.crypto.currentKeyId}). ` +
          `WEBHOOK_SECRET_KEY_PREVIOUS (key id ${this.crypto.previousKeyId}) and WEBHOOK_ENCRYPTION_SALT_PREVIOUS are no longer needed: ` +
          'once every replica runs with the current key, remove them and restart.',
      );
    }
    return result;
  }

  /**
   * One pass over every stored secret: configuration tables in one
   * transaction, then the large tables in batches. True when another
   * process completed a full sweep while this one ran (nothing left to do).
   */
  private async pass(pass: Pass, startedAt: Date): Promise<boolean> {
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx);
      await this.sweepConfiguration(tx, pass);
      this.gateWrites(pass);
    }, TX_OPTIONS);

    const batched: Array<
      (tx: Tx, cursor: string | undefined) => Promise<string | undefined>
    > = [(tx, cursor) => this.sweepCredentialBatch(tx, cursor, pass)];
    if (pass.rotating) {
      batched.push((tx, cursor) => this.sweepNhiBatch(tx, cursor, pass));
    }
    for (const step of batched) {
      let cursor: string | undefined;
      for (;;) {
        const page = await this.prisma.$transaction(async (tx) => {
          await this.lock(tx);
          // Several processes start together: once another one has
          // completed a full pass while this one was running, this pass can
          // stop.
          if (await this.supersededSince(tx, startedAt)) {
            return { done: true as const };
          }
          const next = await step(tx, cursor);
          this.gateWrites(pass);
          return { next };
        }, TX_OPTIONS);
        if ('done' in page) return true;
        if (!page.next) break;
        cursor = page.next;
      }
    }
    return false;
  }

  /** True once another process completed a full sweep after `startedAt`. */
  private async supersededSince(tx: Tx, startedAt: Date): Promise<boolean> {
    const state = await tx.encryptionKeyCheck.findUnique({
      where: { id: KEY_CHECK_ID },
      select: { sweepVersion: true, updatedAt: true, keyCheck: true },
    });
    return (
      !!state &&
      state.sweepVersion >= SWEEP_VERSION &&
      state.updatedAt >= startedAt &&
      this.crypto.open(state.keyCheck)?.slot === 'current'
    );
  }

  /**
   * In a writing pass, throw (rolling the transaction back) as soon as a
   * value no key decrypts was found, unless the escape hatch is set.
   */
  private gateWrites(pass: Pass): void {
    if (!pass.dryRun) this.gate(pass);
  }

  /** Throw for unreadable values, unless the escape hatch is set. */
  private gate(pass: Pass): void {
    if (pass.unreadable.length === 0) return;
    if (process.env[ACCEPT_UNREADABLE_ENV] === 'true') return;
    throw new StoredSecretsKeyError(
      `${pass.unreadable.length} stored secret(s) are encrypted but decrypt ${keysPhrase(pass.rotating)}: ${listed(pass.unreadable)}. ` +
        'Configure the key they were encrypted with (as WEBHOOK_SECRET_KEY_PREVIOUS / WEBHOOK_ENCRYPTION_SALT_PREVIOUS during a rotation); refusing to start, and these values were not rewritten. ' +
        `If they are lost for good, start once with ${ACCEPT_UNREADABLE_ENV}=true to leave them as they are, then set each one again.`,
    );
  }

  private async lock(tx: Tx): Promise<void> {
    await tx.$executeRawUnsafe(
      `SELECT pg_advisory_xact_lock(${SECRETS_SWEEP_LOCK_KEY})`,
    );
  }

  /** True if `value` decrypts with a configured key. */
  private decrypts(value: string): boolean {
    return this.crypto.open(value) !== undefined;
  }

  /**
   * Prove the configured key is the one the stored secrets use (or, during
   * a rotation, the previous one), or throw. Writes the key check row on
   * the first pass.
   */
  private async checkKey(tx: Tx, rotating: boolean): Promise<KeyCheckState> {
    const row = await tx.encryptionKeyCheck.findUnique({
      where: { id: KEY_CHECK_ID },
    });
    if (row) {
      const opened = this.crypto.open(row.keyCheck);
      if (opened?.plaintext !== KEY_CHECK_PLAINTEXT) {
        throw new StoredSecretsKeyError(
          rotating
            ? 'Neither WEBHOOK_SECRET_KEY nor WEBHOOK_SECRET_KEY_PREVIOUS (with their salts) is the key the stored secrets are encrypted with. ' +
                'Set WEBHOOK_SECRET_KEY_PREVIOUS and WEBHOOK_ENCRYPTION_SALT_PREVIOUS to the values in use before the rotation; refusing to start, and nothing was rewritten.'
            : 'WEBHOOK_SECRET_KEY / WEBHOOK_ENCRYPTION_SALT are not the ones the stored secrets were encrypted with. ' +
                'Restore the previous values (back them up with the database), or to rotate the key set the old ones as WEBHOOK_SECRET_KEY_PREVIOUS / WEBHOOK_ENCRYPTION_SALT_PREVIOUS; refusing to start so that no secret is read or rewritten with the wrong key.',
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
    if (rotating && probes.length > 0) {
      // Without a key check row there is no proof of which key is which,
      // and legacy plaintext cannot be told from ciphertext of a third key.
      throw new StoredSecretsKeyError(
        'Encryption at rest has never run on this database, so the key cannot be rotated yet. ' +
          'Start once without WEBHOOK_SECRET_KEY_PREVIOUS / WEBHOOK_ENCRYPTION_SALT_PREVIOUS, with WEBHOOK_SECRET_KEY set to the key the secrets are encrypted with; then rotate.',
      );
    }
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

  /**
   * The value to store for one secret, and whether it differs:
   *
   * - ciphertext under the current key: kept;
   * - ciphertext under the previous key: re-encrypted with the current one;
   * - anything else that is ciphertext (an envelope; while rotating, also a
   *   legacy-shaped value, or any value of a column that is always
   *   encrypted): unreadable, recorded under `what` and kept;
   * - otherwise legacy plaintext: encrypted (never for `strict` columns,
   *   which are always ciphertext).
   */
  private reseal(
    pass: Pass,
    what: string,
    value: string,
    strict = false,
  ): { value: string; changed: boolean } {
    const opened = this.crypto.open(value);
    if (opened?.slot === 'current') return { value, changed: false };
    if (opened) {
      return { value: this.crypto.encrypt(opened.plaintext), changed: true };
    }
    if (
      this.crypto.isEnvelope(value) ||
      (pass.rotating && (strict || looksEncrypted(value)))
    ) {
      pass.unreadable.push(what);
      return { value, changed: false };
    }
    if (strict) return { value, changed: false };
    return { value: this.crypto.encrypt(value), changed: true };
  }

  /** Count values written. */
  private count(pass: Pass, table: string, n: number): void {
    if (n > 0) pass.written[table] = (pass.written[table] ?? 0) + n;
  }

  /** The JSON with its secrets resealed, or undefined if none changed. */
  private resealJson(
    pass: Pass,
    what: string,
    json: unknown,
    shape: SecretJsonShape,
  ): unknown {
    let changed = 0;
    const out = mapSecretStrings(json, shape, (value) => {
      const s = this.reseal(pass, what, value);
      if (s.changed) changed++;
      return s.value;
    });
    return changed > 0 ? out : undefined;
  }

  private async sweepConfiguration(tx: Tx, pass: Pass): Promise<void> {
    // ── Single string columns: compare-and-set on the value read ──
    for (const idp of await tx.identityProvider.findMany({
      where: { clientSecret: { not: '' } },
      select: { id: true, clientSecret: true },
    })) {
      const s = this.reseal(
        pass,
        `identity_providers ${idp.id} clientSecret`,
        idp.clientSecret,
      );
      if (!s.changed || pass.dryRun) continue;
      const { count: n } = await tx.identityProvider.updateMany({
        where: { id: idp.id, clientSecret: idp.clientSecret },
        data: { clientSecret: s.value },
      });
      this.count(pass, 'identity_providers', n);
    }

    for (const f of await tx.userFederation.findMany({
      where: { bindCredential: { not: '' } },
      select: { id: true, bindCredential: true },
    })) {
      const s = this.reseal(
        pass,
        `user_federations ${f.id} bindCredential`,
        f.bindCredential,
      );
      if (!s.changed || pass.dryRun) continue;
      const { count: n } = await tx.userFederation.updateMany({
        where: { id: f.id, bindCredential: f.bindCredential },
        data: { bindCredential: s.value },
      });
      this.count(pass, 'user_federations', n);
    }

    for (const key of await tx.realmSigningKey.findMany({
      select: { id: true, privateKey: true },
    })) {
      if (!key.privateKey) continue;
      const s = this.reseal(
        pass,
        `realm_signing_keys ${key.id} privateKey`,
        key.privateKey,
      );
      if (!s.changed || pass.dryRun) continue;
      const { count: n } = await tx.realmSigningKey.updateMany({
        where: { id: key.id, privateKey: key.privateKey },
        data: { privateKey: s.value },
      });
      this.count(pass, 'realm_signing_keys', n);
    }

    if (pass.rotating) {
      // Always encrypted, so only a rotation has anything to do here.
      for (const hook of await tx.webhook.findMany({
        select: { id: true, secret: true },
      })) {
        const s = this.reseal(
          pass,
          `webhooks ${hook.id} secret`,
          hook.secret,
          true,
        );
        if (!s.changed || pass.dryRun) continue;
        const { count: n } = await tx.webhook.updateMany({
          where: { id: hook.id, secret: hook.secret },
          data: { secret: s.value },
        });
        this.count(pass, 'webhooks', n);
      }
    }

    // ── JSON columns: compare-and-set on updatedAt ──
    for (const stream of await tx.auditLogStream.findMany({
      where: { httpHeaders: { not: Prisma.DbNull } },
      select: { id: true, httpHeaders: true, updatedAt: true },
    })) {
      const sealed = this.resealJson(
        pass,
        `audit_log_streams ${stream.id} httpHeaders`,
        stream.httpHeaders,
        STREAM_HEADERS_SHAPE,
      );
      if (sealed === undefined || pass.dryRun) {
        continue;
      }
      const { count: n } = await tx.auditLogStream.updateMany({
        where: { id: stream.id, updatedAt: stream.updatedAt },
        data: { httpHeaders: sealed as Prisma.InputJsonValue },
      });
      this.count(pass, 'audit_log_streams', n);
    }

    for (const conn of await tx.organizationSsoConnection.findMany({
      select: { id: true, config: true, updatedAt: true },
    })) {
      const sealed = this.resealJson(
        pass,
        `organization_sso_connections ${conn.id} config`,
        conn.config,
        SSO_CONFIG_SHAPE,
      );
      if (sealed === undefined || pass.dryRun) {
        continue;
      }
      const { count: n } = await tx.organizationSsoConnection.updateMany({
        where: { id: conn.id, updatedAt: conn.updatedAt },
        data: { config: sealed as Prisma.InputJsonValue },
      });
      this.count(pass, 'organization_sso_connections', n);
    }

    for (const state of await tx.wizardState.findMany({
      select: { id: true, smtpConfig: true, updatedAt: true },
    })) {
      const config = state.smtpConfig;
      if (!isRecord(config) || typeof config['password'] !== 'string') {
        continue;
      }
      const s = this.reseal(
        pass,
        `wizard_states ${state.id} smtpConfig.password`,
        config['password'],
      );
      if (!s.changed || pass.dryRun) continue;
      const { count: n } = await tx.wizardState.updateMany({
        where: { id: state.id, updatedAt: state.updatedAt },
        data: { smtpConfig: { ...config, password: s.value } },
      });
      this.count(pass, 'wizard_states', n);
    }

    // ── Realm secrets (encrypted on write since an earlier release; rows
    // from before it, or written by the setup wizard, may be plaintext) ──
    for (const realm of await tx.realm.findMany({
      select: {
        id: true,
        name: true,
        updatedAt: true,
        smtpPassword: true,
        recaptchaSecretKey: true,
        hcaptchaSecretKey: true,
        emailProviderConfig: true,
        smsProviderConfig: true,
      },
    })) {
      const where = `realms ${realm.name}`;
      const data: Prisma.RealmUpdateManyMutationInput = {};
      let changed = 0;
      for (const field of [
        'smtpPassword',
        'recaptchaSecretKey',
        'hcaptchaSecretKey',
      ] as const) {
        const value = realm[field];
        if (!value) continue;
        const s = this.reseal(pass, `${where} ${field}`, value);
        if (s.changed) {
          data[field] = s.value;
          changed++;
        }
      }
      const email = this.resealSections(
        pass,
        `${where} emailProviderConfig`,
        realm.emailProviderConfig,
      );
      if (email) {
        data.emailProviderConfig = email.config as Prisma.InputJsonValue;
        changed += email.changed;
      }
      const sms = this.resealFields(
        pass,
        `${where} smsProviderConfig`,
        realm.smsProviderConfig,
        SMS_SECRET_FIELDS,
      );
      if (sms) {
        data.smsProviderConfig = sms.config as Prisma.InputJsonValue;
        changed += sms.changed;
      }
      if (changed === 0 || pass.dryRun) continue;
      const { count: n } = await tx.realm.updateMany({
        where: { id: realm.id, updatedAt: realm.updatedAt },
        data,
      });
      if (n > 0) this.count(pass, 'realms', changed);
    }
  }

  /** emailProviderConfig with each provider's secret resealed. */
  private resealSections(
    pass: Pass,
    what: string,
    config: unknown,
  ): { config: Record<string, unknown>; changed: number } | undefined {
    if (!isRecord(config)) return undefined;
    const out: Record<string, unknown> = { ...config };
    let changed = 0;
    for (const [section, field] of Object.entries(EMAIL_SECRET_FIELDS)) {
      const sealed = this.resealFields(
        pass,
        `${what}.${section}`,
        config[section],
        [field],
      );
      if (sealed) {
        out[section] = sealed.config;
        changed += sealed.changed;
      }
    }
    return changed > 0 ? { config: out, changed } : undefined;
  }

  /** `config` with its `fields` resealed, or undefined if none changed. */
  private resealFields(
    pass: Pass,
    what: string,
    config: unknown,
    fields: readonly string[],
  ): { config: Record<string, unknown>; changed: number } | undefined {
    if (!isRecord(config)) return undefined;
    const out: Record<string, unknown> = { ...config };
    let changed = 0;
    for (const field of fields) {
      const value = out[field];
      if (typeof value !== 'string' || !value) continue;
      const s = this.reseal(pass, `${what}.${field}`, value);
      if (s.changed) {
        out[field] = s.value;
        changed++;
      }
    }
    return changed > 0 ? { config: out, changed } : undefined;
  }

  /**
   * One batch of user credentials, by id: TOTP seeds (legacy plaintext is
   * encrypted) and, while rotating, the phone numbers of SMS factors.
   * Returns the cursor of the next batch, if any.
   */
  private async sweepCredentialBatch(
    tx: Tx,
    cursor: string | undefined,
    pass: Pass,
  ): Promise<string | undefined> {
    const rows = await tx.userCredential.findMany({
      where: {
        ...(pass.rotating
          ? { type: { in: ['totp', 'sms'] } }
          : { type: 'totp', secretKey: { not: '' } }),
        ...(cursor ? { id: { gt: cursor } } : {}),
        ...(pass.since ? { createdAt: { gte: pass.since } } : {}),
      },
      select: { id: true, type: true, secretKey: true, phoneNumber: true },
      orderBy: { id: 'asc' },
      take: SWEEP_BATCH,
    });
    const seeds: CasRow[] = [];
    const phones: CasRow[] = [];
    for (const row of rows) {
      if (row.type === 'totp' && row.secretKey) {
        const s = this.reseal(
          pass,
          `user_credentials ${row.id} secretKey`,
          row.secretKey,
        );
        if (s.changed) seeds.push({ id: row.id, prev: row.secretKey, ...s });
      }
      if (row.type === 'sms' && row.phoneNumber) {
        const s = this.reseal(
          pass,
          `user_credentials ${row.id} phoneNumber`,
          row.phoneNumber,
          true,
        );
        if (s.changed) phones.push({ id: row.id, prev: row.phoneNumber, ...s });
      }
    }
    if (!pass.dryRun) {
      this.count(
        pass,
        'user_credentials',
        (await casUpdate(tx, 'user_credentials', 'secret_key', seeds)) +
          (await casUpdate(tx, 'user_credentials', 'phone_number', phones)),
      );
    }
    return rows.length === SWEEP_BATCH ? rows[rows.length - 1].id : undefined;
  }

  /** One batch of NHI private keys (always encrypted; rotation only). */
  private async sweepNhiBatch(
    tx: Tx,
    cursor: string | undefined,
    pass: Pass,
  ): Promise<string | undefined> {
    const rows = await tx.nhiCredential.findMany({
      where: {
        privateKeyPem: { not: null },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: { id: true, privateKeyPem: true },
      orderBy: { id: 'asc' },
      take: SWEEP_BATCH,
    });
    const keys: CasRow[] = [];
    for (const row of rows) {
      const s = this.reseal(
        pass,
        `nhi_credentials ${row.id} privateKeyPem`,
        row.privateKeyPem!,
        true,
      );
      if (s.changed) keys.push({ id: row.id, prev: row.privateKeyPem!, ...s });
    }
    if (!pass.dryRun) {
      this.count(
        pass,
        'nhi_credentials',
        await casUpdate(tx, 'nhi_credentials', 'private_key_pem', keys),
      );
    }
    return rows.length === SWEEP_BATCH ? rows[rows.length - 1].id : undefined;
  }
}

/** A row to rewrite: its id, the value read, and the value to store. */
interface CasRow {
  id: string;
  prev: string;
  value: string;
}

/**
 * Rewrite a batch in one statement, each row only if its column still holds
 * the value read (compare-and-set). Returns the number of rows written.
 * `table` and `column` are constants of this file, never input.
 */
async function casUpdate(
  tx: Tx,
  table: 'user_credentials' | 'nhi_credentials',
  column: 'secret_key' | 'phone_number' | 'private_key_pem',
  rows: CasRow[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const values = Prisma.join(
    rows.map(
      (r) => Prisma.sql`(${r.id}::text, ${r.prev}::text, ${r.value}::text)`,
    ),
  );
  return tx.$executeRaw`
    UPDATE ${Prisma.raw(`"${table}"`)} AS t
       SET ${Prisma.raw(`"${column}"`)} = v.next
      FROM (VALUES ${values}) AS v(id, prev, next)
     WHERE t.id = v.id AND t.${Prisma.raw(`"${column}"`)} = v.prev`;
}

/** Which keys a value failed to decrypt with, for messages. */
function keysPhrase(rotating: boolean): string {
  return rotating
    ? 'with neither WEBHOOK_SECRET_KEY nor WEBHOOK_SECRET_KEY_PREVIOUS'
    : 'with no configured key (WEBHOOK_SECRET_KEY)';
}

/** The first MAX_NAMED locations, and how many more. */
function listed(locations: string[]): string {
  const more = locations.length - MAX_NAMED;
  return `${locations.slice(0, MAX_NAMED).join(', ')}${more > 0 ? ` and ${more} more` : ''}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
