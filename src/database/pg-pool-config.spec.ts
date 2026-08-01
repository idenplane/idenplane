import { cpus } from 'os';
import { getPgPoolConfig } from './pg-pool-config.js';

describe('getPgPoolConfig', () => {
  const ENV_KEYS = [
    'DATABASE_POOL_MAX',
    'DATABASE_POOL_MIN',
    'DATABASE_POOL_IDLE_TIMEOUT_MS',
  ] as const;
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  });

  it('should carry through the connection string unchanged', () => {
    const config = getPgPoolConfig('postgresql://user:pass@localhost:5432/db');
    expect(config.connectionString).toBe(
      'postgresql://user:pass@localhost:5432/db',
    );
  });

  it('should default max to 2x CPU cores + 1, not the pg default of 10', () => {
    const config = getPgPoolConfig('postgresql://localhost/db');
    expect(config.max).toBe(cpus().length * 2 + 1);
  });

  it('should default min to 2 and idleTimeoutMillis to 30s', () => {
    const config = getPgPoolConfig('postgresql://localhost/db');
    expect(config.min).toBe(2);
    expect(config.idleTimeoutMillis).toBe(30_000);
  });

  it('should honor DATABASE_POOL_MAX/MIN/IDLE_TIMEOUT_MS overrides', () => {
    process.env['DATABASE_POOL_MAX'] = '50';
    process.env['DATABASE_POOL_MIN'] = '5';
    process.env['DATABASE_POOL_IDLE_TIMEOUT_MS'] = '10000';

    const config = getPgPoolConfig('postgresql://localhost/db');

    expect(config.max).toBe(50);
    expect(config.min).toBe(5);
    expect(config.idleTimeoutMillis).toBe(10_000);
  });
});
