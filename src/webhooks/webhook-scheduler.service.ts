/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- webhookEvent model pending migration */
import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { createHmac } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { safePost } from '../common/security/safe-http-client.js';

/**
 * Retry back-off delays in milliseconds: 1 s → 10 s → 60 s → 10 min.
 * The index of the element corresponds to the attempt number (0-based) that
 * just failed.  If all RETRY_DELAYS_MS.length retries are exhausted the event
 * is marked FAILED and no further attempts are made.
 */
const RETRY_DELAYS_MS = [1_000, 10_000, 60_000, 600_000];

/** Maximum number of delivery attempts (initial + retries). */
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1; // 5

/** How many events to pull from the queue in a single scheduler tick. */
const BATCH_SIZE = 50;

/**
 * A PROCESSING event untouched for this long belongs to a process that died
 * mid-delivery, and is taken over. Far above one delivery (each HTTP call
 * times out after 10 s), so a live process is never overtaken.
 */
const LEASE_MS = 5 * 60_000;

/**
 * WebhookSchedulerService — database-backed queue processor (Issue #338).
 *
 * ### Problem
 * The original `dispatchEvent()` fired webhooks with `setImmediate`.  Any
 * event in-flight when the process crashed was permanently lost.
 *
 * ### Solution — Transactional Outbox pattern
 * 1. `WebhooksService.dispatchEvent()` now writes a `WebhookEvent` row to the
 *    database **synchronously** before returning.  Because the write is to the
 *    same database the rest of the application uses, it participates in normal
 *    durability guarantees.
 *
 * 2. This scheduler runs every 10 seconds, picks up PENDING (and retryable
 *    FAILED) events, attempts HTTP delivery, and updates the row's status.
 *
 * 3. A row is only marked DELIVERED or terminally FAILED once the outcome is
 *    confirmed. A process that dies mid-delivery leaves its rows PROCESSING;
 *    once their lease (LEASE_MS) has run out, any process takes them over.
 *
 * Every process runs this tick (replicas, rolling deploys), so a row is
 * claimed one at a time with a conditional update on the state it was read
 * in, and only the process whose update changed it delivers it.
 *
 * 4. Retries use exponential back-off via the `next_retry_at` column.
 */
interface QueuedEvent {
  id: string;
  realmId: string;
  eventType: string;
  payload: unknown;
  status: string;
  attempts: number;
  maxAttempts: number;
  updatedAt: Date;
}

@Injectable()
export class WebhookSchedulerService {
  private readonly logger = new Logger(WebhookSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /**
   * Typed accessor for the webhookEvent table.
   *
   * `prisma.webhookEvent` is not in the generated PrismaClient type yet —
   * the type will appear automatically after `prisma generate` is run
   * following the 20260324960000_add_webhook_event_queue migration.
   * The cast keeps the compiler happy in the interim.
   */

  private get db(): any {
    return this.prisma;
  }

  // ─── Scheduler tick ───────────────────────────────────────────────────────

  @Interval(10_000) // every 10 seconds
  async processQueue(): Promise<void> {
    const now = new Date();
    const leaseExpired = new Date(now.getTime() - LEASE_MS);

    const candidates = (await this.db.webhookEvent.findMany({
      where: {
        attempts: { lt: MAX_ATTEMPTS },
        OR: [
          { status: { in: ['PENDING', 'FAILED'] }, nextRetryAt: { lte: now } },
          { status: 'PROCESSING', updatedAt: { lt: leaseExpired } },
        ],
      },
      orderBy: { nextRetryAt: 'asc' },
      take: BATCH_SIZE,
    })) as QueuedEvent[];

    if (candidates.length === 0) return;

    // Claim each row on the exact state it was read in. Another process
    // that read the same row claims it first or not at all: its update and
    // this one cannot both match, so a webhook is never sent twice.
    const claimed: QueuedEvent[] = [];
    for (const event of candidates) {
      const { count } = (await this.db.webhookEvent.updateMany({
        where: {
          id: event.id,
          status: event.status,
          updatedAt: event.updatedAt,
        },
        data: { status: 'PROCESSING' },
      })) as { count: number };
      if (count === 1) claimed.push(event);
    }

    if (claimed.length === 0) return;
    this.logger.debug(`Processing ${claimed.length} queued webhook event(s)`);

    await Promise.allSettled(claimed.map((event) => this.processEvent(event)));
  }

  // ─── Per-event processing ─────────────────────────────────────────────────

  private async processEvent(event: {
    id: string;
    realmId: string;
    eventType: string;
    payload: unknown;
    attempts: number;
    maxAttempts: number;
  }): Promise<void> {
    // Find all enabled webhooks for this realm that subscribe to this event.
    const webhooks = await this.prisma.webhook.findMany({
      where: {
        realmId: event.realmId,
        enabled: true,
        eventTypes: { has: event.eventType },
      },
    });

    if (webhooks.length === 0) {
      // No subscribers — mark as delivered immediately.
      await this.db.webhookEvent.update({
        where: { id: event.id },
        data: { status: 'DELIVERED', updatedAt: new Date() },
      });
      return;
    }

    const payload = event.payload as Record<string, unknown>;
    const body = JSON.stringify(payload);
    const newAttemptCount = event.attempts + 1;

    // Deliver to all subscribers concurrently.
    const results = await Promise.allSettled(
      webhooks.map((webhook) =>
        this.deliverToWebhook(webhook, event.eventType, body, payload),
      ),
    );

    const anyFailure = results.some((r) => r.status === 'rejected');
    const firstError = anyFailure
      ? results
          .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
          .map((r) => String((r.reason as Error)?.message ?? r.reason))
          .join('; ')
      : null;

    if (!anyFailure) {
      await this.db.webhookEvent.update({
        where: { id: event.id },
        data: {
          status: 'DELIVERED',
          attempts: newAttemptCount,
          updatedAt: new Date(),
        },
      });
      return;
    }

    // At least one delivery failed.  Schedule a retry or give up.
    const retriesLeft = (event.maxAttempts ?? MAX_ATTEMPTS) - newAttemptCount;
    if (retriesLeft > 0 && newAttemptCount <= RETRY_DELAYS_MS.length) {
      const delayMs =
        RETRY_DELAYS_MS[newAttemptCount - 1] ??
        RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
      const nextRetry = new Date(Date.now() + delayMs);
      await this.db.webhookEvent.update({
        where: { id: event.id },
        data: {
          status: 'FAILED',
          attempts: newAttemptCount,
          nextRetryAt: nextRetry,
          lastError: firstError?.slice(0, 2000) ?? null,
          updatedAt: new Date(),
        },
      });
      this.logger.warn(
        `Webhook event ${event.id} (${event.eventType}) failed on attempt ${newAttemptCount}; ` +
          `next retry at ${nextRetry.toISOString()}`,
      );
    } else {
      // All attempts exhausted — terminal failure.
      await this.db.webhookEvent.update({
        where: { id: event.id },
        data: {
          status: 'FAILED',
          attempts: newAttemptCount,
          lastError: firstError?.slice(0, 2000) ?? null,
          updatedAt: new Date(),
        },
      });
      this.logger.error(
        `Webhook event ${event.id} (${event.eventType}) permanently failed after ${newAttemptCount} attempt(s): ${firstError}`,
      );
    }
  }

  // ─── HTTP delivery + DeliveryLog ─────────────────────────────────────────

  private async deliverToWebhook(
    webhook: { id: string; url: string; secret: string },
    eventType: string,
    body: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    // The secret is stored encrypted; decrypt it before HMAC signing.
    const plaintextSecret = this.crypto.decrypt(webhook.secret);
    const signature = this.signPayload(plaintextSecret, body);

    const delivery = await this.prisma.webhookDelivery.create({
      data: {
        webhookId: webhook.id,
        eventType,
        payload: payload as unknown as Prisma.InputJsonValue,
        attempts: 0,
      },
    });

    try {
      const response = await this.doHttpPost(webhook.url, body, signature);
      const success = response.statusCode >= 200 && response.statusCode < 300;

      await this.prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          statusCode: response.statusCode,
          response: response.body.slice(0, 2000),
          success,
          attempts: 1,
          lastAttempt: new Date(),
        },
      });

      if (!success) {
        throw new Error(`HTTP ${response.statusCode}`);
      }
    } catch (err) {
      await this.prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          success: false,
          attempts: 1,
          lastAttempt: new Date(),
          response: (err as Error).message?.slice(0, 2000),
        },
      });
      throw err;
    }
  }

  // ─── HMAC signing ─────────────────────────────────────────────────────────

  signPayload(secret: string, body: string): string {
    return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  }

  // ─── HTTP POST ────────────────────────────────────────────────────────────

  /**
   * POST through the SSRF-safe client rather than `fetch`. The queue can hold
   * an event for minutes before it is delivered, so the target must be
   * re-resolved and re-validated at delivery time -- see
   * `src/common/security/safe-http-client.ts`.
   */
  private async doHttpPost(
    url: string,
    body: string,
    signature: string,
  ): Promise<{ statusCode: number; body: string }> {
    return safePost(url, body, {
      'Content-Type': 'application/json',
      'X-Webhook-Signature': signature,
      'X-Webhook-Timestamp': new Date().toISOString(),
      'User-Agent': 'Idenplane-Webhook/1.0',
    });
  }
}
