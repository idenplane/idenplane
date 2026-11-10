import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { getPgPoolConfig } from '../database/pg-pool-config.js';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const adapter = new PrismaPg(getPgPoolConfig(process.env['DATABASE_URL']));
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }

  private readonly beforeDisconnect: Array<() => Promise<void>> = [];

  /**
   * Runs `fn` before the pool closes on shutdown. For work that would
   * otherwise query a closed client, which reopens the pool and keeps the
   * process alive (Nest does not order onModuleDestroy across modules).
   */
  onBeforeDisconnect(fn: () => Promise<void>): void {
    this.beforeDisconnect.push(fn);
  }

  async onModuleDestroy() {
    for (const fn of this.beforeDisconnect) await fn().catch(() => {});
    await this.$disconnect();
  }
}
