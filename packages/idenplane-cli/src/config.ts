import { homedir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import type { CliConfig } from './types.js';

const CONFIG_DIR = join(homedir(), '.authme');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

export function loadConfig(): CliConfig | null {
  if (!existsSync(CONFIG_FILE)) return null;
  const raw = readFileSync(CONFIG_FILE, 'utf-8');
  try {
    return JSON.parse(raw) as CliConfig;
  } catch {
    throw new Error(
      `Config file at ${CONFIG_FILE} contains invalid JSON. ` +
        'Fix or remove it and run `authme login` again.',
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

export function requireAuth(): { serverUrl: string; headers: Record<string, string> } {
  const envUrl = process.env['AUTHME_SERVER_URL'];
  const envApiKey = process.env['ADMIN_API_KEY'];
  const envToken = process.env['AUTHME_TOKEN'];

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
    'Not authenticated. Run `authme login` or set AUTHME_SERVER_URL + ADMIN_API_KEY env vars.',
  );
}
