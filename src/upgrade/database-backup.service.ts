import { Injectable, Logger } from '@nestjs/common';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { PrismaClient } from '@prisma/client';

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
  private readonly prisma: PrismaClient;
  private readonly backupDirectory: string;

  constructor() {
    this.prisma = new PrismaClient();
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
    const backupFilename = `idenplane-backup-${timestampStr}${safeLabel}.sql.gz`;
    const backupPath = path.join(this.backupDirectory, backupFilename);

    this.logger.log(`Starting database backup: ${backupFilename}`);

    try {
      // Ensure backup directory exists
      this.ensureBackupDirectory();

      // Get database name from Prisma
      const databaseUrl = process.env.DATABASE_URL || '';
      const dbName = this.extractDatabaseName(databaseUrl);

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
      // Get database name from connection string
      const databaseUrl = process.env.DATABASE_URL || '';
      const dbName = this.extractDatabaseName(databaseUrl);

      // Run pg_restore WITHOUT a shell (arg array → no command injection).
      // Compressed (.gz) backups are decompressed in-process with zlib and fed
      // to pg_restore over stdin, replacing the previous `gunzip -c | pg_restore`
      // shell pipe (CodeQL js/command-line-injection / shell-command-injection).
      const restoreArgs = this.buildRestoreArgs(dbName);
      const env = this.pgEnv();

      this.logger.debug(`Executing: pg_restore ${restoreArgs.join(' ')}`);

      if (backupPath.endsWith('.gz')) {
        const decompressed = zlib.gunzipSync(fs.readFileSync(backupPath));
        execFileSync('pg_restore', restoreArgs, {
          input: decompressed,
          stdio: ['pipe', 'pipe', 'pipe'],
          env,
        });
      } else {
        execFileSync('pg_restore', [...restoreArgs, backupPath], {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
          env,
        });
      }

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
        if (!file.endsWith('.sql.gz') && !file.endsWith('.sql')) {
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
      // Minimum reasonable backup size (at least 1KB)
      return stats.size > 1024;
    } catch {
      return false;
    }
  }

  /**
   * Extract database name from DATABASE_URL connection string.
   */
  private extractDatabaseName(databaseUrl: string): string {
    // Handle postgresql://user:pass@host:5432/dbname format
    const match = databaseUrl.match(/\/([^/?]+)(\?|$)/);
    return match ? match[1] : 'default';
  }

  /**
   * Build pg_dump command with appropriate options for backup.
   */
  /** Connection params for the pg_* tools, sourced from the environment. */
  private pgConnParams(): {
    host: string;
    port: string;
    user: string;
    password: string;
  } {
    const env = process.env;
    return {
      host: env.PGHOST || 'localhost',
      port: env.PGPORT || '5432',
      user: env.PGUSER || env.DATABASE_USERNAME || 'postgres',
      password: env.PGPASSWORD || env.DATABASE_PASSWORD || '',
    };
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

  /** pg_dump argument vector (no shell — passed straight to execFileSync). */
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
      '-Fc', // Custom format for compression
      '-Z',
      '6', // Compression level 6
      '-f',
      outputPath,
    ];
  }

  /** pg_restore argument vector (target db); the source is the file/stdin. */
  private buildRestoreArgs(databaseName: string): string[] {
    const { host, port, user } = this.pgConnParams();
    return ['-h', host, '-p', port, '-U', user, '-d', databaseName];
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

  /**
   * Clean up Prisma client connections.
   */
  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
