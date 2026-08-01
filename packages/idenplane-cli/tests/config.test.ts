import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CONFIG_DIR = join(homedir(), '.idenplane');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const KEY_FILE = join(CONFIG_DIR, 'key');

// We patch the config module by temporarily setting environment variables
// and relying on the module's exported functions.
// Since config module reads HOME and constructs paths at load time, we test
// via environment variable path in requireAuth.

test('requireAuth: uses IDENPLANE_SERVER_URL + ADMIN_API_KEY env vars', async () => {
  const orig = {
    IDENPLANE_SERVER_URL: process.env['IDENPLANE_SERVER_URL'],
    ADMIN_API_KEY: process.env['ADMIN_API_KEY'],
    IDENPLANE_TOKEN: process.env['IDENPLANE_TOKEN'],
  };

  process.env['IDENPLANE_SERVER_URL'] = 'http://localhost:3000';
  process.env['ADMIN_API_KEY'] = 'test-api-key';
  delete process.env['IDENPLANE_TOKEN'];

  try {
    // Dynamic import to get a fresh evaluation with env set
    const { requireAuth } = await import('../src/config.js');
    const result = requireAuth();
    assert.equal(result.serverUrl, 'http://localhost:3000');
    assert.equal(result.headers['x-admin-api-key'], 'test-api-key');
  } finally {
    if (orig.IDENPLANE_SERVER_URL !== undefined) {
      process.env['IDENPLANE_SERVER_URL'] = orig.IDENPLANE_SERVER_URL;
    } else {
      delete process.env['IDENPLANE_SERVER_URL'];
    }
    if (orig.ADMIN_API_KEY !== undefined) {
      process.env['ADMIN_API_KEY'] = orig.ADMIN_API_KEY;
    } else {
      delete process.env['ADMIN_API_KEY'];
    }
  }
});

test('requireAuth: uses IDENPLANE_SERVER_URL + IDENPLANE_TOKEN env vars', async () => {
  const orig = {
    IDENPLANE_SERVER_URL: process.env['IDENPLANE_SERVER_URL'],
    ADMIN_API_KEY: process.env['ADMIN_API_KEY'],
    IDENPLANE_TOKEN: process.env['IDENPLANE_TOKEN'],
  };

  process.env['IDENPLANE_SERVER_URL'] = 'http://localhost:3000';
  delete process.env['ADMIN_API_KEY'];
  process.env['IDENPLANE_TOKEN'] = 'my-bearer-token';

  try {
    const { requireAuth } = await import('../src/config.js');
    const result = requireAuth();
    assert.equal(result.serverUrl, 'http://localhost:3000');
    assert.equal(result.headers['Authorization'], 'Bearer my-bearer-token');
  } finally {
    if (orig.IDENPLANE_SERVER_URL !== undefined) {
      process.env['IDENPLANE_SERVER_URL'] = orig.IDENPLANE_SERVER_URL;
    } else {
      delete process.env['IDENPLANE_SERVER_URL'];
    }
    if (orig.ADMIN_API_KEY !== undefined) {
      process.env['ADMIN_API_KEY'] = orig.ADMIN_API_KEY;
    } else {
      delete process.env['ADMIN_API_KEY'];
    }
    if (orig.IDENPLANE_TOKEN !== undefined) {
      process.env['IDENPLANE_TOKEN'] = orig.IDENPLANE_TOKEN;
    } else {
      delete process.env['IDENPLANE_TOKEN'];
    }
  }
});

test('saveConfig and loadConfig: round-trip', async () => {
  const { saveConfig, loadConfig } = await import('../src/config.js');

  const testConfig = {
    serverUrl: 'http://test.local',
    accessToken: 'tok123',
    apiKey: 'key456',
    defaultRealm: 'myrealm',
  };

  saveConfig(testConfig);
  const loaded = loadConfig();
  assert.ok(loaded !== null);
  assert.equal(loaded!.serverUrl, testConfig.serverUrl);
  assert.equal(loaded!.accessToken, testConfig.accessToken);
  assert.equal(loaded!.apiKey, testConfig.apiKey);
  assert.equal(loaded!.defaultRealm, testConfig.defaultRealm);
});

test('clearConfig: removes config file', async () => {
  const { saveConfig, loadConfig, clearConfig } = await import('../src/config.js');

  saveConfig({ serverUrl: 'http://x.local', accessToken: 'x' });
  assert.ok(loadConfig() !== null);

  clearConfig();
  assert.equal(loadConfig(), null);
});

test('clearConfig: also removes the encryption key file', async () => {
  const { saveConfig, clearConfig } = await import('../src/config.js');

  saveConfig({ serverUrl: 'http://x.local', accessToken: 'x' });
  assert.ok(existsSync(KEY_FILE));

  clearConfig();
  assert.equal(existsSync(KEY_FILE), false);
});

test('saveConfig: does not write accessToken/apiKey in plaintext', async () => {
  const { saveConfig } = await import('../src/config.js');

  const secretToken = 'super-secret-access-token-xyz';
  const secretApiKey = 'super-secret-api-key-abc';
  saveConfig({ serverUrl: 'http://test.local', accessToken: secretToken, apiKey: secretApiKey });

  const raw = readFileSync(CONFIG_FILE, 'utf-8');
  assert.ok(!raw.includes(secretToken), 'access token must not appear in plaintext on disk');
  assert.ok(!raw.includes(secretApiKey), 'api key must not appear in plaintext on disk');
  assert.equal(JSON.parse(raw).version, 1);
});

test('loadConfig: migrates a pre-existing plaintext config.json to the encrypted format', async () => {
  const { loadConfig } = await import('../src/config.js');

  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  const plainConfig = { serverUrl: 'http://legacy-format.local', accessToken: 'plain-token-123' };
  writeFileSync(CONFIG_FILE, JSON.stringify(plainConfig), { mode: 0o600 });

  const loaded = loadConfig();
  assert.ok(loaded !== null);
  assert.equal(loaded!.accessToken, 'plain-token-123');
  assert.equal(loaded!.serverUrl, 'http://legacy-format.local');

  const raw = readFileSync(CONFIG_FILE, 'utf-8');
  assert.ok(!raw.includes('plain-token-123'), 'plaintext config should be re-encrypted on load');
  assert.equal(JSON.parse(raw).version, 1);
});

test('saveConfig/loadConfig: round-trips through the legacy AuthMe path', async () => {
  const legacyDir = join(homedir(), '.authme');
  const legacyFile = join(legacyDir, 'config.json');
  if (!existsSync(legacyDir)) mkdirSync(legacyDir, { recursive: true });
  if (existsSync(CONFIG_FILE)) rmSync(CONFIG_FILE);
  writeFileSync(
    legacyFile,
    JSON.stringify({ serverUrl: 'http://legacy.local', accessToken: 'legacy-token' }),
  );

  try {
    const { loadConfig } = await import('../src/config.js');
    const loaded = loadConfig();
    assert.ok(loaded !== null);
    assert.equal(loaded!.accessToken, 'legacy-token');
    assert.ok(existsSync(CONFIG_FILE), 'legacy config should be migrated to the new path');

    const raw = readFileSync(CONFIG_FILE, 'utf-8');
    assert.ok(!raw.includes('legacy-token'), 'migrated config should be encrypted, not plaintext');
  } finally {
    rmSync(legacyFile, { force: true });
  }
});
