import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, unlinkSync, rmdirSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

const { createEnvironmentFile } = require('../../scripts/setup-env.cjs') as { createEnvironmentFile(directory: string): string };
const parse = (text: string): Record<string, string> => Object.fromEntries(text.split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)]; }));

describe('local setup secret invariants', () => {
  let directories: string[];
  beforeEach(() => { directories = []; });
  const directory = () => { const dir = mkdtempSync(join(tmpdir(), 'idenplane-setup-')); directories.push(dir); return dir; };
  afterEach(() => {
    for (const dir of directories) {
      if (!resolve(dir).startsWith(resolve(tmpdir()) + sep)) throw new Error('Refusing cleanup outside the test directory');
      const file = join(dir, '.env'); if (existsSync(file)) unlinkSync(file); rmdirSync(dir);
    }
  });

  it('creates independent strong secrets and matching native database credentials', () => {
    const first = parse(readFileSync(createEnvironmentFile(directory()), 'utf8'));
    const second = parse(readFileSync(createEnvironmentFile(directory()), 'utf8'));
    for (const key of ['POSTGRES_PASSWORD', 'ADMIN_PASSWORD', 'ADMIN_API_KEY', 'WEBHOOK_SECRET_KEY', 'WEBHOOK_ENCRYPTION_SALT']) {
      expect(first[key]).toMatch(/^[a-f0-9]{32,}$/); expect(first[key]).not.toBe(second[key]);
    }
    expect(new URL(first.DATABASE_URL).password).toBe(first.POSTGRES_PASSWORD);
    expect(first.ADMIN_USER).toBe('admin');
  });

  it('preserves an existing environment byte for byte', () => {
    const dir = directory(), file = join(dir, '.env'), original = 'WEBHOOK_SECRET_KEY=keep-this-existing-key\n';
    writeFileSync(file, original);
    expect(() => createEnvironmentFile(dir)).toThrow(expect.objectContaining({ code: 'EEXIST' }));
    expect(readFileSync(file, 'utf8')).toBe(original);
  });

  it('creates a regular file with private permissions on POSIX', () => {
    const file = createEnvironmentFile(directory()), stat = statSync(file);
    expect(stat.isFile()).toBe(true);
    if (process.platform !== 'win32') expect(stat.mode & 0o777).toBe(0o600);
  });

  it('does not print generated secrets or overwrite them on a repeated CLI run', () => {
    const dir = directory(), script = resolve(__dirname, '../../scripts/setup-env.cjs');
    const first = spawnSync(process.execPath, [script], { cwd: dir, encoding: 'utf8', windowsHide: true });
    expect(first.status).toBe(0);
    const original = readFileSync(join(dir, '.env'), 'utf8'), values = parse(original);
    for (const key of ['ADMIN_PASSWORD', 'ADMIN_API_KEY', 'WEBHOOK_SECRET_KEY', 'WEBHOOK_ENCRYPTION_SALT']) expect(first.stdout + first.stderr).not.toContain(values[key]);
    const again = spawnSync(process.execPath, [script], { cwd: dir, encoding: 'utf8', windowsHide: true });
    expect(again.status).toBe(1); expect(readFileSync(join(dir, '.env'), 'utf8')).toBe(original);
  });
});
