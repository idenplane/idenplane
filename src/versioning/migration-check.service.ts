import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { execSync } from 'child_process';

export interface MigrationStatus {
  appliedCount: number;
  pendingCount: number;
  pendingMigrations: string[];
  schemaVersion: string | null;
}

/**
 * MigrationCheckService
 *
 * Runs on application startup and after any version-check request to report
 * pending Prisma migrations.  It shells out to `prisma migrate status` so it
 * works independently of any specific Prisma client API.
 */
@Injectable()
export class MigrationCheckService implements OnModuleInit {
  private readonly logger = new Logger(MigrationCheckService.name);

  onModuleInit(): void {
    // Once per container: in cluster mode only the first worker runs it
    // (it shells out to prisma and blocks the event loop while it does).
    if ((process.env['IDENPLANE_WORKER_INDEX'] ?? '0') !== '0') return;
    const status = this.getStatus();

    if (status.pendingCount > 0) {
      this.logger.warn(
        `There ${status.pendingCount === 1 ? 'is' : 'are'} ` +
          `${status.pendingCount} pending database migration(s): ` +
          status.pendingMigrations.join(', '),
      );
      this.logger.warn(
        'Run `npx prisma migrate deploy` to apply pending migrations.',
      );
    } else {
      this.logger.log('Database schema is up to date.');
    }
  }

  getStatus(): MigrationStatus {
    try {
      const output = execSync('npx prisma migrate status 2>&1', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      return this.parseStatus(output);
    } catch (err: unknown) {
      // execSync throws when exit code != 0 (i.e. when there ARE pending migrations)
      const output =
        err instanceof Error && 'stdout' in err
          ? String((err as NodeJS.ErrnoException & { stdout?: Buffer }).stdout)
          : String(err);

      return this.parseStatus(output);
    }
  }

  private parseStatus(output: string): MigrationStatus {
    const lines = output.split('\n');

    // Collect names of migrations that have not yet been applied
    const pendingMigrations: string[] = [];
    const appliedMigrations: string[] = [];

    // Prisma outputs lines like:
    //   [*] 20260101000000_init        (not applied)
    //   [✓] 20260101000000_init        (applied)
    for (const line of lines) {
      const notApplied = line.match(/\[\s*\]\s+(\S+)/);
      const applied = line.match(/[✓✔]\s+(\S+)/);
      if (notApplied) pendingMigrations.push(notApplied[1]);
      if (applied) appliedMigrations.push(applied[1]);
    }

    // Derive schema version from the last applied migration name
    const lastApplied = appliedMigrations[appliedMigrations.length - 1] ?? null;

    return {
      appliedCount: appliedMigrations.length,
      pendingCount: pendingMigrations.length,
      pendingMigrations,
      schemaVersion: lastApplied,
    };
  }
}
