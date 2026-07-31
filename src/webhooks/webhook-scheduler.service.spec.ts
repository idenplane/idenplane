// Scheduled delivery goes through the SSRF-safe HTTP client, never raw fetch,
// so that is what these tests mock.
const mockSafePost = jest.fn();
jest.mock('../common/security/safe-http-client.js', () => ({
  ...jest.requireActual('../common/security/safe-http-client.js'),
  safePost: (...args: unknown[]) => mockSafePost(...args),
}));

// Any direct fetch() from the delivery path is a regression back to the
// unprotected client, so fail loudly rather than silently allowing it.
const mockFetch = jest.fn(() => {
  throw new Error('webhook delivery must not call fetch() directly');
});
global.fetch = mockFetch as any;

import { WebhookSchedulerService } from './webhook-scheduler.service.js';
import { SsrfBlockedError } from '../common/security/safe-http-client.js';
import { CryptoService } from '../crypto/crypto.service.js';
import {
  createMockPrismaService,
  type MockPrismaService,
} from '../prisma/prisma.mock.js';

describe('WebhookSchedulerService', () => {
  let service: WebhookSchedulerService;
  // Use `any` here because `webhookEvent` is not yet in the generated Prisma
  // client type — it will be after `prisma generate` runs following the
  // 20260324960000_add_webhook_event_queue migration.
  let prisma: MockPrismaService & { webhookEvent: Record<string, jest.Mock> };
  let crypto: CryptoService;

  const PLAINTEXT_SECRET = 'test-secret';

  const pendingEvent = {
    id: 'evt-1',
    realmId: 'realm-1',
    eventType: 'user.login',
    payload: {
      eventType: 'user.login',
      timestamp: '2026-03-24T00:00:00.000Z',
      realmId: 'realm-1',
      userId: 'user-1',
    },
    status: 'PENDING',
    attempts: 0,
    maxAttempts: 4,
    nextRetryAt: new Date('2026-01-01'),
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // Lazily constructed so that crypto is available first
  let mockWebhook: {
    id: string;
    realmId: string;
    url: string;
    secret: string;
    enabled: boolean;
    eventTypes: string[];
  };

  beforeEach(() => {
    prisma = createMockPrismaService();
    crypto = new CryptoService();
    service = new WebhookSchedulerService(prisma as any, crypto);
    // Build a webhook record whose secret is properly encrypted
    mockWebhook = {
      id: 'webhook-1',
      realmId: 'realm-1',
      url: 'https://example.com/hook',
      secret: crypto.encrypt(PLAINTEXT_SECRET),
      enabled: true,
      eventTypes: ['user.login'],
    };
    jest.clearAllMocks();
  });

  // ─── processQueue ─────────────────────────────────────────────────────────

  describe('processQueue', () => {
    it('should do nothing when the queue is empty', async () => {
      prisma.webhookEvent.findMany.mockResolvedValue([]);

      await service.processQueue();

      expect(prisma.webhookEvent.updateMany).not.toHaveBeenCalled();
    });

    it('should mark events as PROCESSING before delivery', async () => {
      prisma.webhookEvent.findMany.mockResolvedValue([pendingEvent]);
      prisma.webhookEvent.updateMany.mockResolvedValue({ count: 1 });
      prisma.webhook.findMany.mockResolvedValue([]);
      prisma.webhookEvent.update.mockResolvedValue({});

      await service.processQueue();

      expect(prisma.webhookEvent.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { in: ['evt-1'] },
            status: { in: ['PENDING', 'FAILED'] },
          }),
          data: { status: 'PROCESSING' },
        }),
      );
    });

    it('should query PENDING and FAILED events that are due', async () => {
      prisma.webhookEvent.findMany.mockResolvedValue([]);

      await service.processQueue();

      const findCall = prisma.webhookEvent.findMany.mock.calls[0][0];
      expect(findCall.where.status).toEqual({ in: ['PENDING', 'FAILED'] });
      expect(findCall.where.nextRetryAt).toBeDefined();
    });
  });

  // ─── processEvent ─────────────────────────────────────────────────────────

  describe('processEvent (via processQueue)', () => {
    it('should mark event DELIVERED when no subscribers exist', async () => {
      prisma.webhookEvent.findMany.mockResolvedValue([pendingEvent]);
      prisma.webhookEvent.updateMany.mockResolvedValue({ count: 1 });
      // No webhooks subscribed
      prisma.webhook.findMany.mockResolvedValue([]);
      prisma.webhookEvent.update.mockResolvedValue({});

      await service.processQueue();

      expect(prisma.webhookEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'evt-1' },
          data: expect.objectContaining({ status: 'DELIVERED' }),
        }),
      );
    });

    it('should mark event DELIVERED when HTTP delivery succeeds', async () => {
      prisma.webhookEvent.findMany.mockResolvedValue([pendingEvent]);
      prisma.webhookEvent.updateMany.mockResolvedValue({ count: 1 });
      prisma.webhook.findMany.mockResolvedValue([mockWebhook]);
      prisma.webhookDelivery.create.mockResolvedValue({ id: 'del-1' });
      prisma.webhookDelivery.update.mockResolvedValue({});
      prisma.webhookEvent.update.mockResolvedValue({});

      mockSafePost.mockResolvedValueOnce({ statusCode: 200, body: 'OK' });

      await service.processQueue();

      expect(prisma.webhookEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'evt-1' },
          data: expect.objectContaining({ status: 'DELIVERED' }),
        }),
      );
    });

    it('should schedule retry when HTTP delivery fails and attempts remain', async () => {
      prisma.webhookEvent.findMany.mockResolvedValue([pendingEvent]);
      prisma.webhookEvent.updateMany.mockResolvedValue({ count: 1 });
      prisma.webhook.findMany.mockResolvedValue([mockWebhook]);
      prisma.webhookDelivery.create.mockResolvedValue({ id: 'del-1' });
      prisma.webhookDelivery.update.mockResolvedValue({});
      prisma.webhookEvent.update.mockResolvedValue({});

      mockSafePost.mockRejectedValueOnce(new Error('Connection refused'));

      await service.processQueue();

      const updateCall = prisma.webhookEvent.update.mock.calls[0][0];
      expect(updateCall.data.status).toBe('FAILED');
      expect(updateCall.data.nextRetryAt).toBeInstanceOf(Date);
      expect(updateCall.data.nextRetryAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('should mark event terminally FAILED when all attempts are exhausted', async () => {
      const exhaustedEvent = {
        ...pendingEvent,
        status: 'FAILED',
        attempts: 4,
        maxAttempts: 4,
      };

      prisma.webhookEvent.findMany.mockResolvedValue([exhaustedEvent]);
      prisma.webhookEvent.updateMany.mockResolvedValue({ count: 1 });
      prisma.webhook.findMany.mockResolvedValue([mockWebhook]);
      prisma.webhookDelivery.create.mockResolvedValue({ id: 'del-1' });
      prisma.webhookDelivery.update.mockResolvedValue({});
      prisma.webhookEvent.update.mockResolvedValue({});

      mockSafePost.mockRejectedValueOnce(new Error('Still down'));

      await service.processQueue();

      const updateCall = prisma.webhookEvent.update.mock.calls[0][0];
      expect(updateCall.data.status).toBe('FAILED');
      // nextRetryAt should NOT be set for a terminal failure
      expect(updateCall.data.nextRetryAt).toBeUndefined();
    });

    it('should create a WebhookDelivery log record per subscriber', async () => {
      prisma.webhookEvent.findMany.mockResolvedValue([pendingEvent]);
      prisma.webhookEvent.updateMany.mockResolvedValue({ count: 1 });
      prisma.webhook.findMany.mockResolvedValue([mockWebhook]);
      prisma.webhookDelivery.create.mockResolvedValue({ id: 'del-1' });
      prisma.webhookDelivery.update.mockResolvedValue({});
      prisma.webhookEvent.update.mockResolvedValue({});

      mockSafePost.mockResolvedValueOnce({ statusCode: 200, body: 'OK' });

      await service.processQueue();

      expect(prisma.webhookDelivery.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            webhookId: 'webhook-1',
            eventType: 'user.login',
          }),
        }),
      );
    });

    it('should sign the payload with the decrypted secret', async () => {
      prisma.webhookEvent.findMany.mockResolvedValue([pendingEvent]);
      prisma.webhookEvent.updateMany.mockResolvedValue({ count: 1 });
      prisma.webhook.findMany.mockResolvedValue([mockWebhook]);
      prisma.webhookDelivery.create.mockResolvedValue({ id: 'del-1' });
      prisma.webhookDelivery.update.mockResolvedValue({});
      prisma.webhookEvent.update.mockResolvedValue({});

      mockSafePost.mockResolvedValueOnce({ statusCode: 200, body: 'OK' });

      await service.processQueue();

      const [, , sentHeaders] = mockSafePost.mock.calls[0] as [
        string,
        string,
        Record<string, string>,
      ];
      const sig = sentHeaders['X-Webhook-Signature'];
      expect(sig).toMatch(/^sha256=[a-f0-9]{64}$/);

      // The signature should differ from one computed with the ciphertext directly
      const wrongSig = service.signPayload(
        mockWebhook.secret,
        JSON.stringify(pendingEvent.payload),
      );
      expect(sig).not.toBe(wrongSig);
    });

    it('should fail the event without leaking the target when SSRF policy blocks delivery', async () => {
      prisma.webhookEvent.findMany.mockResolvedValue([pendingEvent]);
      prisma.webhookEvent.updateMany.mockResolvedValue({ count: 1 });
      prisma.webhook.findMany.mockResolvedValue([mockWebhook]);
      prisma.webhookDelivery.create.mockResolvedValue({ id: 'del-1' });
      prisma.webhookDelivery.update.mockResolvedValue({});
      prisma.webhookEvent.update.mockResolvedValue({});

      mockSafePost.mockRejectedValueOnce(new SsrfBlockedError());

      await service.processQueue();

      // The event is never marked DELIVERED for a blocked target...
      const eventUpdate = prisma.webhookEvent.update.mock.calls[0][0] as {
        data: { status: string; lastError?: string | null };
      };
      expect(eventUpdate.data.status).toBe('FAILED');

      // ...and neither the event nor the delivery row records anything about
      // the address that was rejected.
      expect(eventUpdate.data.lastError).toBe(
        'Delivery blocked: target address is not publicly routable',
      );
      const deliveryUpdate = prisma.webhookDelivery.update.mock.calls[0][0] as {
        data: { success: boolean; response?: string };
      };
      expect(deliveryUpdate.data.success).toBe(false);
      expect(deliveryUpdate.data.response).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
    });
  });

  // ─── signPayload ──────────────────────────────────────────────────────────

  describe('signPayload', () => {
    it('should produce a sha256= prefixed HMAC signature', () => {
      const sig = service.signPayload(
        'my-secret',
        '{"eventType":"user.login"}',
      );
      expect(sig).toMatch(/^sha256=[a-f0-9]{64}$/);
    });

    it('should produce consistent signatures for the same inputs', () => {
      const sig1 = service.signPayload('s', 'body');
      const sig2 = service.signPayload('s', 'body');
      expect(sig1).toBe(sig2);
    });

    it('should produce different signatures for different secrets', () => {
      const sig1 = service.signPayload('secret-a', 'body');
      const sig2 = service.signPayload('secret-b', 'body');
      expect(sig1).not.toBe(sig2);
    });
  });
});
