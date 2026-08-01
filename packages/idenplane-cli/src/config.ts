import { homedir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import type { CliConfig } from './types.js';

const CONFIG_DIR = join(homedir(), '.idenplane');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const KEY_FILE = join(CONFIG_DIR, 'key');

// Legacy path used before the AuthMe → Idenplane rename. We read from it as a
// fallback so users who upgrade do not have to re-login. First successful read
// triggers a migration to the new path; the legacy file is left in place.
const LEGACY_CONFIG_FILE = join(homedir(), '.authme', 'config.json');

const ENVELOPE_VERSION = 1;
const CIPHER_ALGORITHM = 'aes-256-gcm';

/** On-disk shape of config.json: secrets encrypted, everything else plain. */
interface EncryptedEnvelope {
  version: typeof ENVELOPE_VERSION;
  serverUrl: string;
  defaultRealm?: string;
  iv: string;
  authTag: string;
  ciphertext: string;
}

interface Secrets {
  accessToken: string;
  apiKey?: string;
}

function isEncryptedEnvelope(value: unknown): value is EncryptedEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>)['version'] === ENVELOPE_VERSION &&
    typeof (value as Record<string, unknown>)['ciphertext'] === 'string'
  );
}

/**
 * accessToken/apiKey are encrypted at rest with AES-256-GCM (key below)
 * rather than sitting in cleartext JSON, so a backup tool, a stray `cat`, or
 * a screen-share of the file doesn't hand over the admin credential.
 *
 * This does NOT protect against another process running as the same OS
 * user — that process can read the key file too. Closing that gap needs
 * OS-keychain integration (Keychain/DPAPI/libsecret), which pulls in a
 * native dependency that needs per-platform CI; deliberately deferred.
 */
function getOrCreateKey(): Buffer {
  if (existsSync(KEY_FILE)) {
    return Buffer.from(readFileSync(KEY_FILE, 'utf-8').trim(), 'base64');
  }
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  const key = randomBytes(32);
  writeFileSync(KEY_FILE, key.toString('base64'), { mode: 0o600 });
  return key;
}

function encryptSecrets(secrets: Secrets): Pick<EncryptedEnvelope, 'iv' | 'authTag' | 'ciphertext'> {
  const key = getOrCreateKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(CIPHER_ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(secrets), 'utf-8'),
    cipher.final(),
  ]);
  return {
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

function decryptSecrets(envelope: EncryptedEnvelope): Secrets {
  const key = getOrCreateKey();
  const decipher = createDecipheriv(CIPHER_ALGORITHM, key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString('utf-8')) as Secrets;
}

export function loadConfig(): CliConfig | null {
  const file = existsSync(CONFIG_FILE)
    ? CONFIG_FILE
    : existsSync(LEGACY_CONFIG_FILE)
      ? LEGACY_CONFIG_FILE
      : null;
  if (!file) return null;

  const raw = readFileSync(file, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `Config file at ${file} contains invalid JSON. ` +
        'Fix or remove it and run `idenplane login` again.',
    );
  }

  const config: CliConfig = isEncryptedEnvelope(parsed)
    ? { serverUrl: parsed.serverUrl, defaultRealm: parsed.defaultRealm, ...decryptSecrets(parsed) }
    : (parsed as CliConfig);

  // Migrate onto the current on-disk format: either the legacy pre-rename
  // path, or a pre-existing new-path file saved before this encryption was
  // added (still plaintext).
  if (file === LEGACY_CONFIG_FILE) {
    saveConfig(config);
    console.warn(
      `[idenplane-cli] Migrated config from ${LEGACY_CONFIG_FILE} to ${CONFIG_FILE}. ` +
        'The legacy file can now be deleted.',
    );
  } else if (!isEncryptedEnvelope(parsed)) {
    saveConfig(config);
    console.warn(`[idenplane-cli] Encrypted the stored credentials at ${CONFIG_FILE}.`);
  }

  return config;
}

export function saveConfig(config: CliConfig): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  const envelope: EncryptedEnvelope = {
    version: ENVELOPE_VERSION,
    serverUrl: config.serverUrl,
    defaultRealm: config.defaultRealm,
    ...encryptSecrets({ accessToken: config.accessToken, apiKey: config.apiKey }),
  };
  writeFileSync(CONFIG_FILE, JSON.stringify(envelope, null, 2), { mode: 0o600 });
}

export function clearConfig(): void {
  if (existsSync(CONFIG_FILE)) {
    unlinkSync(CONFIG_FILE);
  }
  if (existsSync(KEY_FILE)) {
    unlinkSync(KEY_FILE);
  }
}

// AUTHME_* env vars are accepted for backward compatibility with the old name
// while users migrate. New code should set IDENPLANE_* — the legacy fallback
// will be removed in a future major release.
function readEnv(...names: string[]): string | undefined {
  for (let i = 0; i < names.length; i++) {
    const value = process.env[names[i]];
    if (value) {
      if (i > 0) {
        console.warn(
          `[idenplane-cli] ${names[i]} is deprecated; please set ${names[0]} instead.`,
        );
      }
      return value;
    }
  }
  return undefined;
}

export function requireAuth(): { serverUrl: string; headers: Record<string, string> } {
  const envUrl = readEnv('IDENPLANE_SERVER_URL', 'AUTHME_SERVER_URL');
  const envApiKey = process.env['ADMIN_API_KEY'];
  const envToken = readEnv('IDENPLANE_TOKEN', 'AUTHME_TOKEN');

  if (envUrl && envApiKey) {
    return { serverUrl: envUrl, headers: { 'x-admin-api-key': envApiKey } };
  }
  if (envUrl && envToken) {
    return { serverUrl: envUrl, headers: { Authorization: `Bearer ${envToken}` } };
  }

  const config = loadConfig();
  if (config) {
    const headers: Record<string, string> = {};
    if (config.apiKey) {
      headers['x-admin-api-key'] = config.apiKey;
    } else if (config.accessToken) {
      headers['Authorization'] = `Bearer ${config.accessToken}`;
    }
    return { serverUrl: config.serverUrl, headers };
  }

  throw new Error(
    'Not authenticated. Run `idenplane login` or set IDENPLANE_SERVER_URL + ADMIN_API_KEY env vars.',
  );
}
