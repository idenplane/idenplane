import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createHmac } from 'crypto';
import { WebhooksService } from '../src/webhooks/webhooks.service';
import {
  createTestApp,
  TEST_ADMIN_API_KEY,
  type SeededRealm,
  type TestContext,
} from './setup';

describe('Webhook Delivery (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;
  let seeded: SeededRealm;

  const REALM_NAME = 'e2e-webhooks-realm';
  const API_KEY_HEADER = 'x-admin-api-key';

  const withKey = (req: request.Test) =>
    req.set(API_KEY_HEADER, TEST_ADMIN_API_KEY);

  const WEBHOOKS_BASE = `/admin/realms/${REALM_NAME}/webhooks`;

  // Use a reliable, non-existent local URL — delivery will fail (connection
  // refused) which is fine; we only need the delivery record to be created.
  const WEBHOOK_URL = 'http://localhost:19999/webhook-test-receiver';
  const WEBHOOK_SECRET = 'super-secret-signing-key-for-e2e';

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    seeded = await ctx.seedTestRealm(REALM_NAME);
  }, 30_000);

  afterAll(async () => {
    await ctx.prisma.realm
      .delete({ where: { name: REALM_NAME } })
      .catch(() => {});
    // Webhook deliveries are fire-and-forget (void deliverWebhook(...)).
    // Let any in-flight outbound attempt settle before the app / Jest
    // environment is torn down, otherwise its late module access throws
    // "require after the Jest environment has been torn down" (CI flake).
    await new Promise<void>((resolve) => setTimeout(resolve, 3000));
    await ctx.cleanup();
  });

  // ─── 1. CREATE WEBHOOK ─────────────────────────────────────────────────

  describe('Create webhook', () => {
    let webhookId: string;

    it('POST .../webhooks — should create a webhook', async () => {
      const res = await withKey(
        request(app.getHttpServer())
          .post(WEBHOOKS_BASE)
          .send({
            url: WEBHOOK_URL,
            secret: WEBHOOK_SECRET,
            eventTypes: ['user.login', 'user.created'],
            description: 'E2E test webhook',
            enabled: true,
          }),
      ).expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('url', WEBHOOK_URL);
      expect(res.body).toHaveProperty('enabled', true);
      expect(res.body.eventTypes).toEqual(
        expect.arrayContaining(['user.login', 'user.created']),
      );
      // The implementation returns the secret once in the creation response
      // so the caller can store it; subsequent reads do not expose it.
      webhookId = res.body.id;

      // Cleanup
      await ctx.prisma.webhook.delete({ where: { id: webhookId } }).catch(() => {});
    });

    it('POST .../webhooks — should reject a webhook with no eventTypes', async () => {
      const res = await withKey(
        request(app.getHttpServer())
          .post(WEBHOOKS_BASE)
          .send({
            url: WEBHOOK_URL,
            secret: WEBHOOK_SECRET,
            eventTypes: [], // empty — must be rejected
          }),
      );
      expect([400, 422]).toContain(res.status);
    });

    it('POST .../webhooks — should reject a webhook with an invalid URL', async () => {
      const res = await withKey(
        request(app.getHttpServer())
          .post(WEBHOOKS_BASE)
          .send({
            url: 'not-a-valid-url',
            secret: WEBHOOK_SECRET,
            eventTypes: ['user.login'],
          }),
      );
      expect([400, 422]).toContain(res.status);
    });

    it('POST .../webhooks — should reject a secret shorter than 8 characters', async () => {
      const res = await withKey(
        request(app.getHttpServer())
          .post(WEBHOOKS_BASE)
          .send({
            url: WEBHOOK_URL,
            secret: 'short',
            eventTypes: ['user.login'],
          }),
      );
      expect([400, 422]).toContain(res.status);
    });
  });

  // ─── 2. LIST, GET, UPDATE, DELETE ──────────────────────────────────────

  describe('Webhook CRUD lifecycle', () => {
    let webhookId: string;

    beforeAll(async () => {
      const res = await withKey(
        request(app.getHttpServer())
          .post(WEBHOOKS_BASE)
          .send({
            url: WEBHOOK_URL,
            secret: WEBHOOK_SECRET,
            eventTypes: ['user.login'],
            description: 'CRUD lifecycle test',
          }),
      ).expect(201);
      webhookId = res.body.id;
    });

    afterAll(async () => {
      await ctx.prisma.webhook.delete({ where: { id: webhookId } }).catch(() => {});
    });

    it('GET .../webhooks — should return the created webhook', async () => {
      const res = await withKey(
        request(app.getHttpServer()).get(WEBHOOKS_BASE),
      ).expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      const found = res.body.find((w: { id: string }) => w.id === webhookId);
      expect(found).toBeDefined();
      expect(found.url).toBe(WEBHOOK_URL);
    });

    it('GET .../webhooks/:id — should return the webhook by id', async () => {
      const res = await withKey(
        request(app.getHttpServer()).get(`${WEBHOOKS_BASE}/${webhookId}`),
      ).expect(200);

      expect(res.body).toHaveProperty('id', webhookId);
      expect(res.body).toHaveProperty('url', WEBHOOK_URL);
      expect(res.body).toHaveProperty('enabled', true);
    });

    it('PUT .../webhooks/:id — should update the description and disable the webhook', async () => {
      const res = await withKey(
        request(app.getHttpServer())
          .put(`${WEBHOOKS_BASE}/${webhookId}`)
          .send({
            description: 'Updated description',
            enabled: false,
          }),
      ).expect(200);

      expect(res.body).toHaveProperty('enabled', false);
      expect(res.body).toHaveProperty('description', 'Updated description');
    });

    it('GET .../webhooks/:id — should reflect the update', async () => {
      const res = await withKey(
        request(app.getHttpServer()).get(`${WEBHOOKS_BASE}/${webhookId}`),
      ).expect(200);

      expect(res.body).toHaveProperty('enabled', false);
      expect(res.body).toHaveProperty('description', 'Updated description');
    });

    it('GET .../webhooks/non-existent-id — should return 404', async () => {
      await withKey(
        request(app.getHttpServer()).get(
          `${WEBHOOKS_BASE}/00000000-0000-0000-0000-000000000000`,
        ),
      ).expect(404);
    });

    it('DELETE .../webhooks/:id — should delete the webhook', async () => {
      await withKey(
        request(app.getHttpServer()).delete(`${WEBHOOKS_BASE}/${webhookId}`),
      ).expect(204);
    });

    it('GET .../webhooks/:id — should return 404 after deletion', async () => {
      await withKey(
        request(app.getHttpServer()).get(`${WEBHOOKS_BASE}/${webhookId}`),
      ).expect(404);
    });
  });

  // ─── 3. EVENT TYPE FILTERING ───────────────────────────────────────────

  describe('Event type filtering', () => {
    it('should only subscribe to the specified event types', async () => {
      const res = await withKey(
        request(app.getHttpServer())
          .post(WEBHOOKS_BASE)
          .send({
            url: WEBHOOK_URL,
            secret: WEBHOOK_SECRET,
            eventTypes: ['user.created', 'user.deleted'],
          }),
      ).expect(201);

      expect(res.body.eventTypes).toHaveLength(2);
      expect(res.body.eventTypes).toContain('user.created');
      expect(res.body.eventTypes).toContain('user.deleted');
      expect(res.body.eventTypes).not.toContain('user.login');

      await ctx.prisma.webhook.delete({ where: { id: res.body.id } }).catch(() => {});
    });

    it('should allow updating eventTypes via PUT', async () => {
      const createRes = await withKey(
        request(app.getHttpServer())
          .post(WEBHOOKS_BASE)
          .send({
            url: WEBHOOK_URL,
            secret: WEBHOOK_SECRET,
            eventTypes: ['user.login'],
          }),
      ).expect(201);

      const id = createRes.body.id;

      const updateRes = await withKey(
        request(app.getHttpServer())
          .put(`${WEBHOOKS_BASE}/${id}`)
          .send({ eventTypes: ['user.created', 'token.issued'] }),
      ).expect(200);

      expect(updateRes.body.eventTypes).toContain('user.created');
      expect(updateRes.body.eventTypes).toContain('token.issued');
      expect(updateRes.body.eventTypes).not.toContain('user.login');

      await ctx.prisma.webhook.delete({ where: { id } }).catch(() => {});
    });
  });

  // ─── 4. TEST WEBHOOK ENDPOINT ──────────────────────────────────────────

  describe('Test webhook and delivery log', () => {
    let webhookId: string;

    beforeAll(async () => {
      const res = await withKey(
        request(app.getHttpServer())
          .post(WEBHOOKS_BASE)
          .send({
            url: WEBHOOK_URL,
            secret: WEBHOOK_SECRET,
            eventTypes: ['webhook.test'],
          }),
      ).expect(201);
      webhookId = res.body.id;
    });

    afterAll(async () => {
      await ctx.prisma.webhook.delete({ where: { id: webhookId } }).catch(() => {});
    });

    it('POST .../webhooks/:id/test — should attempt delivery and return a response', async () => {
      const res = await withKey(
        request(app.getHttpServer()).post(`${WEBHOOKS_BASE}/${webhookId}/test`),
      ).expect(200);

      // The implementation uses fire-and-forget delivery; the endpoint returns
      // a queued acknowledgement immediately rather than waiting for delivery.
      expect(res.body).toHaveProperty('message');
    });

    it('GET .../webhooks/:id/deliveries — should list delivery attempts', async () => {
      // Wait briefly for the delivery record to be written
      await new Promise<void>((resolve) => setTimeout(resolve, 500));

      const res = await withKey(
        request(app.getHttpServer()).get(
          `${WEBHOOKS_BASE}/${webhookId}/deliveries`,
        ),
      ).expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);

      const delivery = res.body[0];
      expect(delivery).toHaveProperty('webhookId', webhookId);
      expect(delivery).toHaveProperty('eventType', 'webhook.test');
      expect(delivery).toHaveProperty('payload');
    });
  });

  // ─── 5. WEBHOOK SIGNING VERIFICATION ──────────────────────────────────

  describe('Webhook signing verification', () => {
    it('should verify that HMAC-SHA256 signature matches the payload', async () => {
      // Retrieve the service directly to verify the signing logic
      const webhooksService = app.get(WebhooksService);

      const testSecret = 'my-webhook-signing-secret';
      const testPayload = JSON.stringify({
        eventType: 'user.login',
        userId: 'user-123',
        timestamp: '2025-01-01T00:00:00Z',
      });

      const signature = webhooksService.signPayload(testSecret, testPayload);

      // The signature format is "sha256=<hex>"
      expect(signature).toMatch(/^sha256=[a-f0-9]{64}$/);

      // Verify the HMAC independently
      const expected =
        'sha256=' +
        createHmac('sha256', testSecret).update(testPayload).digest('hex');

      expect(signature).toBe(expected);
    });

    it('should produce different signatures for different secrets', async () => {
      const webhooksService = app.get(WebhooksService);
      const payload = JSON.stringify({ eventType: 'user.login' });

      const sig1 = webhooksService.signPayload('secret-one', payload);
      const sig2 = webhooksService.signPayload('secret-two', payload);

      expect(sig1).not.toBe(sig2);
    });

    it('should produce different signatures for different payloads', async () => {
      const webhooksService = app.get(WebhooksService);
      const secret = 'same-secret';

      const sig1 = webhooksService.signPayload(
        secret,
        JSON.stringify({ eventType: 'user.login' }),
      );
      const sig2 = webhooksService.signPayload(
        secret,
        JSON.stringify({ eventType: 'user.deleted' }),
      );

      expect(sig1).not.toBe(sig2);
    });
  });
});
