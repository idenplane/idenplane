import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { prismaMigrateStatus } from '../upgrade/migrate-status.js';

export interface MigrationStatus {
  appliedCount: number;
  pendingCount: number;
  pendingMigrations: string[];
  schemaVersion: string | null;
}

/**
 * MigrationCheckService
 *
 * Reports pending Prisma migrations once the application has started. It
 * shells out to `prisma migrate status` so it works independently of any
 * specific Prisma client API.
 *
 * In the background: the CLI takes seconds to start, and nothing waits for
 * the answer (the container entrypoint has already run `migrate deploy`),
 * so the server starts accepting requests without it.
 */
@Injectable()
export class MigrationCheckService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(MigrationCheckService.name);
  /** Stops a check still running at shutdown instead of leaving the CLI behind. */
  private readonly shutdown = new AbortController();

  onModuleInit(): void {
    // Once per container: in cluster mode only the first worker runs it.
    if ((process.env['IDENPLANE_WORKER_INDEX'] ?? '0') !== '0') return;
    void this.report();
  }

  onApplicationShutdown(): void {
    this.shutdown.abort();
  }

  private async report(): Promise<void> {
    const status = await this.getStatus(this.shutdown.signal);
    if (this.shutdown.signal.aborted) return;

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

  async getStatus(signal?: AbortSignal): Promise<MigrationStatus> {
    try {
      return this.parseStatus(await prismaMigrateStatus(signal));
    } catch (err: unknown) {
      // A non-zero exit code is how prisma reports pending migrations.
      const output =
        err instanceof Error && 'stdout' in err
          ? String((err as Error & { stdout?: string }).stdout)
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
