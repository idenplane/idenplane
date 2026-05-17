import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { SqlDriverAdapterFactory } from '@prisma/driver-adapter-utils';
import { DatabaseProvider, detectProvider } from './database-provider.js';

/**
 * DatabaseService wraps PrismaClient and adds provider-aware initialisation.
 *
 * For PostgreSQL it uses the high-performance `@prisma/adapter-pg` driver
 * adapter (connection-pool based). For MySQL and SQLite it falls back to
 * Prisma's built-in drivers, which do not require a separate adapter package.
 *
 * The detected provider is exposed as a read-only property so that other
 * modules can branch on it when they need provider-specific behaviour (e.g.
 * raw SQL, JSON coercion for SQLite, etc.).
 *
 * This service is re-exported from DatabaseModule (which is @Global), so it
 * can be injected everywhere without importing DatabaseModule explicitly.
 */
@Injectable()
export class DatabaseService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(DatabaseService.name);

  readonly provider: DatabaseProvider;

  constructor() {
    const url = process.env['DATABASE_URL'] ?? '';
    const provider = detectProvider(url);

    if (provider === DatabaseProvider.POSTGRESQL) {
      // Lazy-import the pg adapter so that the package only needs to be
      // installed when actually running against PostgreSQL.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { PrismaPg } = require('@prisma/adapter-pg') as {
        PrismaPg: {
          new (config: { connectionString: string }): SqlDriverAdapterFactory;
        };
      };

      const adapter = new PrismaPg({ connectionString: url });
      super({ adapter });
    } else {
      // MySQL and SQLite use Prisma's built-in drivers — no adapter needed.
      super();
    }

    this.provider = provider;
  }

  async onModuleInit(): Promise<void> {
    this.logger.log(`Connecting to database (provider: ${this.provider})`);
    await this.$connect();
    this.logger.log('Database connection established');
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log('Disconnecting from database');
    await this.$disconnect();
  }

  /** Returns true when the active provider is PostgreSQL. */
  get isPostgres(): boolean {
    return this.provider === DatabaseProvider.POSTGRESQL;
  }

  /** Returns true when the active provider is MySQL / MariaDB. */
  get isMysql(): boolean {
    return this.provider === DatabaseProvider.MYSQL;
  }

  /**
   * Returns true when the active provider is SQLite.
   * Useful for test helpers that need to skip provider-specific assertions.
   */
  get isSqlite(): boolean {
    return this.provider === DatabaseProvider.SQLITE;
  }
}
