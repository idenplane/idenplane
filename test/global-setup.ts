/**
 * Jest global setup for E2E tests.
 * Verifies database connectivity before running any test suite.
 */

import { Client } from 'pg';

export default async function globalSetup(): Promise<void> {
  const dbUrl = process.env['TEST_DATABASE_URL'] || process.env['DATABASE_URL'];

  if (!dbUrl) {
    // Try to load from .env file
    try {
      const fs = await import('fs');
      const envContent = fs.readFileSync('.env', 'utf-8');
      const match = envContent.match(/^DATABASE_URL=(.+)$/m);
      if (match) {
        process.env['DATABASE_URL'] = match[1];
      }
    } catch {
      // .env doesn't exist
    }
  }

  const finalUrl =
    process.env['TEST_DATABASE_URL'] || process.env['DATABASE_URL'];

  if (!finalUrl) {
    console.error(
      '\n' +
        '╔══════════════════════════════════════════════════════════════╗\n' +
        '║  E2E TESTS REQUIRE A DATABASE                              ║\n' +
        '║                                                            ║\n' +
        '║  Set DATABASE_URL in .env or export TEST_DATABASE_URL.     ║\n' +
        '║                                                            ║\n' +
        '║  Quick start:                                              ║\n' +
        '║    docker compose -f docker-compose.dev.yml up -d postgres ║\n' +
        '║    npx prisma migrate deploy                               ║\n' +
        '║    npm run test:e2e                                        ║\n' +
        '╚══════════════════════════════════════════════════════════════╝\n',
    );
    throw new Error(
      'DATABASE_URL is not set. E2E tests cannot run without a database.',
    );
  }

  // Quick connectivity check for PostgreSQL
  if (
    finalUrl.startsWith('postgresql://') ||
    finalUrl.startsWith('postgres://')
  ) {
    try {
      const client = new Client({
        connectionString: finalUrl,
        connectionTimeoutMillis: 10_000,
        query_timeout: 10_000,
      });
      try {
        await client.connect();
        await client.query('SELECT 1');
      } finally {
        await client.end();
      }
    } catch {
      console.error(
        '\n' +
          '╔══════════════════════════════════════════════════════════════╗\n' +
          '║  DATABASE CONNECTION FAILED                                ║\n' +
          '║                                                            ║\n' +
          `║  URL: ${finalUrl
            .replace(/\/\/.*@/, '//***@')
            .slice(0, 52)
            .padEnd(52)} ║\n` +
          '║                                                            ║\n' +
          '║  Make sure the database is running:                        ║\n' +
          '║    docker compose -f docker-compose.dev.yml up -d postgres ║\n' +
          '║    npx prisma migrate deploy                               ║\n' +
          '╚══════════════════════════════════════════════════════════════╝\n',
      );
      throw new Error('Cannot connect to database. Is PostgreSQL running?');
    }
  }
}
