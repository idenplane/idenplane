import { ConsentService, type ConsentRequest } from './consent.service.js';
import {
  createMockPrismaService,
  type MockPrismaService,
} from '../prisma/prisma.mock.js';

describe('ConsentService', () => {
  let service: ConsentService;
  let prisma: MockPrismaService;
  let crypto: {
    generateSecret: jest.Mock;
    sha256: jest.Mock;
    verifyPassword: jest.Mock;
    hashPassword: jest.Mock;
  };

  const realmId = 'realm-1';
  const userId = 'user-1';
  const clientId = 'client-1';

  const mockConsentRequest: ConsentRequest = {
    userId: 'user-1',
    clientId: 'client-1',
    clientName: 'My App',
    realmName: 'test-realm',
    scopes: ['openid', 'profile'],
    oauthParams: { redirect_uri: 'https://app.example.com/callback' },
  };

  beforeEach(() => {
    prisma = createMockPrismaService();
    crypto = {
      generateSecret: jest.fn().mockReturnValue('raw-token-123'),
      sha256: jest.fn().mockReturnValue('hashed-token-123'),
      verifyPassword: jest.fn(),
      hashPassword: jest.fn(),
    };
    // No categories configured by default → recordConsentHistory tags nothing.
    prisma.consentCategory.findMany.mockResolvedValue([]);
    service = new ConsentService(prisma as any, crypto as any);
  });

  // ─── hasConsent ─────────────────────────────────────────────

  describe('hasConsent', () => {
    it('should return false when no consent record exists', async () => {
      prisma.userConsent.findUnique.mockResolvedValue(null);

      const result = await service.hasConsent(userId, clientId, [
        'openid',
        'profile',
      ]);

      expect(result).toBe(false);
      expect(prisma.userConsent.findUnique).toHaveBeenCalledWith({
        where: { userId_clientId: { userId, clientId } },
      });
    });

    it('should return true when all requested scopes are covered', async () => {
      prisma.userConsent.findUnique.mockResolvedValue({
        userId,
        clientId,
        scopes: ['openid', 'profile', 'email'],
      });

      const result = await service.hasConsent(userId, clientId, [
        'openid',
        'profile',
      ]);

      expect(result).toBe(true);
    });

    it('should return false when some requested scopes are missing', async () => {
      prisma.userConsent.findUnique.mockResolvedValue({
        userId,
        clientId,
        scopes: ['openid'],
      });

      const result = await service.hasConsent(userId, clientId, [
        'openid',
        'profile',
      ]);

      expect(result).toBe(false);
    });

    it('should return true when requested scopes match exactly', async () => {
      prisma.userConsent.findUnique.mockResolvedValue({
        userId,
        clientId,
        scopes: ['openid', 'profile'],
      });

      const result = await service.hasConsent(userId, clientId, [
        'openid',
        'profile',
      ]);

      expect(result).toBe(true);
    });

    it('should return true when no scopes are requested', async () => {
      prisma.userConsent.findUnique.mockResolvedValue({
        userId,
        clientId,
        scopes: ['openid'],
      });

      const result = await service.hasConsent(userId, clientId, []);

      expect(result).toBe(true);
    });
  });

  // ─── grantConsent ───────────────────────────────────────────

  describe('grantConsent', () => {
    it('should upsert consent with the given scopes', async () => {
      const scopes = ['openid', 'profile'];
      const expected = { userId, clientId, scopes };
      prisma.userConsent.upsert.mockResolvedValue(expected);

      const result = await service.grantConsent(
        realmId,
        userId,
        clientId,
        scopes,
      );

      expect(result).toEqual(expected);
      expect(prisma.userConsent.upsert).toHaveBeenCalledWith({
        where: { userId_clientId: { userId, clientId } },
        create: { userId, clientId, scopes },
        update: { scopes },
      });
    });

    it('should handle empty scopes array', async () => {
      prisma.userConsent.upsert.mockResolvedValue({
        userId,
        clientId,
        scopes: [],
      });

      await service.grantConsent(realmId, userId, clientId, []);

      expect(prisma.userConsent.upsert).toHaveBeenCalledWith({
        where: { userId_clientId: { userId, clientId } },
        create: { userId, clientId, scopes: [] },
        update: { scopes: [] },
      });
    });
  });

  // ─── resolveCategoryKeys + tagging ──────────────────────────

  describe('category tagging', () => {
    it('resolveCategoryKeys queries enabled categories by scope/key fallback', async () => {
      prisma.consentCategory.findMany.mockResolvedValue([
        { key: 'marketing' },
        { key: 'profile' },
      ]);

      const keys = await service.resolveCategoryKeys(realmId, [
        'openid',
        'profile',
      ]);

      expect(keys).toEqual(['marketing', 'profile']);
      expect(prisma.consentCategory.findMany).toHaveBeenCalledWith({
        where: {
          realmId,
          enabled: true,
          OR: [
            { scopes: { hasSome: ['openid', 'profile'] } },
            {
              AND: [
                { scopes: { isEmpty: true } },
                { key: { in: ['openid', 'profile'] } },
              ],
            },
          ],
        },
        select: { key: true },
        orderBy: { key: 'asc' },
      });
    });

    it('returns no keys for an empty scope list (no query)', async () => {
      const keys = await service.resolveCategoryKeys(realmId, []);
      expect(keys).toEqual([]);
      expect(prisma.consentCategory.findMany).not.toHaveBeenCalled();
    });

    it('grantConsent tags history with the resolved categoryKeys', async () => {
      prisma.userConsent.findUnique.mockResolvedValue(null);
      prisma.userConsent.upsert.mockResolvedValue({ userId, clientId, scopes: ['profile'] });
      prisma.consentCategory.findMany.mockResolvedValue([{ key: 'profile' }]);

      await service.grantConsent(realmId, userId, clientId, ['profile']);

      expect(prisma.userConsentHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'granted',
            metadata: { categoryKeys: ['profile'] },
          }),
        }),
      );
    });

    it('grantConsent records JsonNull metadata when no category matches', async () => {
      prisma.userConsent.findUnique.mockResolvedValue(null);
      prisma.userConsent.upsert.mockResolvedValue({ userId, clientId, scopes: ['openid'] });
      prisma.consentCategory.findMany.mockResolvedValue([]);

      await service.grantConsent(realmId, userId, clientId, ['openid']);

      const arg = prisma.userConsentHistory.create.mock.calls[0][0];
      expect(arg.data.metadata).toBeDefined();
      expect(arg.data.metadata).not.toEqual(
        expect.objectContaining({ categoryKeys: expect.anything() }),
      );
    });
  });

  // ─── revokeConsent ──────────────────────────────────────────

  describe('revokeConsent', () => {
    it('should deleteMany for the user-client pair', async () => {
      prisma.userConsent.deleteMany.mockResolvedValue({ count: 1 });

      await service.revokeConsent(realmId, userId, clientId);

      expect(prisma.userConsent.deleteMany).toHaveBeenCalledWith({
        where: { userId, clientId },
      });
    });

    it('should succeed even when no consent exists', async () => {
      prisma.userConsent.deleteMany.mockResolvedValue({ count: 0 });

      await expect(
        service.revokeConsent(realmId, userId, clientId),
      ).resolves.toBeUndefined();
    });
  });

  // ─── storeConsentRequest ────────────────────────────────────

  describe('storeConsentRequest', () => {
    it('should create a pending action and return the raw token', async () => {
      prisma.pendingAction.create.mockResolvedValue({});

      const result = await service.storeConsentRequest(mockConsentRequest);

      expect(result).toBe('raw-token-123');
      expect(crypto.generateSecret).toHaveBeenCalledWith(16);
      expect(crypto.sha256).toHaveBeenCalledWith('raw-token-123');
      expect(prisma.pendingAction.create).toHaveBeenCalledWith({
        data: {
          tokenHash: 'hashed-token-123',
          type: 'consent_request',
          data: mockConsentRequest,
          expiresAt: expect.any(Date),
        },
      });
    });

    it('should set expiry to approximately 10 minutes in the future', async () => {
      prisma.pendingAction.create.mockResolvedValue({});

      await service.storeConsentRequest(mockConsentRequest);

      const createCall = prisma.pendingAction.create.mock.calls[0][0];
      const expiresAt = createCall.data.expiresAt as Date;
      const expectedExpiry = Date.now() + 10 * 60 * 1000;
      expect(Math.abs(expiresAt.getTime() - expectedExpiry)).toBeLessThan(1000);
    });
  });

  // ─── getConsentRequest ──────────────────────────────────────

  describe('getConsentRequest', () => {
    it('should return undefined when no pending action is found', async () => {
      prisma.pendingAction.findUnique.mockResolvedValue(null);

      const result = await service.getConsentRequest('some-token');

      expect(result).toBeUndefined();
      expect(crypto.sha256).toHaveBeenCalledWith('some-token');
      expect(prisma.pendingAction.findUnique).toHaveBeenCalledWith({
        where: { tokenHash: 'hashed-token-123' },
      });
    });

    it('should return undefined when action type is not consent_request', async () => {
      prisma.pendingAction.findUnique.mockResolvedValue({
        id: 'action-1',
        tokenHash: 'hashed-token-123',
        type: 'password_reset',
        data: mockConsentRequest,
        expiresAt: new Date(Date.now() + 60_000),
      });

      const result = await service.getConsentRequest('some-token');

      expect(result).toBeUndefined();
      expect(prisma.pendingAction.delete).not.toHaveBeenCalled();
    });

    it('should return undefined and clean up when action is expired', async () => {
      const expiredDate = new Date(Date.now() - 60_000);
      prisma.pendingAction.findUnique.mockResolvedValue({
        id: 'action-1',
        tokenHash: 'hashed-token-123',
        type: 'consent_request',
        data: mockConsentRequest,
        expiresAt: expiredDate,
      });
      prisma.pendingAction.delete.mockResolvedValue({});

      const result = await service.getConsentRequest('some-token');

      expect(result).toBeUndefined();
      expect(prisma.pendingAction.delete).toHaveBeenCalledWith({
        where: { id: 'action-1' },
      });
    });

    it('should delete and return data for a valid consent request', async () => {
      const futureDate = new Date(Date.now() + 5 * 60 * 1000);
      prisma.pendingAction.findUnique.mockResolvedValue({
        id: 'action-1',
        tokenHash: 'hashed-token-123',
        type: 'consent_request',
        data: mockConsentRequest,
        expiresAt: futureDate,
      });
      prisma.pendingAction.delete.mockResolvedValue({});

      const result = await service.getConsentRequest('some-token');

      expect(result).toEqual(mockConsentRequest);
      expect(prisma.pendingAction.delete).toHaveBeenCalledWith({
        where: { id: 'action-1' },
      });
    });

    it('should consume the request (one-time use) by deleting it', async () => {
      const futureDate = new Date(Date.now() + 5 * 60 * 1000);
      prisma.pendingAction.findUnique.mockResolvedValue({
        id: 'action-42',
        tokenHash: 'hashed-token-123',
        type: 'consent_request',
        data: { some: 'data' },
        expiresAt: futureDate,
      });
      prisma.pendingAction.delete.mockResolvedValue({});

      await service.getConsentRequest('token');

      expect(prisma.pendingAction.delete).toHaveBeenCalledTimes(1);
      expect(prisma.pendingAction.delete).toHaveBeenCalledWith({
        where: { id: 'action-42' },
      });
    });
  });

  // ─── cleanupExpiredConsentRequests ──────────────────────────

  describe('cleanupExpiredConsentRequests', () => {
    it('should delete expired consent_request actions', async () => {
      prisma.pendingAction.deleteMany.mockResolvedValue({ count: 3 });

      await service.cleanupExpiredConsentRequests();

      expect(prisma.pendingAction.deleteMany).toHaveBeenCalledWith({
        where: {
          type: 'consent_request',
          expiresAt: { lt: expect.any(Date) },
        },
      });
    });

    it('should handle zero expired records gracefully', async () => {
      prisma.pendingAction.deleteMany.mockResolvedValue({ count: 0 });

      await expect(
        service.cleanupExpiredConsentRequests(),
      ).resolves.toBeUndefined();
    });

    it('should use current time as the expiry threshold', async () => {
      prisma.pendingAction.deleteMany.mockResolvedValue({ count: 0 });

      const before = Date.now();
      await service.cleanupExpiredConsentRequests();
      const after = Date.now();

      const deleteCall = prisma.pendingAction.deleteMany.mock.calls[0][0];
      const threshold = deleteCall.where.expiresAt.lt as Date;
      expect(threshold.getTime()).toBeGreaterThanOrEqual(before);
      expect(threshold.getTime()).toBeLessThanOrEqual(after);
    });
  });
});
