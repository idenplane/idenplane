import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// We patch the config module by temporarily setting environment variables
// and relying on the module's exported functions.
// Since config module reads HOME and constructs paths at load time, we test
// via environment variable path in requireAuth.

test('requireAuth: uses AUTHME_SERVER_URL + ADMIN_API_KEY env vars', async () => {
  const orig = {
    AUTHME_SERVER_URL: process.env['AUTHME_SERVER_URL'],
    ADMIN_API_KEY: process.env['ADMIN_API_KEY'],
    AUTHME_TOKEN: process.env['AUTHME_TOKEN'],
  };

  process.env['AUTHME_SERVER_URL'] = 'http://localhost:3000';
  process.env['ADMIN_API_KEY'] = 'test-api-key';
  delete process.env['AUTHME_TOKEN'];

  try {
    // Dynamic import to get a fresh evaluation with env set
    const { requireAuth } = await import('../src/config.js');
    const result = requireAuth();
    assert.equal(result.serverUrl, 'http://localhost:3000');
    assert.equal(result.headers['x-admin-api-key'], 'test-api-key');
  } finally {
    if (orig.AUTHME_SERVER_URL !== undefined) {
      process.env['AUTHME_SERVER_URL'] = orig.AUTHME_SERVER_URL;
    } else {
      delete process.env['AUTHME_SERVER_URL'];
    }
    if (orig.ADMIN_API_KEY !== undefined) {
      process.env['ADMIN_API_KEY'] = orig.ADMIN_API_KEY;
    } else {
      delete process.env['ADMIN_API_KEY'];
    }
  }
});

test('requireAuth: uses AUTHME_SERVER_URL + AUTHME_TOKEN env vars', async () => {
  const orig = {
    AUTHME_SERVER_URL: process.env['AUTHME_SERVER_URL'],
    ADMIN_API_KEY: process.env['ADMIN_API_KEY'],
    AUTHME_TOKEN: process.env['AUTHME_TOKEN'],
  };

  process.env['AUTHME_SERVER_URL'] = 'http://localhost:3000';
  delete process.env['ADMIN_API_KEY'];
  process.env['AUTHME_TOKEN'] = 'my-bearer-token';

  try {
    const { requireAuth } = await import('../src/config.js');
    const result = requireAuth();
    assert.equal(result.serverUrl, 'http://localhost:3000');
    assert.equal(result.headers['Authorization'], 'Bearer my-bearer-token');
  } finally {
    if (orig.AUTHME_SERVER_URL !== undefined) {
      process.env['AUTHME_SERVER_URL'] = orig.AUTHME_SERVER_URL;
    } else {
      delete process.env['AUTHME_SERVER_URL'];
    }
    if (orig.ADMIN_API_KEY !== undefined) {
      process.env['ADMIN_API_KEY'] = orig.ADMIN_API_KEY;
    } else {
      delete process.env['ADMIN_API_KEY'];
    }
    if (orig.AUTHME_TOKEN !== undefined) {
      process.env['AUTHME_TOKEN'] = orig.AUTHME_TOKEN;
    } else {
      delete process.env['AUTHME_TOKEN'];
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
