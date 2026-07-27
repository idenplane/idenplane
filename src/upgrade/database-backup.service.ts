import { Injectable, Logger } from '@nestjs/common';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

export interface BackupResult {
  success: boolean;
  backupPath?: string;
  backupSize?: string;
  duration?: number;
  error?: string;
  timestamp: Date;
}

export interface BackupMetadata {
  backupPath: string;
  backupSize: string;
  timestamp: Date;
  databaseName: string;
  checksum?: string;
}

export interface BackupListing {
  path: string;
  filename: string;
  size: string;
  created: Date;
  age: number; // in days
}

/**
 * DatabaseBackupService
 *
 * Handles automatic pre-migration database backups using pg_dump.
 * Creates compressed PostgreSQL database backups before any upgrade
 * operation to ensure data safety.
 */
@Injectable()
export class DatabaseBackupService {
  private readonly logger = new Logger(DatabaseBackupService.name);
  private readonly backupDirectory: string;

  constructor() {
    // Default backup directory within project
    this.backupDirectory = process.env.BACKUP_DIR || './backups';
  }

  /**
   * Create a full database backup before upgrade operations.
   *
   * @param label Optional label for the backup (e.g., 'pre-upgrade-v2.1.0')
   * @returns BackupResult with success status and backup details
   */
  createBackup(label?: string): BackupResult {
    const startTime = Date.now();
    const timestamp = new Date();
    const timestampStr = timestamp.toISOString().replace(/[:.]/g, '-');
    const safeLabel = label ? `-${label.replace(/[^a-zA-Z0-9-_]/g, '')}` : '';
    // `.dump`, not `.sql.gz`: pg_dump is invoked with -Fc, which writes a
    // PostgreSQL custom-format archive (magic bytes "PGDMP"), not gzipped SQL.
    // The old name was a lie that restoreBackup then believed — it branched on
    // the .gz suffix and ran gunzipSync, which throws on every archive this
    // service has ever produced.
    const backupFilename = `idenplane-backup-${timestampStr}${safeLabel}.dump`;
    const backupPath = path.join(this.backupDirectory, backupFilename);

    this.logger.log(`Starting database backup: ${backupFilename}`);

    try {
      // Ensure backup directory exists
      this.ensureBackupDirectory();

      // Connection details come from DATABASE_URL (PG* override them).
      const { database: dbName } = this.pgConnParams();

      // Build pg_dump argument vector and run it WITHOUT a shell. Passing args
      // as an array to execFileSync means no value is ever interpreted by a
      // shell, eliminating command injection (CodeQL js/command-line-injection).
      const pgDumpArgs = this.buildPgDumpArgs(dbName, backupPath);

      this.logger.debug(`Executing: pg_dump ${pgDumpArgs.join(' ')}`);

      // Execute pg_dump (password supplied via PGPASSWORD env, never argv).
      execFileSync('pg_dump', pgDumpArgs, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: this.pgEnv(),
      });

      const duration = Date.now() - startTime;
      const backupSize = this.getFileSize(backupPath);

      this.logger.log(
        `Database backup completed successfully in ${(duration / 1000).toFixed(1)}s: ${backupFilename} (${backupSize})`,
      );

      return {
        success: true,
        backupPath,
        backupSize,
        duration,
        timestamp,
      };
    } catch (err) {
      const duration = Date.now() - startTime;
      const errorMessage = err instanceof Error ? err.message : String(err);

      this.logger.error(
        `Database backup failed after ${duration}ms: ${errorMessage}`,
      );

      return {
        success: false,
        timestamp,
        error: errorMessage,
      };
    }
  }

  /**
   * Restore a database from a backup file.
   *
   * @param backupPath Path to the backup file (.sql or .sql.gz)
   * @returns BackupResult with restore status
   */
  restoreBackup(backupPath: string): BackupResult {
    const startTime = Date.now();
    const timestamp = new Date();

    this.logger.log(`Starting database restore from: ${backupPath}`);

    // Validate backup file exists
    if (!fs.existsSync(backupPath)) {
      return {
        success: false,
        timestamp,
        error: `Backup file not found: ${backupPath}`,
      };
    }

    try {
      const { database: dbName } = this.pgConnParams();

      // Run pg_restore WITHOUT a shell (arg array → no command injection).
      // There is exactly one code path: pg_dump -Fc writes a custom-format
      // archive and pg_restore reads it directly from the file. The previous
      // zlib branch existed only to service the misleading .sql.gz name.
      const restoreArgs = [...this.buildRestoreArgs(dbName), backupPath];

      // Log the full vector including the archive. Logging buildRestoreArgs()
      // alone omitted the one argument an operator debugging a failed rollback
      // most needs to see — which archive was actually read.
      this.logger.debug(`Executing: pg_restore ${restoreArgs.join(' ')}`);

      execFileSync('pg_restore', restoreArgs, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: this.pgEnv(),
      });

      const duration = Date.now() - startTime;

      this.logger.log(
        `Database restore completed successfully in ${(duration / 1000).toFixed(1)}s`,
      );

      return {
        success: true,
        backupPath,
        duration,
        timestamp,
      };
    } catch (err) {
      const duration = Date.now() - startTime;
      const errorMessage = err instanceof Error ? err.message : String(err);

      this.logger.error(
        `Database restore failed after ${duration}ms: ${errorMessage}`,
      );

      return {
        success: false,
        backupPath,
        timestamp,
        error: errorMessage,
      };
    }
  }

  /**
   * List all available backups in the backup directory.
   *
   * @returns Array of BackupListing objects with backup information
   */
  listBackups(): BackupListing[] {
    const backups: BackupListing[] = [];

    try {
      if (!fs.existsSync(this.backupDirectory)) {
        return backups;
      }

      const files = fs.readdirSync(this.backupDirectory);
      const now = new Date();

      for (const file of files) {
        // Only custom-format archives this service can actually restore.
        // Legacy .sql.gz files (which were never gzip despite the name) are
        // deliberately excluded — listing one would offer the operator a
        // rollback target that cannot be restored.
        if (!file.endsWith('.dump')) {
          continue;
        }

        const filePath = path.join(this.backupDirectory, file);
        const stats = fs.statSync(filePath);

        backups.push({
          path: filePath,
          filename: file,
          size: this.formatFileSize(stats.size),
          created: stats.birthtime,
          age: Math.floor(
            (now.getTime() - stats.birthtime.getTime()) / (1000 * 60 * 60 * 24),
          ),
        });
      }

      // Sort by creation date, newest first
      backups.sort((a, b) => b.created.getTime() - a.created.getTime());
    } catch (err) {
      this.logger.error('Failed to list backups', err);
    }

    return backups;
  }

  /**
   * Delete old backups to manage storage.
   *
   * @param maxAgeDays Delete backups older than this many days (default: 30)
   * @param keepMinimum Keep at least this many backups regardless of age (default: 3)
   * @returns Number of backups deleted
   */
  cleanupOldBackups(maxAgeDays = 30, keepMinimum = 3): number {
    const backups = this.listBackups();
    let deletedCount = 0;

    // Sort by creation date, newest first
    const sortedBackups = [...backups].sort(
      (a, b) => b.created.getTime() - a.created.getTime(),
    );

    for (let i = 0; i < sortedBackups.length; i++) {
      const backup = sortedBackups[i];

      // Always keep at least keepMinimum backups
      if (i < keepMinimum) {
        continue;
      }

      // Delete if older than maxAgeDays
      if (backup.age > maxAgeDays) {
        try {
          fs.unlinkSync(backup.path);
          this.logger.log(`Deleted old backup: ${backup.filename}`);
          deletedCount++;
        } catch (err) {
          this.logger.warn(`Failed to delete backup: ${backup.path}`, err);
        }
      }
    }

    return deletedCount;
  }

  /**
   * Verify backup file integrity by checking file exists and has content.
   *
   * @param backupPath Path to backup file
   * @returns true if backup is valid, false otherwise
   */
  verifyBackup(backupPath: string): boolean {
    try {
      if (!fs.existsSync(backupPath)) {
        return false;
      }

      const stats = fs.statSync(backupPath);
      if (stats.size <= 1024) {
        return false;
      }

      // A size check cannot distinguish a complete archive from one truncated
      // by a full disk or a killed process — and this is called immediately
      // before a rollback depends on it. `pg_restore --list` reads the archive's
      // table of contents, which lives at the end of the file, so it fails on a
      // truncated or wrong-format file without touching the database.
      execFileSync('pg_restore', ['--list', backupPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      return true;
    } catch (err) {
      this.logger.warn(
        `Backup verification failed for ${backupPath}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return false;
    }
  }

  /**
   * SHA-256 of a backup file, so a restore can confirm it is reading the same
   * bytes that were written. BackupMetadata has always declared a `checksum`
   * field; nothing ever populated it.
   */
  checksum(backupPath: string): string | undefined {
    try {
      return createHash('sha256')
        .update(fs.readFileSync(backupPath))
        .digest('hex');
    } catch {
      return undefined;
    }
  }

  /**
   * Connection parameters for the pg_* tools.
   *
   * Previously only the database *name* was taken from DATABASE_URL; host, port
   * and user fell back to hardcoded defaults of localhost/5432/postgres. In the
   * shipped Docker setup DATABASE_URL points at host `postgres`, so pg_dump
   * dialled localhost and the backup failed — and none of PGHOST/PGPORT/PGUSER
   * are set anywhere in docker-compose, the Dockerfile or the Helm chart.
   *
   * DATABASE_URL is now the source of truth and the PG* variables are
   * *overrides*, for the case where the pg tools must reach the server by a
   * different route than the app does (a sidecar, a bouncer, a socket path).
   */
  private pgConnParams(): {
    host: string;
    port: string;
    user: string;
    password: string;
    database: string;
  } {
    const env = process.env;
    const parsed = this.parseDatabaseUrl(env.DATABASE_URL);

    return {
      host: env.PGHOST || parsed.host,
      port: env.PGPORT || parsed.port,
      user: env.PGUSER || env.DATABASE_USERNAME || parsed.user,
      password: env.PGPASSWORD || env.DATABASE_PASSWORD || parsed.password,
      database: parsed.database,
    };
  }

  /**
   * Parse a postgres connection URL into its components.
   *
   * Uses the URL parser rather than a regex so percent-encoded credentials are
   * decoded correctly — a password containing '@' or '/' is encoded in the URL
   * and must be decoded before it reaches PGPASSWORD, or authentication fails
   * in a way that looks like a wrong password.
   */
  private parseDatabaseUrl(databaseUrl: string | undefined): {
    host: string;
    port: string;
    user: string;
    password: string;
    database: string;
  } {
    const empty = {
      host: 'localhost',
      port: '5432',
      user: 'postgres',
      password: '',
      database: 'postgres',
    };

    if (!databaseUrl) {
      return empty;
    }

    try {
      const url = new URL(databaseUrl);

      if (!/^postgres(ql)?:$/.test(url.protocol)) {
        throw new Error(
          `Unsupported database protocol '${url.protocol}' — the upgrade ` +
            'backup flow requires PostgreSQL.',
        );
      }

      return {
        host: url.hostname || empty.host,
        port: url.port || empty.port,
        user: url.username ? decodeURIComponent(url.username) : empty.user,
        password: url.password ? decodeURIComponent(url.password) : '',
        database: url.pathname.replace(/^\//, '') || empty.database,
      };
    } catch (err) {
      // A malformed URL must not silently degrade to dumping the wrong
      // database on localhost — surface it to the caller.
      throw new Error(
        `Could not parse DATABASE_URL: ${
          err instanceof Error ? err.message : String(err)
        }`,
        { cause: err },
      );
    }
  }

  /**
   * Whether the pg_dump / pg_restore binaries are reachable on PATH.
   *
   * The production image does not install postgresql-client today, so this
   * returns false there and the pre-upgrade validator fails the run *before*
   * anything touches the database — rather than at the backup stage, or worse,
   * at rollback time when a backup is already needed.
   */
  pgToolsAvailable(): { available: boolean; detail: string } {
    for (const tool of ['pg_dump', 'pg_restore'] as const) {
      try {
        execFileSync(tool, ['--version'], { stdio: ['pipe', 'pipe', 'pipe'] });
      } catch {
        return {
          available: false,
          detail: `${tool} was not found on PATH. Install postgresql-client (client major version >= the server's).`,
        };
      }
    }
    return { available: true, detail: 'pg_dump and pg_restore are available' };
  }

  /**
   * Environment for pg_* child processes: the connection password is passed via
   * PGPASSWORD rather than on the command line (avoids leaking it in argv / ps).
   */
  private pgEnv(): NodeJS.ProcessEnv {
    const { password } = this.pgConnParams();
    return password
      ? { ...process.env, PGPASSWORD: password }
      : { ...process.env };
  }

  /**
   * pg_dump argument vector (no shell — passed straight to execFileSync).
   *
   * upgrade_audit_log is deliberately excluded. It records upgrades; it is not
   * application data that should be rewound by one. Including it meant a
   * rollback destroyed the very record of the failure that triggered it:
   *
   *   1. INITIALIZATION writes the audit row (status IN_PROGRESS).
   *   2. BACKUP dumps the database — capturing that row as IN_PROGRESS — and
   *      then updates it with the archive path.
   *   3. The migration fails; the rollback restores the archive, reverting the
   *      table to step 2's contents.
   *
   * The result was a row stuck at IN_PROGRESS with no backupId, no failure
   * reason and no rollback record — and, since #1199, a stale IN_PROGRESS row
   * blocks every further upgrade for the two-hour TTL. Excluding the table
   * leaves it untouched by the restore, so the audit trail survives the
   * rollback. `--exclude-table` only affects the dump; pg_restore --clean drops
   * what is in the archive, so a table that was never dumped is never dropped.
   *
   * Found by test/upgrade-failure-rollback.e2e-spec.ts, which is the first test
   * to run a failing upgrade against a real database.
   */
  private buildPgDumpArgs(databaseName: string, outputPath: string): string[] {
    const { host, port, user } = this.pgConnParams();
    return [
      '-h',
      host,
      '-p',
      port,
      '-U',
      user,
      '-d',
      databaseName,
      '--exclude-table=upgrade_audit_log',
      '-Fc', // Custom format — required for pg_restore's selective/parallel modes
      '-Z',
      '6', // Compression level 6
      '-f',
      outputPath,
    ];
  }

  /**
   * pg_restore argument vector (target db); the archive path is appended by the
   * caller.
   *
   * The flags matter for a rollback into a database that already has a schema,
   * which is the only situation this is ever used in:
   *
   *   --clean --if-exists   drop each object before recreating it. Without this
   *                         every restore into a populated database dies on
   *                         "relation already exists".
   *   --no-owner            do not reassign ownership; the app's role is rarely
   *                         --no-privileges  the owner recorded in the dump.
   *   --single-transaction  all-or-nothing. A rollback that half-applies is
   *                         worse than one that fails cleanly.
   *   --exit-on-error       stop at the first failure rather than continuing and
   *                         reporting success at the end.
   */
  private buildRestoreArgs(databaseName: string): string[] {
    const { host, port, user } = this.pgConnParams();
    return [
      '-h',
      host,
      '-p',
      port,
      '-U',
      user,
      '-d',
      databaseName,
      '--clean',
      '--if-exists',
      '--no-owner',
      '--no-privileges',
      '--single-transaction',
      '--exit-on-error',
    ];
  }

  /**
   * Ensure backup directory exists, create if necessary.
   */
  private ensureBackupDirectory(): void {
    if (!fs.existsSync(this.backupDirectory)) {
      fs.mkdirSync(this.backupDirectory, { recursive: true });
      this.logger.debug(`Created backup directory: ${this.backupDirectory}`);
    }
  }

  /**
   * Get file size in human-readable format.
   */
  private getFileSize(filePath: string): string {
    try {
      // Strip any directory component with path.basename so the stat target can
      // only ever be a file directly inside the backup directory — a crafted
      // path cannot traverse out (CodeQL js/path-injection). All callers pass a
      // path already inside backupDirectory, so basename is behaviour-preserving.
      const root = path.resolve(this.backupDirectory);
      const safePath = path.join(root, path.basename(filePath));
      const stats = fs.statSync(safePath);
      return this.formatFileSize(stats.size);
    } catch {
      return 'unknown';
    }
  }

  /**
   * Format bytes into human-readable size.
   */
  private formatFileSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }
}
