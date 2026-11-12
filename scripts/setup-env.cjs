#!/usr/bin/env node
'use strict';

const { randomBytes } = require('node:crypto');
const { writeFileSync } = require('node:fs');
const { resolve } = require('node:path');

function createEnvironmentFile(directory = process.cwd()) {
  const filename = resolve(directory, '.env');
  const databasePassword = randomBytes(32).toString('hex');
  const values = {
    POSTGRES_PASSWORD: databasePassword,
    DATABASE_URL: `postgresql://idenplane:${databasePassword}@localhost:5432/idenplane`,
    ADMIN_USER: 'admin',
    ADMIN_PASSWORD: randomBytes(24).toString('hex'),
    ADMIN_API_KEY: randomBytes(32).toString('hex'),
    WEBHOOK_SECRET_KEY: randomBytes(32).toString('hex'),
    WEBHOOK_ENCRYPTION_SALT: randomBytes(16).toString('hex'),
    NODE_ENV: 'development',
    PORT: '3000',
    BASE_URL: 'http://localhost:3000',
  };
  const content = '# Local Idenplane settings. Keep this file private and preserve its encryption keys.\n'
    + Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n';
  // Exclusive creation protects existing database credentials and encryption keys,
  // including when two setup processes run at the same time.
  writeFileSync(filename, content, { flag: 'wx', mode: 0o600 });
  return filename;
}

if (require.main === module) {
  try {
    createEnvironmentFile();
    console.log('Created .env with unique credentials. Read ADMIN_PASSWORD in that file to sign in as admin.');
    console.log('Keep and back up .env. Do not commit it or regenerate encryption keys for an existing installation.');
  } catch (error) {
    console.error(error.code === 'EEXIST'
      ? 'Refusing to overwrite .env. Preserve your existing credentials and encryption keys.'
      : `Could not create .env: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { createEnvironmentFile };
