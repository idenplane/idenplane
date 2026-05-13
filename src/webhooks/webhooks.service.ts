import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHmac } from 'crypto';
import type { Realm } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { CreateWebhookDto, UpdateWebhookDto } from './webhooks.dto.js';

export interface DispatchEventOptions {
  realmId: string;
  eventType: string;
  payload: Record<string, unknown>;
}

const WEBHOOK_SELECT = {
  id: true,
  realmId: true,
  url: true,
  enabled: true,
  eventTypes: true,
  description: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Retry delays in milliseconds: 1s, 10s, 60s (used by testWebhook inline delivery) */
const RETRY_DELAYS_MS = [1_000, 10_000, 60_000];

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /**
   * Typed accessor for the webhookEvent table.
   * The type will be present after `prisma generate` runs following the
   * 20260324960000_add_webhook_event_queue migration.
   */

  private get db(): any {
    return this.prisma;
  }

  // ─── CRUD ──────────────────────────────────────────────

  /**
   * Create a webhook.
   *
   * The caller-supplied secret is encrypted with AES-256-GCM before being
   * stored in the database.  The plaintext secret is returned in the response
   * body exactly once so the caller can configure their receiver; it cannot be
   * retrieved again (only rotated via the update endpoint).
   */
  async create(realm: Realm, dto: CreateWebhookDto) {
    const encryptedSecret = this.crypto.encrypt(dto.secret);

    // Accept `events` as an alias for `eventTypes` for API compatibility.
    const resolvedEventTypes = dto.eventTypes ?? dto.events ?? [];

    const webhook = await this.prisma.webhook.create({
      data: {
        realmId: realm.id,
        url: dto.url,
        secret: encryptedSecret,
        enabled: dto.enabled ?? true,
        eventTypes: resolvedEventTypes,
        description: dto.description,
      },
      select: WEBHOOK_SELECT,
    });

    return {
      ...webhook,
      // Return the raw secret once so the caller can store it securely.
      // It is not persisted in plaintext and will not be returned again.
      secret: dto.secret,
      secretWarning: 'Store this secret securely. It will not be shown again.',
    };
  }

  async findAll(realm: Realm) {
    return this.prisma.webhook.findMany({
      where: { realmId: realm.id },
      select: WEBHOOK_SELECT,
      orderBy: { createdAt: 'asc' },
    });
  }

  async findOne(realm: Realm, id: string) {
    const webhook = await this.prisma.webhook.findFirst({
      where: { id, realmId: realm.id },
      select: WEBHOOK_SELECT,
    });
    if (!webhook) {
      throw new NotFoundException(`Webhook '${id}' not found`);
    }
    return webhook;
  }

  /**
   * Update a webhook.
   *
   * If a new secret is provided it is encrypted before being stored.
   * The plaintext value is returned once in the response body.
   */
  async update(realm: Realm, id: string, dto: UpdateWebhookDto) {
    await this.findOne(realm, id);

    const data: {
      url?: string;
      secret?: string;
      enabled?: boolean;
      eventTypes?: string[];
      description?: string;
    } = {
      url: dto.url,
      enabled: dto.enabled,
      eventTypes: dto.eventTypes,
      description: dto.description,
    };

    if (dto.secret !== undefined) {
      data.secret = this.crypto.encrypt(dto.secret);
    }

    const updated = await this.prisma.webhook.update({
      where: { id },
      data,
      select: WEBHOOK_SELECT,
    });

    if (dto.secret !== undefined) {
      return {
        ...updated,
        secret: dto.secret,
        secretWarning:
          'Store this secret securely. It will not be shown again.',
      };
    }

    return updated;
  }

  async remove(realm: Realm, id: string) {
    await this.findOne(realm, id);
    await this.prisma.webhook.delete({ where: { id } });
  }

  // ─── Test Webhook ───────────────────────────────────────

  async testWebhook(realm: Realm, id: string) {
    await this.findOne(realm, id);
    const rawWebhook = await this.prisma.webhook.findFirst({
      where: { id, realmId: realm.id },
    });
    if (!rawWebhook) {
      throw new NotFoundException(`Webhook '${id}' not found`);
    }
    const testPayload = {
      eventType: 'webhook.test',
      timestamp: new Date().toISOString(),
      realmId: realm.id,
      webhookId: id,
      test: true,
    };
    // Fire-and-forget: do not await deliverWebhook.  The full retry sequence
    // can take up to ~101 s; awaiting it inline would hang the HTTP response.
    // The delivery record can be inspected via the delivery-logs endpoint.
    void this.deliverWebhook(rawWebhook, 'webhook.test', testPayload).catch(
      (err) => {
        this.logger.warn(
          `Test webhook delivery failed for ${rawWebhook.url}: ${(err as Error).message}`,
        );
      },
    );
    return { status: 'queued', message: 'Test delivery initiated' };
  }

  // ─── Delivery Logs ─────────────────────────────────────

  async findDeliveries(realm: Realm, webhookId: string) {
    await this.findOne(realm, webhookId);
    return this.prisma.webhookDelivery.findMany({
      where: { webhookId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  // ─── Event Dispatch ────────────────────────────────────

  /**
   * Enqueue an event for durable, scheduled delivery (Issue #338 fix).
   *
   * Rather than firing the HTTP request inline (fire-and-forget with
   * `setImmediate`), we write a `WebhookEvent` row to the database and return
   * immediately.  The row is durable: if the process crashes after this call
   * returns, the event will still be picked up and delivered by
   * `WebhookSchedulerService` on the next scheduler tick.
   *
   * The method returns a Promise so callers can optionally `await` it for
   * back-pressure, but it is safe to call without awaiting — any enqueue error
   * is logged and swallowed so it never crashes the caller.
   */
  async dispatchEvent(options: DispatchEventOptions): Promise<void> {
    const fullPayload = {
      eventType: options.eventType,
      timestamp: new Date().toISOString(),
      realmId: options.realmId,
      ...options.payload,
    };

    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access -- webhookEvent model pending migration
      await this.db.webhookEvent.create({
        data: {
          realmId: options.realmId,
          eventType: options.eventType,
          payload: fullPayload as Record<string, unknown>,
          status: 'PENDING',
        },
      });
    } catch (err) {
      // Log but do not throw — a failed enqueue must never crash the caller.
      this.logger.error(
        `Failed to enqueue webhook event for realm=${options.realmId} ` +
          `type=${options.eventType}: ${(err as Error).message}`,
      );
    }
  }

  // ─── Delivery with Retry ───────────────────────────────

  private async deliverWebhook(
    webhook: { id: string; url: string; secret: string },
    eventType: string,
    payload: Record<string, unknown>,
  ) {
    // Decrypt the stored secret so it can be used for HMAC signing.
    // The plaintext secret never leaves this method; only the HMAC
    // signature is sent over the wire.
    const plaintextSecret = this.crypto.decrypt(webhook.secret);

    const body = JSON.stringify(payload);
    const signature = this.signPayload(plaintextSecret, body);

    // Create initial delivery record
    const delivery = await this.prisma.webhookDelivery.create({
      data: {
        webhookId: webhook.id,
        eventType,
        payload: payload as unknown as Prisma.InputJsonValue,
        attempts: 0,
      },
    });

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      if (attempt > 0) {
        const delay = RETRY_DELAYS_MS[attempt - 1];
        await this.sleep(delay);
      }

      try {
        const response = await this.doHttpPost(webhook.url, body, signature);

        await this.prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: {
            statusCode: response.statusCode,
            response: response.body.slice(0, 2000),
            success: response.statusCode >= 200 && response.statusCode < 300,
            attempts: attempt + 1,
            lastAttempt: new Date(),
          },
        });

        if (response.statusCode >= 200 && response.statusCode < 300) {
          return { ...delivery, success: true, attempts: attempt + 1 };
        }

        lastError = new Error(`HTTP ${response.statusCode}`);
      } catch (err) {
        lastError = err as Error;
        this.logger.warn(
          `Webhook delivery attempt ${attempt + 1} failed for ${webhook.url}: ${lastError.message}`,
        );
      }
    }

    // All attempts exhausted
    await this.prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        success: false,
        attempts: RETRY_DELAYS_MS.length + 1,
        lastAttempt: new Date(),
        response: lastError?.message?.slice(0, 2000),
      },
    });

    return { ...delivery, success: false };
  }

  // ─── HMAC-SHA256 Signing ───────────────────────────────

  signPayload(secret: string, body: string): string {
    return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  }

  // ─── HTTP POST ─────────────────────────────────────────

  private async doHttpPost(
    url: string,
    body: string,
    signature: string,
  ): Promise<{ statusCode: number; body: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
          'X-Webhook-Timestamp': new Date().toISOString(),
          'User-Agent': 'Authme-Webhook/1.0',
        },
        body,
        signal: controller.signal,
      });

      const text = await res.text();
      return { statusCode: res.status, body: text };
    } finally {
      clearTimeout(timeout);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
