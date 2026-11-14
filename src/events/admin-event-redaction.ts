import { SENSITIVE_BODY_FIELDS } from '../common/security/sensitive-body-fields.js';
import { redactSecretJson } from '../crypto/stored-secrets.js';
import { SSO_CONFIG_SHAPE } from '../organizations/sso-connection-secrets.js';

/** What a redacted value is replaced with in the admin event trail. */
export const REDACTED = '[REDACTED]';

/** Deeper than this, the rest of a representation is replaced as a whole. */
const MAX_DEPTH = 32;

const SENSITIVE_KEYS: ReadonlySet<string> = new Set<string>(
  SENSITIVE_BODY_FIELDS,
);

/** Lower-cased: a SCIM PATCH operation with this `path` carries a secret. */
const SENSITIVE_PATHS: ReadonlySet<string> = new Set(
  SENSITIVE_BODY_FIELDS.map((k) => k.toLowerCase()),
);

/**
 * A representation as the admin event trail keeps it (every writer goes
 * through EventsService.recordAdminEvent, which applies this):
 *
 * - every key of SENSITIVE_BODY_FIELDS, at any depth, becomes `[REDACTED]`
 *   (`emailProviderConfig` and `smsProviderConfig` as whole objects; SCIM
 *   bodies nest the user under `scimUser`);
 * - a `config` object (organization SSO connections) keeps its shape, with
 *   its secret-named keys as the hidden-value placeholder, as the API shows
 *   it;
 * - a SCIM PATCH operation whose `path` names a secret (`password`) has its
 *   `value` redacted.
 *
 * Pure and idempotent: redacting a redacted value changes nothing, which
 * is how the start-up purge of older rows (AdminEventPurgeService) tells
 * which rows still hold a secret. No regular expression runs on the input.
 */
export function redactAdminRepresentation(value: unknown): unknown {
  return walk(value, 0);
}

function walk(node: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return REDACTED;
  if (Array.isArray(node)) return node.map((item) => walk(item, depth + 1));
  if (!isRecord(node)) return node;
  const path = typeof node['path'] === 'string' ? node['path'] : undefined;
  const secretValue =
    path !== undefined && SENSITIVE_PATHS.has(path.toLowerCase());
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(node)) {
    if (SENSITIVE_KEYS.has(key) || (key === 'value' && secretValue)) {
      out[key] = child === null || child === undefined ? child : REDACTED;
    } else if (key === 'config' && isRecord(child)) {
      out[key] = redactConfig(child);
    } else {
      out[key] = walk(child, depth + 1);
    }
  }
  return out;
}

/**
 * The request path as an admin event keeps it: the organization invitation
 * token of `…/invitations/{token}/accept` is replaced, so the trail never
 * holds a token (it is stored nowhere else but hashed).
 */
export function redactAdminResourcePath(path: string): string {
  const parts = path.split('/');
  for (let i = 1; i + 1 < parts.length; i++) {
    if (parts[i - 1] === 'invitations' && parts[i + 1] === 'accept') {
      parts[i] = REDACTED;
    }
  }
  return parts.join('/');
}

/** A free-form config: its secret-named keys masked, or all of it. */
function redactConfig(config: Record<string, unknown>): unknown {
  try {
    return redactSecretJson(config, SSO_CONFIG_SHAPE);
  } catch {
    // Too deep to tell its secrets apart.
    return REDACTED;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
