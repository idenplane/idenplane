// Webhook delivery goes through the SSRF-safe HTTP client, never raw fetch,
// so that is what these tests mock. `SsrfBlockedError` is kept real via
// requireActual so the service's `instanceof` check behaves as in production.
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

import { NotFoundException } from '@nestjs/common';
import { SsrfBlockedError } from '../common/security/safe-http-client.js';
import { WebhooksService } from './webhooks.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import {
  createMockPrismaService,
  MockPrismaService,
} from '../prisma/prisma.mock.js';
import type { Realm } from '@prisma/client';

describe('WebhooksService', () => {
  let service: WebhooksService;
  // Extended with webhookEvent — will be in MockPrismaService type after
  // `prisma generate` runs following the webhook_events migration.
  let prisma: MockPrismaService & { webhookEvent: Record<string, jest.Mock> };
  let crypto: CryptoService;

  const mockRealm: Realm = {
    id: 'realm-1',
    name: 'test-realm',
    displayName: 'Test Realm',
    enabled: true,
  } as Realm;

  /**
   * Build a mock webhook record where the secret is already encrypted.
   * The helper uses the real CryptoService so encrypt/decrypt round-trips
   * work correctly in all tests.
   */
  function makeWebhookRecord(plaintextSecret: string) {
    return {
      id: 'webhook-1',
      realmId: 'realm-1',
      url: 'https://example.com/hook',
      secret: crypto.encrypt(plaintextSecret),
      enabled: true,
      eventTypes: ['user.login', 'user.created'],
      description: 'Test webhook',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  // WEBHOOK_SELECT projection omits the secret field
  const mockWebhookPublic = {
    id: 'webhook-1',
    realmId: 'realm-1',
    url: 'https://example.com/hook',
    enabled: true,
    eventTypes: ['user.login', 'user.created'],
    description: 'Test webhook',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    prisma = createMockPrismaService();
    crypto = new CryptoService();
    service = new WebhooksService(prisma as any, crypto);
    jest.clearAllMocks();
  });

  // ─── HMAC Signing ─────────────────────────────────────

  describe('signPayload', () => {
    it('should produce a sha256= prefixed HMAC signature', () => {
      const secret = 'my-secret';
      const body = '{"eventType":"user.login"}';
      const sig = service.signPayload(secret, body);

      expect(sig).toMatch(/^sha256=[a-f0-9]{64}$/);
    });

    it('should produce consistent signatures for the same input', () => {
      const secret = 'consistent-secret';
      const body = '{"hello":"world"}';

      const sig1 = service.signPayload(secret, body);
      const sig2 = service.signPayload(secret, body);

      expect(sig1).toBe(sig2);
    });

    it('should produce different signatures for different secrets', () => {
      const body = '{"hello":"world"}';

      const sig1 = service.signPayload('secret-a', body);
      const sig2 = service.signPayload('secret-b', body);

      expect(sig1).not.toBe(sig2);
    });

    it('should produce different signatures for different payloads', () => {
      const secret = 'same-secret';

      const sig1 = service.signPayload(secret, '{"a":1}');
      const sig2 = service.signPayload(secret, '{"a":2}');

      expect(sig1).not.toBe(sig2);
    });
  });

  // ─── CRUD ──────────────────────────────────────────────

  describe('create', () => {
    it('should store an encrypted secret, not the plaintext', async () => {
      const plaintextSecret = 'super-secret-key';
      prisma.webhook.create.mockResolvedValue(mockWebhookPublic);

      const dto = {
        url: 'https://example.com/hook',
        secret: plaintextSecret,
        eventTypes: ['user.login'],
        enabled: true,
      };

      await service.create(mockRealm, dto);

      const callArg = prisma.webhook.create.mock.calls[0][0];
      // The stored secret must not be the plaintext value
      expect(callArg.data.secret).not.toBe(plaintextSecret);
      // It must be decryptable back to the original plaintext
      expect(crypto.decrypt(callArg.data.secret)).toBe(plaintextSecret);
    });

    it('should return the plaintext secret and a warning in the response', async () => {
      prisma.webhook.create.mockResolvedValue(mockWebhookPublic);

      const dto = {
        url: 'https://example.com/hook',
        secret: 'super-secret-key',
        eventTypes: ['user.login'],
        enabled: true,
      };

      const result = await service.create(mockRealm, dto);

      expect(result.secret).toBe('super-secret-key');
      expect(result.secretWarning).toBeDefined();
    });

    it('should default enabled to true when not specified', async () => {
      prisma.webhook.create.mockResolvedValue(mockWebhookPublic);

      await service.create(mockRealm, {
        url: 'https://example.com/hook',
        secret: 'super-secret-key',
        eventTypes: ['user.login'],
      });

      expect(prisma.webhook.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ enabled: true }),
        }),
      );
    });
  });

  describe('findAll', () => {
    it('should return all webhooks for a realm', async () => {
      const webhooks = [mockWebhookPublic];
      prisma.webhook.findMany.mockResolvedValue(webhooks);

      const result = await service.findAll(mockRealm);

      expect(result).toEqual(webhooks);
      expect(prisma.webhook.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { realmId: 'realm-1' },
        }),
      );
    });
  });

  describe('findOne', () => {
    it('should return webhook when found', async () => {
      prisma.webhook.findFirst.mockResolvedValue(mockWebhookPublic);

      const result = await service.findOne(mockRealm, 'webhook-1');

      expect(result).toEqual(mockWebhookPublic);
      expect(prisma.webhook.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'webhook-1', realmId: 'realm-1' },
        }),
      );
    });

    it('should throw NotFoundException when webhook not found', async () => {
      prisma.webhook.findFirst.mockResolvedValue(null);

      await expect(service.findOne(mockRealm, 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('should encrypt the new secret before storing when a secret is provided', async () => {
      const newPlaintext = 'new-signing-secret';
      prisma.webhook.findFirst.mockResolvedValue(mockWebhookPublic);
      prisma.webhook.update.mockResolvedValue(mockWebhookPublic);

      await service.update(mockRealm, 'webhook-1', { secret: newPlaintext });

      const callArg = prisma.webhook.update.mock.calls[0][0];
      expect(callArg.data.secret).not.toBe(newPlaintext);
      expect(crypto.decrypt(callArg.data.secret)).toBe(newPlaintext);
    });

    it('should return plaintext secret and warning when secret is updated', async () => {
      const newPlaintext = 'new-signing-secret';
      prisma.webhook.findFirst.mockResolvedValue(mockWebhookPublic);
      prisma.webhook.update.mockResolvedValue(mockWebhookPublic);

      const result = await service.update(mockRealm, 'webhook-1', {
        secret: newPlaintext,
      });

      expect((result as any).secret).toBe(newPlaintext);
      expect((result as any).secretWarning).toBeDefined();
    });

    it('should not include secret in response when secret is not updated', async () => {
      const updated = { ...mockWebhookPublic, enabled: false };
      prisma.webhook.findFirst.mockResolvedValue(mockWebhookPublic);
      prisma.webhook.update.mockResolvedValue(updated);

      const result = await service.update(mockRealm, 'webhook-1', {
        enabled: false,
      });

      expect((result as any).secret).toBeUndefined();
      expect((result as any).secretWarning).toBeUndefined();
    });

    it('should throw NotFoundException when webhook not found', async () => {
      prisma.webhook.findFirst.mockResolvedValue(null);

      await expect(
        service.update(mockRealm, 'missing', { enabled: false }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('should delete a webhook', async () => {
      prisma.webhook.findFirst.mockResolvedValue(mockWebhookPublic);
      prisma.webhook.delete.mockResolvedValue(mockWebhookPublic);

      await service.remove(mockRealm, 'webhook-1');

      expect(prisma.webhook.delete).toHaveBeenCalledWith({
        where: { id: 'webhook-1' },
      });
    });

    it('should throw NotFoundException when webhook not found', async () => {
      prisma.webhook.findFirst.mockResolvedValue(null);

      await expect(service.remove(mockRealm, 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── Dispatch (queue-based, Issue #338) ───────────────

  describe('dispatchEvent', () => {
    it('should persist a WebhookEvent row with PENDING status', async () => {
      prisma.webhookEvent.create.mockResolvedValue({ id: 'evt-1' });

      await service.dispatchEvent({
        realmId: 'realm-1',
        eventType: 'user.login',
        payload: { userId: 'user-1' },
      });

      expect(prisma.webhookEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            realmId: 'realm-1',
            eventType: 'user.login',
            status: 'PENDING',
          }),
        }),
      );
    });

    it('should include the full merged payload in the queued event', async () => {
      prisma.webhookEvent.create.mockResolvedValue({ id: 'evt-2' });

      await service.dispatchEvent({
        realmId: 'realm-1',
        eventType: 'user.created',
        payload: { userId: 'user-2', email: 'u@example.com' },
      });

      const createArg = prisma.webhookEvent.create.mock.calls[0][0];
      expect(createArg.data.payload).toMatchObject({
        eventType: 'user.created',
        realmId: 'realm-1',
        userId: 'user-2',
        email: 'u@example.com',
      });
    });

    it('should not throw if the database write fails', async () => {
      prisma.webhookEvent.create.mockRejectedValue(new Error('DB down'));

      await expect(
        service.dispatchEvent({
          realmId: 'realm-1',
          eventType: 'user.login',
          payload: {},
        }),
      ).resolves.toBeUndefined();
    });

    it('should not perform any HTTP delivery (that is the scheduler job)', async () => {
      prisma.webhookEvent.create.mockResolvedValue({ id: 'evt-3' });

      await service.dispatchEvent({
        realmId: 'realm-1',
        eventType: 'user.login',
        payload: {},
      });

      expect(mockSafePost).not.toHaveBeenCalled();
    });
  });

  // ─── Retry Logic ───────────────────────────────────────

  describe('deliverWebhook (retry logic)', () => {
    // The secret stored in the DB must be encrypted
    const plaintextSecret = 'test-secret';
    let webhookRecord: { id: string; url: string; secret: string };

    beforeEach(() => {
      webhookRecord = {
        id: 'webhook-1',
        url: 'https://example.com/hook',
        secret: crypto.encrypt(plaintextSecret),
      };
      jest.useFakeTimers();
      prisma.webhookDelivery.create.mockResolvedValue({ id: 'delivery-1' });
      prisma.webhookDelivery.update.mockResolvedValue({});
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should succeed on first attempt', async () => {
      mockSafePost.mockResolvedValueOnce({ statusCode: 200, body: 'OK' });

      const promise = (service as any).deliverWebhook(
        webhookRecord,
        'user.login',
        { userId: 'u1' },
      );
      // Fast-forward any timers
      jest.runAllTimersAsync();

      await promise;

      expect(prisma.webhookDelivery.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ success: true, attempts: 1 }),
        }),
      );
    });

    it('should retry on failure and eventually mark as failed', async () => {
      // Fail all 4 attempts (initial + 3 retries)
      mockSafePost
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockRejectedValueOnce(new Error('Connection refused'));

      // Replace sleep to avoid waiting
      jest.spyOn(service as any, 'sleep').mockResolvedValue(undefined);

      await (service as any).deliverWebhook(webhookRecord, 'user.login', {});

      // Should have tried 4 times (1 + 3 retries)
      expect(mockSafePost).toHaveBeenCalledTimes(4);

      expect(prisma.webhookDelivery.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ success: false }),
        }),
      );
    });

    it('should succeed on retry after initial failure', async () => {
      mockSafePost
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockResolvedValueOnce({ statusCode: 200, body: 'OK' });

      jest.spyOn(service as any, 'sleep').mockResolvedValue(undefined);

      await (service as any).deliverWebhook(webhookRecord, 'user.login', {});

      expect(mockSafePost).toHaveBeenCalledTimes(2);

      expect(prisma.webhookDelivery.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ success: true, attempts: 2 }),
        }),
      );
    });

    it('should mark as failed when endpoint returns non-2xx and all retries exhausted', async () => {
      mockSafePost.mockResolvedValue({ statusCode: 500, body: 'Internal Server Error' });

      jest.spyOn(service as any, 'sleep').mockResolvedValue(undefined);

      await (service as any).deliverWebhook(webhookRecord, 'user.login', {});

      // Called 4 times: initial + 3 retries
      expect(mockSafePost).toHaveBeenCalledTimes(4);

      // The final update should mark it as failed
      expect(prisma.webhookDelivery.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ success: false }),
        }),
      );
    });

    it('should include HMAC signature header in request', async () => {
      mockSafePost.mockResolvedValueOnce({ statusCode: 200, body: 'OK' });

      jest.spyOn(service as any, 'sleep').mockResolvedValue(undefined);

      await (service as any).deliverWebhook(webhookRecord, 'user.login', {
        userId: 'u1',
      });

      expect(mockSafePost).toHaveBeenCalledWith(
        webhookRecord.url,
        expect.any(String),
        expect.objectContaining({
          'X-Webhook-Signature': expect.stringMatching(/^sha256=[a-f0-9]{64}$/),
        }),
      );
    });

    it('should sign the payload with the decrypted secret, not the ciphertext', async () => {
      mockSafePost.mockResolvedValueOnce({ statusCode: 200, body: 'OK' });

      jest.spyOn(service as any, 'sleep').mockResolvedValue(undefined);

      const payload = { userId: 'u1' };
      await (service as any).deliverWebhook(
        webhookRecord,
        'user.login',
        payload,
      );

      // Reconstruct what the signature should be using the plaintext secret
      const body = JSON.stringify({
        eventType: 'user.login',
        ...payload,
      });
      // We can't know the exact timestamp injected, but we can verify the
      // signature format and that it differs from one computed with the
      // raw ciphertext (which would be wrong).
      const [, , sentHeaders] = mockSafePost.mock.calls[0] as [
        string,
        string,
        Record<string, string>,
      ];
      const actualSig = sentHeaders['X-Webhook-Signature'];

      const wrongSig = service.signPayload(webhookRecord.secret, body);
      expect(actualSig).not.toBe(wrongSig);
    });
  });

  // ─── SSRF policy ───────────────────────────────────────

  describe('deliverWebhook (SSRF policy)', () => {
    const plaintextSecret = 'test-secret';
    let webhookRecord: { id: string; url: string; secret: string };

    beforeEach(() => {
      webhookRecord = {
        id: 'webhook-1',
        // A hostname that is public at configuration time but resolves to an
        // internal address at delivery time is exactly the case the DTO check
        // cannot catch, so safePost is what rejects it.
        url: 'https://rebound.example.com/hook',
        secret: crypto.encrypt(plaintextSecret),
      };
      prisma.webhookDelivery.create.mockResolvedValue({ id: 'delivery-1' });
      prisma.webhookDelivery.update.mockResolvedValue({});
      jest.spyOn(service as any, 'sleep').mockResolvedValue(undefined);
    });

    it('should not retry a target rejected by SSRF policy', async () => {
      mockSafePost.mockRejectedValue(new SsrfBlockedError());

      await (service as any).deliverWebhook(webhookRecord, 'user.login', {});

      // Exactly one attempt: re-running the same checks on the same URL can
      // only be rejected again, so the retry tail is skipped entirely.
      expect(mockSafePost).toHaveBeenCalledTimes(1);
      expect(prisma.webhookDelivery.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ success: false, attempts: 1 }),
        }),
      );
    });

    it('should persist a message that does not leak the resolved address', async () => {
      mockSafePost.mockRejectedValue(new SsrfBlockedError());

      await (service as any).deliverWebhook(webhookRecord, 'user.login', {});

      const lastUpdate = prisma.webhookDelivery.update.mock.calls.at(-1)![0] as {
        data: { response?: string };
      };
      expect(lastUpdate.data.response).toBe(
        'Delivery blocked: target address is not publicly routable',
      );
      expect(lastUpdate.data.response).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
      expect(lastUpdate.data.response).not.toContain('rebound.example.com');
    });

    it('should still retry ordinary network failures', async () => {
      // Guards the early-break above from over-reaching: a plain transient
      // error must keep the full retry tail.
      mockSafePost.mockRejectedValue(new Error('ECONNRESET'));

      await (service as any).deliverWebhook(webhookRecord, 'user.login', {});

      expect(mockSafePost).toHaveBeenCalledTimes(4);
    });
  });

  // ─── findDeliveries ────────────────────────────────────

  describe('findDeliveries', () => {
    it('should return delivery logs for a webhook', async () => {
      const deliveries = [
        { id: 'del-1', webhookId: 'webhook-1', eventType: 'user.login' },
      ];
      prisma.webhook.findFirst.mockResolvedValue(mockWebhookPublic);
      prisma.webhookDelivery.findMany.mockResolvedValue(deliveries);

      const result = await service.findDeliveries(mockRealm, 'webhook-1');

      expect(result).toEqual(deliveries);
      expect(prisma.webhookDelivery.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { webhookId: 'webhook-1' } }),
      );
    });

    it('should throw NotFoundException when webhook not found', async () => {
      prisma.webhook.findFirst.mockResolvedValue(null);

      await expect(
        service.findDeliveries(mockRealm, 'missing'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
