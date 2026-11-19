/**
 * The instance bootstrap document (the file BOOTSTRAP_FILE names, or
 * BOOTSTRAP_JSON itself): what a fresh instance is set
 * up with at its first start, instead of a person running the setup wizard.
 *
 *   {
 *     "version": 1,
 *     "realms": [ <a realm export document, version 2>, ... ]
 *   }
 *
 * Each realm is the document `GET /admin/realms/{realm}/export` returns (and
 * `POST /admin/realms/import` takes), with two additions for unattended use:
 *
 * - any string may hold `${env:NAME}`, replaced with that environment
 *   variable, so secrets live in a Kubernetes Secret, not in the file
 *   (`$${env:NAME}` keeps the text as is);
 * - a user may carry `initialPassword`, set (hashed) when the realm is
 *   created. Import never carries passwords otherwise.
 *
 * This module only reads and checks the file; nothing here touches the
 * database. Every message names a path in the file, never a value from it.
 */
import { readFileSync } from 'node:fs';
import { INSECURE_ADMIN_PASSWORDS } from '../admin-auth/admin-seed.service.js';
import { isRecord } from '../realms/export/field-codec.js';

/** The bootstrap file format this server reads. */
export const BOOTSTRAP_FILE_VERSION = 1;

/** Realm names a bootstrap file may not use (as in the setup wizard). */
const RESERVED_REALM_NAMES = new Set(['master', 'public']);

/** The shortest `initialPassword` accepted. */
export const MIN_INITIAL_PASSWORD_LENGTH = 12;

/** The shortest plaintext client secret accepted. */
export const MIN_CLIENT_SECRET_LENGTH = 32;

/**
 * The server's own secrets. A bootstrap file cannot copy them into realm
 * data, where an admin could read them back.
 */
const SERVER_SECRET_VARIABLES = new Set([
  'ADMIN_API_KEY',
  'ADMIN_PASSWORD',
  'WEBHOOK_SECRET_KEY',
  'WEBHOOK_ENCRYPTION_SALT',
  'WEBHOOK_SECRET_KEY_PREVIOUS',
  'WEBHOOK_ENCRYPTION_SALT_PREVIOUS',
  'DATABASE_URL',
  'DATABASE_MIGRATION_URL',
  'REDIS_URL',
]);

/** `${env:NAME}`, or `$${env:NAME}` for the literal text. */
const PLACEHOLDER = /\$?\$\{env:([^}]*)\}/g;
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface BootstrapProblem {
  path: string;
  message: string;
}

/** A bootstrap file that cannot be applied, with every problem found. */
export class BootstrapFileError extends Error {
  constructor(
    message: string,
    readonly problems: BootstrapProblem[] = [],
  ) {
    super(
      problems.length
        ? `${message}: ${problems.map((p) => `${p.path}: ${p.message}`).join('; ')}`
        : message,
    );
    this.name = 'BootstrapFileError';
  }
}

/** One realm to create, as the realm importer takes it. */
export interface BootstrapRealm {
  name: string;
  displayName?: string;
  /** The import document, without the bootstrap-only fields. */
  document: Record<string, unknown>;
  /** username → plaintext initial password (never logged). */
  initialPasswords: Map<string, string>;
}

export interface BootstrapPlan {
  realms: BootstrapRealm[];
}

export interface ParseOptions {
  /** Where `${env:NAME}` is looked up. */
  env: Readonly<Record<string, string | undefined>>;
  /** A value the server stores as a client secret hash, kept as is. */
  isSecretHash: (value: string) => boolean;
}

/** Reads the file; the message never quotes its content. */
export function readBootstrapFile(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    const code = (err as { code?: string }).code ?? 'unknown error';
    throw new BootstrapFileError(
      `BOOTSTRAP_FILE ${path} cannot be read (${code})`,
    );
  }
}

/** Parses and checks a bootstrap file; throws BootstrapFileError. */
export function parseBootstrapFile(
  text: string,
  options: ParseOptions,
): BootstrapPlan {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    // JSON.parse quotes the text around the error, which may be a secret.
    const position = /position (\d+)/.exec(String(err))?.[1];
    throw new BootstrapFileError(
      `The bootstrap document is not valid JSON${position ? ` (at character ${position})` : ''}`,
    );
  }

  const problems: BootstrapProblem[] = [];
  const fail = (path: string, message: string) =>
    problems.push({ path, message });

  if (!isRecord(raw)) {
    throw new BootstrapFileError(
      'The bootstrap document must be a JSON object',
    );
  }
  for (const key of Object.keys(raw)) {
    if (key !== 'version' && key !== 'realms') fail(key, 'is not a known key');
  }
  if (raw['version'] !== BOOTSTRAP_FILE_VERSION) {
    fail('version', `must be ${BOOTSTRAP_FILE_VERSION}`);
  }
  const realmsValue = raw['realms'] ?? [];
  if (!Array.isArray(realmsValue)) fail('realms', 'must be an array');
  const realmItems = Array.isArray(realmsValue) ? realmsValue : [];

  const substituted = substitute(realmItems, 'realms', options.env, fail);
  if (problems.length) {
    throw new BootstrapFileError('The bootstrap document is invalid', problems);
  }

  const seen = new Set<string>();
  const realms: BootstrapRealm[] = [];
  (substituted as unknown[]).forEach((item, i) => {
    const path = `realms[${i}]`;
    const realm = checkRealm(item, path, options, fail);
    if (!realm) return;
    if (seen.has(realm.name)) {
      fail(`${path}.realm.name`, `'${realm.name}' is declared twice`);
      return;
    }
    seen.add(realm.name);
    realms.push(realm);
  });

  if (problems.length) {
    throw new BootstrapFileError('The bootstrap document is invalid', problems);
  }
  return { realms };
}

/** Replaces `${env:NAME}` in every string value (never in keys). */
function substitute(
  value: unknown,
  path: string,
  env: ParseOptions['env'],
  fail: (path: string, message: string) => void,
): unknown {
  if (typeof value === 'string') {
    return value.replace(PLACEHOLDER, (match: string, name: string) => {
      if (match.startsWith('$$')) return match.slice(1);
      if (!VARIABLE_NAME.test(name)) {
        fail(path, `\${env:${name}} is not a valid variable name`);
        return '';
      }
      if (SERVER_SECRET_VARIABLES.has(name)) {
        fail(path, `\${env:${name}} is a server secret and cannot be used`);
        return '';
      }
      const resolved = env[name];
      if (resolved === undefined || resolved === '') {
        fail(path, `\${env:${name}} is not set`);
        return '';
      }
      return resolved;
    });
  }
  if (Array.isArray(value)) {
    return value.map((v, i) => substitute(v, `${path}[${i}]`, env, fail));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        substitute(v, `${path}.${k}`, env, fail),
      ]),
    );
  }
  return value;
}

function checkRealm(
  item: unknown,
  path: string,
  options: ParseOptions,
  fail: (path: string, message: string) => void,
): BootstrapRealm | null {
  if (!isRecord(item) || !isRecord(item['realm'])) {
    fail(path, 'must be a realm export document with a `realm` object');
    return null;
  }
  const version = item['version'];
  if (version !== 2 && version !== '2' && version !== '2.0') {
    fail(`${path}.version`, 'must be 2 (the realm export format)');
  }
  const name = item['realm']['name'];
  if (typeof name !== 'string' || !name) {
    fail(`${path}.realm.name`, 'is required');
    return null;
  }
  if (RESERVED_REALM_NAMES.has(name)) {
    fail(
      `${path}.realm.name`,
      `'${name}' is reserved (the master realm and its admin come from ADMIN_USER and ADMIN_PASSWORD)`,
    );
    return null;
  }
  const displayName = item['realm']['displayName'];

  // Bootstrap-only: users[].initialPassword, taken out before the import.
  const initialPasswords = new Map<string, string>();
  const users = Array.isArray(item['users']) ? item['users'] : [];
  const importUsers = users.map((user: unknown, i: number) => {
    if (!isRecord(user) || !('initialPassword' in user)) return user;
    const { initialPassword, ...rest } = user;
    const at = `${path}.users[${i}].initialPassword`;
    const problem = initialPasswordProblem(initialPassword);
    if (problem) fail(at, problem);
    else if (typeof rest['username'] === 'string') {
      initialPasswords.set(rest['username'], initialPassword as string);
    }
    return rest;
  });

  const clients = Array.isArray(item['clients']) ? item['clients'] : [];
  clients.forEach((client: unknown, i: number) => {
    if (!isRecord(client)) return;
    const problem = clientSecretProblem(client, options.isSecretHash);
    if (problem) fail(`${path}.clients[${i}].clientSecret`, problem);
  });

  return {
    name,
    ...(typeof displayName === 'string' && displayName ? { displayName } : {}),
    document: {
      ...item,
      ...(Array.isArray(item['users']) ? { users: importUsers } : {}),
      // Secrets in a bootstrap file are written by hand (or come from the
      // environment); none was left out on purpose as in an export.
      secretsIncluded: true,
    },
    initialPasswords,
  };
}

function initialPasswordProblem(value: unknown): string | null {
  if (typeof value !== 'string') return 'must be a string';
  if (value.length < MIN_INITIAL_PASSWORD_LENGTH) {
    return `must be at least ${MIN_INITIAL_PASSWORD_LENGTH} characters`;
  }
  if (INSECURE_ADMIN_PASSWORDS.has(value.toLowerCase())) {
    return 'is a default or placeholder value';
  }
  return null;
}

/**
 * A confidential client that authenticates with a secret must be given one:
 * an import without it would leave a client that cannot sign in. A secret
 * written in the file must be strong; a stored hash (from an export made
 * with includeSecrets) is kept as is.
 */
function clientSecretProblem(
  client: Record<string, unknown>,
  isSecretHash: (value: string) => boolean,
): string | null {
  const secret = client['clientSecret'];
  const method = client['tokenEndpointAuthMethod'];
  const usesSecret =
    (client['clientType'] ?? 'CONFIDENTIAL') === 'CONFIDENTIAL' &&
    (method === undefined ||
      method === null ||
      (typeof method === 'string' && method.startsWith('client_secret_')));
  if (secret === undefined || secret === null || secret === '') {
    return usesSecret
      ? 'is required for a confidential client that authenticates with a secret (use ${env:NAME})'
      : null;
  }
  if (typeof secret !== 'string') return 'must be a string';
  if (isSecretHash(secret)) return null;
  if (secret.length < MIN_CLIENT_SECRET_LENGTH) {
    return `must be at least ${MIN_CLIENT_SECRET_LENGTH} characters (openssl rand -hex 32)`;
  }
  if (INSECURE_ADMIN_PASSWORDS.has(secret.toLowerCase())) {
    return 'is a default or placeholder value';
  }
  return null;
}
