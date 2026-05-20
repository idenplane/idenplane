import { homedir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import type { CliConfig } from './types.js';

const CONFIG_DIR = join(homedir(), '.idenplane');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

// Legacy path used before the AuthMe → Idenplane rename. We read from it as a
// fallback so users who upgrade do not have to re-login. First successful read
// triggers a migration to the new path; the legacy file is left in place.
const LEGACY_CONFIG_FILE = join(homedir(), '.authme', 'config.json');

export function loadConfig(): CliConfig | null {
  const file = existsSync(CONFIG_FILE)
    ? CONFIG_FILE
    : existsSync(LEGACY_CONFIG_FILE)
      ? LEGACY_CONFIG_FILE
      : null;
  if (!file) return null;
  const raw = readFileSync(file, 'utf-8');
  try {
    const config = JSON.parse(raw) as CliConfig;
    // If we read from the legacy path, copy to the new path so we stop reading
    // the legacy one on the next invocation.
    if (file === LEGACY_CONFIG_FILE) {
      saveConfig(config);
      console.warn(
        `[idenplane-cli] Migrated config from ${LEGACY_CONFIG_FILE} to ${CONFIG_FILE}. ` +
          'The legacy file can now be deleted.',
      );
    }
    return config;
  } catch {
    throw new Error(
      `Config file at ${file} contains invalid JSON. ` +
        'Fix or remove it and run `idenplane login` again.',
    );
  }
}

export function saveConfig(config: CliConfig): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
}

export function clearConfig(): void {
  if (existsSync(CONFIG_FILE)) {
    unlinkSync(CONFIG_FILE);
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
