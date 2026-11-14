import { BadRequestException } from '@nestjs/common';
import type { CryptoService } from './crypto.service.js';
import { SECRET_PLACEHOLDER } from '../realms/secret-placeholder.js';

/**
 * Building blocks for secrets kept in the database, encrypted at rest with
 * CryptoService.encryptSecret (WEBHOOK_SECRET_KEY + WEBHOOK_ENCRYPTION_SALT).
 *
 * - Writes encrypt. The admin API hands a stored secret out as
 *   SECRET_PLACEHOLDER, and the placeholder sent back means "unchanged".
 * - Reads decrypt only where the secret is used. A value that is not
 *   ciphertext is a row written before encryption at rest (legacy
 *   plaintext) and is used as is; SecretsAtRestService encrypts those on
 *   start. That fallback is safe because the same start refuses to run with
 *   a key other than the one the secrets were encrypted with, so ciphertext
 *   can never be mistaken for plaintext.
 *
 * The typed per-model helpers (identity providers, LDAP federation, audit
 * streams, organization SSO, signing keys, TOTP) are built from these.
 */

/**
 * Encrypt a secret for storage. Empty and nullish values stay as they are.
 * The placeholder is refused: on create there is nothing it could keep.
 */
export function sealSecret<T extends string | null | undefined>(
  crypto: CryptoService,
  value: T,
): T {
  if (value && value.includes(SECRET_PLACEHOLDER)) {
    throw new PlaceholderTypedOverError();
  }
  return crypto.encryptSecret(value);
}

/**
 * The value to store for a secret column on update, or undefined to leave
 * the column alone: not sent, or sent back as SECRET_PLACEHOLDER.
 */
export function sealSecretUpdate(
  crypto: CryptoService,
  incoming: string | undefined,
): string | undefined {
  if (incoming === undefined || incoming === SECRET_PLACEHOLDER) {
    return undefined;
  }
  if (incoming.includes(SECRET_PLACEHOLDER)) {
    throw new PlaceholderTypedOverError();
  }
  return crypto.encryptSecret(incoming);
}

/** A stored secret as the admin API shows it. */
export function redactSecret<T extends string | null | undefined>(value: T): T {
  return (value ? SECRET_PLACEHOLDER : value) as T;
}

/** A stored secret in plaintext, for the code that uses it. */
export function openSecret<T extends string | null | undefined>(
  crypto: CryptoService,
  value: T,
): T {
  return crypto.decryptSecret(value);
}

// ─── Secrets inside JSON ─────────────────────────────────────────────────

/** Deeper JSON than this is refused rather than walked. */
export const MAX_SECRET_JSON_DEPTH = 16;

/** A 400: the JSON is too deep to tell its secrets apart safely. */
export class SecretJsonTooDeepError extends BadRequestException {
  constructor() {
    super(`Configuration nests deeper than ${MAX_SECRET_JSON_DEPTH} levels`);
  }
}

/** A 400: a secret still holds the hidden-value marker plus typed text. */
export class PlaceholderTypedOverError extends BadRequestException {
  constructor() {
    super(
      'A secret still contains the hidden-value marker; clear the field before entering a new value',
    );
  }
}

/**
 * Which string values of a JSON document are secrets: `isSecretKey(key)`
 * marks a key's whole subtree secret; `allSecret` marks every string.
 */
export interface SecretJsonShape {
  allSecret?: boolean;
  isSecretKey?: (key: string) => boolean;
}

/**
 * A copy of `value` with every secret string replaced by `onSecret(value,
 * stored)`, `stored` being the string at the same path of `stored` (the
 * value currently in the database), if any. `onSecret` returning undefined
 * drops that key (or array element). Non-secret values are copied.
 */
export function mapSecretStrings(
  value: unknown,
  shape: SecretJsonShape,
  onSecret: (secret: string, stored: unknown) => string | undefined,
  stored?: unknown,
): unknown {
  return walk(value, stored, shape.allSecret === true, 0);

  function walk(
    node: unknown,
    previous: unknown,
    secret: boolean,
    depth: number,
  ): unknown {
    if (depth > MAX_SECRET_JSON_DEPTH) throw new SecretJsonTooDeepError();
    if (typeof node === 'string') {
      return secret ? onSecret(node, previous) : node;
    }
    if (Array.isArray(node)) {
      const prev = Array.isArray(previous) ? previous : [];
      const out: unknown[] = [];
      node.forEach((item, i) => {
        const next = walk(item, prev[i], secret, depth + 1);
        if (next !== undefined) out.push(next);
      });
      return out;
    }
    if (isRecord(node)) {
      const prev = isRecord(previous) ? previous : {};
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(node)) {
        const childSecret =
          secret || (shape.isSecretKey ? shape.isSecretKey(key) : false);
        const next = walk(child, prev[key], childSecret, depth + 1);
        if (next !== undefined) out[key] = next;
      }
      return out;
    }
    return node;
  }
}

/**
 * The JSON to store from what a client sent: secrets encrypted, and a
 * secret sent back as SECRET_PLACEHOLDER keeps the stored value at the same
 * path (or is dropped when nothing is stored there).
 */
export function sealSecretJson(
  crypto: CryptoService,
  incoming: unknown,
  shape: SecretJsonShape,
  stored?: unknown,
): unknown {
  return mapSecretStrings(
    incoming,
    shape,
    (value, previous) => {
      if (value !== SECRET_PLACEHOLDER) {
        if (value.includes(SECRET_PLACEHOLDER)) {
          throw new PlaceholderTypedOverError();
        }
        return crypto.encryptSecret(value);
      }
      // encryptSecret leaves ciphertext as it is and encrypts a legacy
      // plaintext value that is kept.
      return typeof previous === 'string' && previous
        ? crypto.encryptSecret(previous)
        : undefined;
    },
    stored,
  );
}

/** Stored JSON as the admin API shows it: each secret as the placeholder. */
export function redactSecretJson(
  stored: unknown,
  shape: SecretJsonShape,
): unknown {
  return mapSecretStrings(stored, shape, (value) =>
    value ? SECRET_PLACEHOLDER : value,
  );
}

/** Stored JSON with its secrets decrypted, for the code that uses them. */
export function openSecretJson(
  crypto: CryptoService,
  stored: unknown,
  shape: SecretJsonShape,
): unknown {
  return mapSecretStrings(stored, shape, (value) =>
    crypto.decryptSecret(value),
  );
}

/** True when any secret string of the JSON holds the placeholder. */
export function secretJsonHasPlaceholder(
  value: unknown,
  shape: SecretJsonShape,
): boolean {
  let found = false;
  mapSecretStrings(value, shape, (secret) => {
    if (secret.includes(SECRET_PLACEHOLDER)) found = true;
    return secret;
  });
  return found;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
