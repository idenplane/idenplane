import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import pg from 'pg';
import { PrismaService } from '../prisma/prisma.service.js';

/** A change announced by the database (see the cache_invalidation_triggers migration). */
export type CacheEvent =
  | { t: 'realm'; id: string; names: string[] }
  | { t: 'client'; realmId: string; id: string; clientIds: string[] }
  | { t: 'keys'; realmId: string };

const CHANNEL = 'idenplane_cache';
/** Application messages fanned out to every process (see publish). */
const APP_CHANNEL = 'idenplane_app';
/** NOTIFY payloads are limited to 8000 bytes. */
const MAX_PAYLOAD_BYTES = 7900;
const MAX_BACKOFF_MS = 30_000;
const PING_INTERVAL_MS = 30_000;

/**
 * Hears, from PostgreSQL, every change to the rows the in-process caches
 * hold, and passes it to whoever subscribed.
 *
 * The database sends the notification from a trigger, so it covers every
 * writer and reaches every process and replica. It uses its own connection:
 * LISTEN belongs to a connection, and the Prisma pool hands connections out
 * and takes them back.
 *
 * Notifications sent while the connection is down are lost for good. So
 * `isConnected()` is false from the moment the connection fails until it has
 * been re-established and LISTEN re-issued, and every subscriber's `onReset`
 * runs on each (re)connect. The caches go to the database while
 * disconnected and start empty again once connected, so a missed
 * notification can never leave a stale entry behind.
 *
 * Off when the database is not PostgreSQL, and when CACHE_L1=off. That
 * setting is for a connection pooler in transaction mode (PgBouncer), where
 * LISTEN appears to succeed but notifications never arrive.
 */
@Injectable()
export class CacheBusService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheBusService.name);
  private client: pg.Client | null = null;
  private connected = false;
  private stopped = false;
  private backoffMs = 1_000;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private readonly eventHandlers = new Set<(event: CacheEvent) => void>();
  private readonly resetHandlers = new Set<() => void>();
  private readonly messageHandlers = new Map<
    string,
    Set<(payload: unknown) => void>
  >();

  constructor(prisma: PrismaService) {
    // Stop before the database client closes, so no late announcement makes
    // a subscriber query it during shutdown.
    prisma.onBeforeDisconnect(() => this.onModuleDestroy());
  }

  onModuleInit(): void {
    const url = process.env['DATABASE_URL'] ?? '';
    if (process.env['CACHE_L1'] === 'off') {
      this.logger.log('CACHE_L1=off — in-process cache disabled');
      return;
    }
    if (!/^postgres(ql)?:\/\//i.test(url)) {
      this.logger.log('Database is not PostgreSQL — in-process cache disabled');
      return;
    }
    void this.connect(url);
  }

  async onModuleDestroy(): Promise<void> {
    // A shutdown is not a lost connection: no reset, no reconnect. (A reset
    // here would make subscribers reload from a database that is closing,
    // which reopens its pool and keeps the process alive.)
    this.stopped = true;
    this.connected = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    const client = this.client;
    this.client = null;
    await client?.end().catch(() => {});
  }

  /** True only while notifications are guaranteed to arrive. */
  isConnected(): boolean {
    return this.connected;
  }

  /** Called with every change the database announces. */
  onEvent(handler: (event: CacheEvent) => void): void {
    this.eventHandlers.add(handler);
  }

  /**
   * Delivers `payload` to every process's `onMessage(topic)` handlers, this
   * one's included: through PostgreSQL while connected, so a message raised
   * on one replica reaches what the others hold (their WebSockets); only to
   * this process otherwise, which is all there is to reach when there is no
   * channel. At most once: a message published while the connection drops is
   * lost, like the event it reports would be on a restart.
   */
  async publish(topic: string, payload: unknown): Promise<void> {
    const body = JSON.stringify({ topic, payload });
    const client = this.client;
    if (
      this.connected &&
      client &&
      Buffer.byteLength(body) <= MAX_PAYLOAD_BYTES
    ) {
      try {
        await client.query('SELECT pg_notify($1, $2)', [APP_CHANNEL, body]);
        return;
      } catch (err) {
        this.logger.warn(`Could not publish ${topic}: ${String(err)}`);
      }
    }
    this.deliver(topic, payload);
  }

  /** Called with every message published on `topic`, by any process. */
  onMessage(topic: string, handler: (payload: unknown) => void): void {
    let handlers = this.messageHandlers.get(topic);
    if (!handlers) this.messageHandlers.set(topic, (handlers = new Set()));
    handlers.add(handler);
  }

  private deliver(topic: string, payload: unknown): void {
    for (const handler of this.messageHandlers.get(topic) ?? []) {
      try {
        handler(payload);
      } catch (err) {
        this.logger.warn(`Message handler for ${topic} failed: ${String(err)}`);
      }
    }
  }

  /** Called whenever notifications may have been missed: drop everything. */
  onReset(handler: () => void): void {
    this.resetHandlers.add(handler);
  }

  private async connect(url: string): Promise<void> {
    if (this.stopped) return;
    const client = new pg.Client({
      connectionString: url,
      keepAlive: true,
      application_name: 'idenplane-cache-bus',
    });
    client.on('error', (err) => this.lost(client, err));
    client.on('end', () => this.lost(client));
    client.on('notification', (msg) => {
      if (!msg.payload) return;
      if (msg.channel === APP_CHANNEL) {
        try {
          const { topic, payload } = JSON.parse(msg.payload) as {
            topic: string;
            payload: unknown;
          };
          this.deliver(topic, payload);
        } catch {
          this.logger.warn('Unreadable application message');
        }
        return;
      }
      if (msg.channel !== CHANNEL) return;
      let event: CacheEvent;
      try {
        event = JSON.parse(msg.payload) as CacheEvent;
      } catch {
        this.logger.warn(`Unreadable cache notification: ${msg.payload}`);
        return;
      }
      for (const handler of this.eventHandlers) {
        try {
          handler(event);
        } catch (err) {
          this.logger.warn(`Cache event handler failed: ${String(err)}`);
        }
      }
    });
    this.client = client;
    try {
      await client.connect();
      await client.query(`LISTEN ${CHANNEL}`);
      await client.query(`LISTEN ${APP_CHANNEL}`);
      // An auxiliary connection: it must not, on its own, keep the process
      // alive (the HTTP server does that), any more than its timers do.
      (
        client as unknown as {
          connection?: { stream?: { unref?: () => void } };
        }
      ).connection?.stream?.unref?.();
    } catch (err) {
      this.lost(client, err as Error);
      return;
    }
    if (this.client !== client || this.stopped) return;
    this.backoffMs = 1_000;
    this.reset();
    this.connected = true;
    this.logger.log('In-process cache on: listening for changes');
    // A dead TCP connection is otherwise noticed only when the OS gives up.
    this.pingTimer = setInterval(() => {
      client.query('SELECT 1').catch((err: Error) => this.lost(client, err));
    }, PING_INTERVAL_MS);
    this.pingTimer.unref();
  }

  private lost(client: pg.Client, err?: Error): void {
    // An older connection, already replaced, or a shutdown in progress.
    if (this.client !== client || this.stopped) return;
    const wasConnected = this.connected;
    this.connected = false;
    this.client = null;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    client.end().catch(() => {});
    this.reset();
    if (this.stopped) return;
    if (wasConnected || err) {
      this.logger.warn(
        `Cache invalidation connection lost${err ? `: ${err.message}` : ''}; ` +
          `reading from the database until it is back (retry in ${this.backoffMs} ms)`,
      );
    }
    const url = process.env['DATABASE_URL'] ?? '';
    this.reconnectTimer = setTimeout(
      () => void this.connect(url),
      this.backoffMs,
    );
    this.reconnectTimer.unref();
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
  }

  private reset(): void {
    for (const handler of this.resetHandlers) {
      try {
        handler();
      } catch (err) {
        this.logger.warn(`Cache reset handler failed: ${String(err)}`);
      }
    }
  }
}
