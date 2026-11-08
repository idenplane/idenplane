import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import pg from 'pg';
import { PrismaService } from '../prisma/prisma.service.js';

/** The advisory lock every Idenplane process competes for (an arbitrary constant). */
const LEADER_LOCK_KEY = 7_204_311_861;
const RETRY_MS = 15_000;

/**
 * Picks one process, among all replicas sharing the database, to run the
 * scheduled jobs that must run once per tick: risk re-evaluation, step-up
 * and termination checks, trust decay, credential rotation. With every
 * process running them (Helm defaults to three replicas), each tick did the
 * work N times: duplicate audit rows and emails, N-fold trust decay, two
 * rotated credentials.
 *
 * The leader holds a PostgreSQL session advisory lock on its own connection.
 * The lock is released when that connection ends, so a crashed or
 * partitioned leader frees it and another process takes over within
 * RETRY_MS. A process steps down the moment its connection fails, before
 * anyone else can acquire the lock.
 *
 * Every process is a leader of itself when the database is not PostgreSQL,
 * or when LEADER_ELECTION=off (a connection pooler in transaction mode, which
 * cannot hold session locks). That is the behaviour before this service,
 * and right for a single process.
 */
@Injectable()
export class LeaderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LeaderService.name);
  private client: pg.Client | null = null;
  private leader = false;
  private elected = true; // false only while competing for the lock
  private stopped = false;
  private timer: NodeJS.Timeout | null = null;
  /** The lock competed for; a test can isolate itself with another one. */
  protected readonly lockKey: number = LEADER_LOCK_KEY;

  constructor(prisma: PrismaService) {
    // Release the lock before the database client closes on shutdown, so
    // another process can take over at once.
    prisma.onBeforeDisconnect(() => this.onModuleDestroy());
  }

  onModuleInit(): void {
    const url = process.env['DATABASE_URL'] ?? '';
    if (process.env['LEADER_ELECTION'] === 'off') {
      this.logger.log(
        'LEADER_ELECTION=off — this process runs every scheduled job',
      );
      return;
    }
    if (!/^postgres(ql)?:\/\//i.test(url)) return;
    this.elected = false;
    void this.attempt(url);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.leader = false;
    const client = this.client;
    this.client = null;
    // Ending the connection releases its advisory lock.
    await client?.end().catch(() => {});
  }

  /**
   * True if this process should run once-per-cluster jobs right now. A job
   * that checks this and then works for a while may overlap a new leader's
   * first tick after a failover; the jobs it guards tolerate that.
   */
  isLeader(): boolean {
    return this.elected || this.leader;
  }

  private async attempt(url: string): Promise<void> {
    if (this.stopped) return;
    let client = this.client;
    try {
      if (!client) {
        client = new pg.Client({
          connectionString: url,
          keepAlive: true,
          application_name: 'idenplane-leader',
        });
        client.on('error', (err) => this.lost(client!, err));
        client.on('end', () => this.lost(client!));
        this.client = client;
        await client.connect();
        // Must not keep the process alive on its own.
        (
          client as unknown as {
            connection?: { stream?: { unref?: () => void } };
          }
        ).connection?.stream?.unref?.();
      }
      if (this.leader) {
        // Still holding the lock: prove the connection is alive.
        await client.query('SELECT 1');
      } else {
        const { rows } = await client.query<{ locked: boolean }>(
          'SELECT pg_try_advisory_lock($1) AS locked',
          [this.lockKey],
        );
        if (rows[0]?.locked && !this.stopped) {
          this.leader = true;
          this.logger.log('This process now runs the once-per-cluster jobs');
        }
      }
    } catch (err) {
      if (client) this.lost(client, err as Error);
      return;
    }
    this.schedule(url);
  }

  private lost(client: pg.Client, err?: Error): void {
    if (this.client !== client) return;
    this.client = null;
    if (this.leader) {
      this.logger.warn(
        `Leadership lost${err ? `: ${err.message}` : ''}; another process takes over`,
      );
    }
    this.leader = false;
    client.end().catch(() => {});
    if (!this.stopped) this.schedule(process.env['DATABASE_URL'] ?? '');
  }

  private schedule(url: string): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.attempt(url), RETRY_MS);
    this.timer.unref();
  }
}
