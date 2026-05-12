import { detectProvider, DatabaseProvider } from './database-provider.js';

describe('detectProvider', () => {
  // ── PostgreSQL ──────────────────────────────────────────────────────────

  describe('PostgreSQL', () => {
    it('detects postgresql:// scheme', () => {
      expect(
        detectProvider('postgresql://user:pass@localhost:5432/authme'),
      ).toBe(DatabaseProvider.POSTGRESQL);
    });

    it('detects postgres:// alias scheme', () => {
      expect(detectProvider('postgres://user:pass@localhost:5432/authme')).toBe(
        DatabaseProvider.POSTGRESQL,
      );
    });

    it('is case-insensitive for the scheme', () => {
      expect(
        detectProvider('POSTGRESQL://user:pass@localhost:5432/authme'),
      ).toBe(DatabaseProvider.POSTGRESQL);
    });

    it('handles a URL with query params (sslmode=require)', () => {
      expect(
        detectProvider(
          'postgresql://user:pass@rds.example.com:5432/authme?sslmode=require',
        ),
      ).toBe(DatabaseProvider.POSTGRESQL);
    });
  });

  // ── MySQL ───────────────────────────────────────────────────────────────

  describe('MySQL', () => {
    it('detects mysql:// scheme', () => {
      expect(detectProvider('mysql://user:pass@localhost:3306/authme')).toBe(
        DatabaseProvider.MYSQL,
      );
    });

    it('is case-insensitive for the scheme', () => {
      expect(detectProvider('MYSQL://user:pass@localhost:3306/authme')).toBe(
        DatabaseProvider.MYSQL,
      );
    });
  });

  // ── SQLite ──────────────────────────────────────────────────────────────

  describe('SQLite', () => {
    it('detects file: scheme (relative path)', () => {
      expect(detectProvider('file:./dev.db')).toBe(DatabaseProvider.SQLITE);
    });

    it('detects file: scheme (absolute path)', () => {
      expect(detectProvider('file:/tmp/authme-test.db')).toBe(
        DatabaseProvider.SQLITE,
      );
    });

    it('detects file: scheme (in-memory database)', () => {
      expect(detectProvider('file::memory:')).toBe(DatabaseProvider.SQLITE);
    });

    it('is case-insensitive for the scheme', () => {
      expect(detectProvider('FILE:./dev.db')).toBe(DatabaseProvider.SQLITE);
    });
  });

  // ── Error cases ─────────────────────────────────────────────────────────

  describe('error handling', () => {
    it('throws when DATABASE_URL is empty', () => {
      expect(() => detectProvider('')).toThrow('DATABASE_URL is not set');
    });

    it('throws when DATABASE_URL is whitespace only', () => {
      expect(() => detectProvider('   ')).toThrow('DATABASE_URL is not set');
    });

    it('throws for an unrecognised scheme', () => {
      expect(() => detectProvider('mongodb://localhost/authme')).toThrow(
        'Unrecognised DATABASE_URL scheme',
      );
    });

    it('includes the bad scheme in the error message', () => {
      expect(() => detectProvider('redis://localhost:6379')).toThrow('redis');
    });

    it('throws for a bare hostname without a scheme', () => {
      expect(() => detectProvider('localhost:5432/authme')).toThrow(
        'Unrecognised DATABASE_URL scheme',
      );
    });
  });

  // ── Enum values ─────────────────────────────────────────────────────────

  describe('DatabaseProvider enum values', () => {
    it('POSTGRESQL has value "postgresql"', () => {
      expect(DatabaseProvider.POSTGRESQL).toBe('postgresql');
    });

    it('MYSQL has value "mysql"', () => {
      expect(DatabaseProvider.MYSQL).toBe('mysql');
    });

    it('SQLITE has value "sqlite"', () => {
      expect(DatabaseProvider.SQLITE).toBe('sqlite');
    });
  });
});
