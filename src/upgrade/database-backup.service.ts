import { Injectable, Logger } from '@nestjs/common';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
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
  async createBackup(label?: string): Promise<BackupResult> {
    const startTime = Date.now();
    const timestamp = new Date();
    const timestampStr = timestamp.toISOString().replace(/[:.]/g, '-');
    const safeLabel = label ? `-${label.replace(/[^a-zA-Z0-9-_]/g, '')}` : '';
    const backupFilename = `authme-backup-${timestampStr}${safeLabel}.sql.gz`;
    const backupPath = path.join(this.backupDirectory, backupFilename);

    this.logger.log(`Starting database backup: ${backupFilename}`);

    try {
      // Ensure backup directory exists
      this.ensureBackupDirectory();

      // Get database name from Prisma
      const databaseUrl = process.env.DATABASE_URL || '';
      const dbName = this.extractDatabaseName(databaseUrl);

      // Build pg_dump command
      const pgDumpCmd = this.buildPgDumpCommand(dbName, backupPath);

      this.logger.debug(
        `Executing: ${pgDumpCmd.replace(/--password=\S+/g, '--password=******')}`,
      );

      // Execute pg_dump
      execSync(pgDumpCmd, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
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
  async restoreBackup(backupPath: string): Promise<BackupResult> {
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

      // Build pg_restore or psql command based on file extension
      const restoreCmd = this.buildRestoreCommand(backupPath, dbName);

      this.logger.debug(
        `Executing: ${restoreCmd.replace(/--password=\S+/g, '--password=******')}`,
      );

      // Execute restore command
      execSync(restoreCmd, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
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
  private buildPgDumpCommand(databaseName: string, outputPath: string): string {
    const env = process.env;
    const host = env.PGHOST || 'localhost';
    const port = env.PGPORT || '5432';
    const user = env.PGUSER || env.DATABASE_USERNAME || 'postgres';
    const password = env.PGPASSWORD || env.DATABASE_PASSWORD || '';

    // pg_dump with compression for PostgreSQL
    const cmd = [
      'pg_dump',
      `-h ${host}`,
      `-p ${port}`,
      `-U ${user}`,
      `-d ${databaseName}`,
      '-Fc', // Custom format for compression
      '-Z 6', // Compression level 6
      '-f',
      outputPath,
    ];

    if (password) {
      cmd.push(`--password=${password}`);
    }

    return cmd.join(' ');
  }

  /**
   * Build pg_restore command for restoring from backup.
   */
  private buildRestoreCommand(
    backupPath: string,
    databaseName: string,
  ): string {
    const env = process.env;
    const host = env.PGHOST || 'localhost';
    const port = env.PGPORT || '5432';
    const user = env.PGUSER || env.DATABASE_USERNAME || 'postgres';
    const password = env.PGPASSWORD || env.DATABASE_PASSWORD || '';

    const isCompressed = backupPath.endsWith('.gz');

    if (isCompressed) {
      // Decompress and pipe to pg_restore
      return `gunzip -c "${backupPath}" | pg_restore -h ${host} -p ${port} -U ${user} -d ${databaseName}${password ? ` --password=${password}` : ''}`;
    }

    // pg_restore for custom format
    const cmd = [
      'pg_restore',
      `-h ${host}`,
      `-p ${port}`,
      `-U ${user}`,
      `-d ${databaseName}`,
      backupPath,
    ];

    if (password) {
      cmd.push(`--password=${password}`);
    }

    return cmd.join(' ');
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
      const stats = fs.statSync(filePath);
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
