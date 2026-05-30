// Mock JwkService module to avoid importing jose (ESM-only)
jest.mock('../crypto/jwk.service.js', () => ({
  JwkService: jest.fn(),
}));

import { MagicLinkService } from './magic-link.service.js';
import {
  createMockPrismaService,
  MockPrismaService,
} from '../prisma/prisma.mock.js';

const mockCrypto = {
  generateSecret: jest.fn().mockReturnValue('raw-magic-link-token'),
  sha256: jest.fn().mockReturnValue('hashed-magic-link-token'),
  verifyPassword: jest.fn(),
  hashPassword: jest.fn(),
};

const mockRateLimit = {
  checkIpLimit: jest.fn(),
};

const mockEmail = {
  sendEmail: jest.fn(),
};

const mockThemeEmail = {
  getSubject: jest.fn().mockReturnValue('Sign in to Idenplane'),
  renderEmail: jest
    .fn()
    .mockReturnValue('<a href="https://app.example.com/magic-link?token=raw-magic-link-token">Sign In</a>'),
};

const mockRealmSlim = {
  id: 'realm-1',
  name: 'test-realm',
  magicLinkEnabled: true,
  magicLinkExpirySeconds: 600,
  magicLinkRateLimitPerEmail: 5,
  magicLinkEmailSubject: 'Test Subject',
};

const mockRealmFull = {
  ...mockRealmSlim,
  magicLinkEmailTemplate: null,
  theme: null,
};

const mockClient = {
  id: 'client-1',
  redirectUris: ['https://app.example.com/magic-link'],
};

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  enabled: true,
};

const okRateLimit = {
  allowed: true,
  limit: 10,
  remaining: 9,
  resetAt: Math.ceil((Date.now() + 60 * 1000) / 1000),
};

describe('MagicLinkService', () => {
  let service: MagicLinkService;
  let prisma: MockPrismaService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = createMockPrismaService();
    service = new MagicLinkService(
      prisma as any,
      mockCrypto as any,
      mockRateLimit as any,
      mockEmail as any,
      mockThemeEmail as any,
    );
  });

  // ─── requestMagicLink ────────────────────────────────────────

  describe('requestMagicLink', () => {
    it('should return error when realm is not found', async () => {
      prisma.realm.findUnique.mockResolvedValue(null);

      const result = await service.requestMagicLink(
        'test@example.com',
        'non-existent-realm',
        'my-client',
      );

      expect(result.success).toBe(false);
      expect(result.message).toBe('Realm not found');
      expect(mockEmail.sendEmail).not.toHaveBeenCalled();
    });

    it('should return error when magic link is not enabled for realm', async () => {
      prisma.realm.findUnique.mockResolvedValue({
        ...mockRealmSlim,
        magicLinkEnabled: false,
      });

      const result = await service.requestMagicLink(
        'test@example.com',
        mockRealmSlim.id,
        'my-client',
      );

      expect(result.success).toBe(false);
      expect(result.message).toBe(
        'Magic link authentication is not enabled for this realm',
      );
      expect(mockEmail.sendEmail).not.toHaveBeenCalled();
    });

    it('should reject when clientId does not exist in the realm', async () => {
      prisma.realm.findUnique.mockResolvedValueOnce(mockRealmSlim);
      prisma.client.findFirst.mockResolvedValue(null);

      const result = await service.requestMagicLink(
        'test@example.com',
        mockRealmSlim.id,
        'unknown-client',
      );

      expect(result.success).toBe(false);
      expect(result.message).toBe('Invalid client');
      expect(mockEmail.sendEmail).not.toHaveBeenCalled();
    });

    it('should reject when magicLinkUrl is not in client redirectUris (allowlist enforcement)', async () => {
      prisma.realm.findUnique.mockResolvedValueOnce(mockRealmSlim);
      prisma.client.findFirst.mockResolvedValue(mockClient);

      const result = await service.requestMagicLink(
        'test@example.com',
        mockRealmSlim.id,
        'my-client',
        '192.168.1.1',
        'Mozilla/5.0',
        'https://attacker.evil/grab',
      );

      expect(result.success).toBe(false);
      expect(result.message).toBe('Invalid magic link URL');
      expect(mockEmail.sendEmail).not.toHaveBeenCalled();
    });

    it("should fall back to client's first redirectUri when magicLinkUrl is omitted", async () => {
      prisma.realm.findUnique
        .mockResolvedValueOnce(mockRealmSlim)
        .mockResolvedValueOnce(mockRealmFull);
      prisma.client.findFirst.mockResolvedValue(mockClient);
      prisma.user.findFirst.mockResolvedValue(mockUser);
      mockRateLimit.checkIpLimit.mockResolvedValue(okRateLimit);
      prisma.magicLinkRequest.count.mockResolvedValue(0);
      prisma.magicLinkRequest.create.mockResolvedValue({});
      mockEmail.sendEmail.mockResolvedValue({ messageId: 'm' });

      const result = await service.requestMagicLink(
        'test@example.com',
        mockRealmSlim.id,
        'my-client',
        '192.168.1.1',
      );

      expect(result.success).toBe(true);
      expect(mockThemeEmail.renderEmail).toHaveBeenCalledWith(
        mockRealmFull,
        'magic-link',
        {
          magicLinkUrl:
            'https://app.example.com/magic-link?token=raw-magic-link-token',
        },
      );
    });

    it('should reject when client has no usable (non-wildcard) redirectUri and no magicLinkUrl supplied', async () => {
      prisma.realm.findUnique.mockResolvedValueOnce(mockRealmSlim);
      prisma.client.findFirst.mockResolvedValue({
        ...mockClient,
        redirectUris: ['https://app.example.com/*'],
      });

      const result = await service.requestMagicLink(
        'test@example.com',
        mockRealmSlim.id,
        'my-client',
      );

      expect(result.success).toBe(false);
      expect(result.message).toBe(
        'Client has no usable redirect URI for the magic link callback',
      );
    });

    it('should return success (no email enumeration) when user is not found', async () => {
      prisma.realm.findUnique.mockResolvedValueOnce(mockRealmSlim);
      prisma.client.findFirst.mockResolvedValue(mockClient);
      prisma.user.findFirst.mockResolvedValue(null);
      mockRateLimit.checkIpLimit.mockResolvedValue(okRateLimit);

      const result = await service.requestMagicLink(
        'nonexistent@example.com',
        mockRealmSlim.id,
        'my-client',
        '192.168.1.1',
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain('If an account exists');
      expect(mockEmail.sendEmail).not.toHaveBeenCalled();
    });

    it('should return error when user is disabled', async () => {
      prisma.realm.findUnique.mockResolvedValueOnce(mockRealmSlim);
      prisma.client.findFirst.mockResolvedValue(mockClient);
      prisma.user.findFirst.mockResolvedValue({ ...mockUser, enabled: false });
      mockRateLimit.checkIpLimit.mockResolvedValue(okRateLimit);

      const result = await service.requestMagicLink(
        'test@example.com',
        mockRealmSlim.id,
        'my-client',
        '192.168.1.1',
      );

      expect(result.success).toBe(false);
      expect(result.message).toBe('User account is disabled');
      expect(mockEmail.sendEmail).not.toHaveBeenCalled();
    });

    it('should return error when rate limited by IP', async () => {
      prisma.realm.findUnique.mockResolvedValueOnce(mockRealmSlim);
      prisma.client.findFirst.mockResolvedValue(mockClient);
      mockRateLimit.checkIpLimit.mockResolvedValue({
        allowed: false,
        limit: 10,
        remaining: 0,
        resetAt: Math.ceil((Date.now() + 60 * 1000) / 1000),
        retryAfter: 60,
      });

      const result = await service.requestMagicLink(
        'test@example.com',
        mockRealmSlim.id,
        'my-client',
        '192.168.1.1',
      );

      expect(result.success).toBe(false);
      expect(result.message).toBe('Too many requests. Please try again later.');
      expect(result.rateLimit?.allowed).toBe(false);
      expect(mockEmail.sendEmail).not.toHaveBeenCalled();
    });

    it('should return error when rate limited by email', async () => {
      prisma.realm.findUnique.mockResolvedValueOnce(mockRealmSlim);
      prisma.client.findFirst.mockResolvedValue(mockClient);
      prisma.user.findFirst.mockResolvedValue(mockUser);
      mockRateLimit.checkIpLimit.mockResolvedValue(okRateLimit);
      prisma.magicLinkRequest.count.mockResolvedValue(5);

      const result = await service.requestMagicLink(
        'test@example.com',
        mockRealmSlim.id,
        'my-client',
      );

      expect(result.success).toBe(false);
      expect(result.message).toBe('Too many requests. Please try again later.');
      expect(mockEmail.sendEmail).not.toHaveBeenCalled();
    });

    it('should generate token and send themed email on successful allowlisted request', async () => {
      prisma.realm.findUnique
        .mockResolvedValueOnce(mockRealmSlim)
        .mockResolvedValueOnce(mockRealmFull);
      prisma.client.findFirst.mockResolvedValue(mockClient);
      prisma.user.findFirst.mockResolvedValue(mockUser);
      mockRateLimit.checkIpLimit.mockResolvedValue(okRateLimit);
      prisma.magicLinkRequest.count.mockResolvedValue(0);
      prisma.magicLinkRequest.create.mockResolvedValue({});
      mockEmail.sendEmail.mockResolvedValue({ messageId: 'test-message-id' });

      const result = await service.requestMagicLink(
        'test@example.com',
        mockRealmSlim.id,
        'my-client',
        '192.168.1.1',
        'Mozilla/5.0',
        'https://app.example.com/magic-link',
      );

      expect(result.success).toBe(true);
      expect(result.message).toBe('Magic link sent successfully');
      expect(mockCrypto.generateSecret).toHaveBeenCalledWith(32);
      expect(mockCrypto.sha256).toHaveBeenCalledWith('raw-magic-link-token');
      expect(prisma.magicLinkRequest.create).toHaveBeenCalled();
      expect(mockThemeEmail.getSubject).toHaveBeenCalledWith(
        mockRealmFull,
        'magicLinkSubject',
      );
      expect(mockThemeEmail.renderEmail).toHaveBeenCalledWith(
        mockRealmFull,
        'magic-link',
        {
          magicLinkUrl:
            'https://app.example.com/magic-link?token=raw-magic-link-token',
        },
      );
      expect(mockEmail.sendEmail).toHaveBeenCalledWith(
        mockRealmSlim.name,
        'test@example.com',
        'Sign in to Idenplane',
        expect.stringContaining('<a href='),
      );
    });

    it('should create magic link record with correct data', async () => {
      prisma.realm.findUnique
        .mockResolvedValueOnce(mockRealmSlim)
        .mockResolvedValueOnce(mockRealmFull);
      prisma.client.findFirst.mockResolvedValue(mockClient);
      prisma.user.findFirst.mockResolvedValue(mockUser);
      mockRateLimit.checkIpLimit.mockResolvedValue(okRateLimit);
      prisma.magicLinkRequest.count.mockResolvedValue(0);
      prisma.magicLinkRequest.create.mockResolvedValue({});
      mockEmail.sendEmail.mockResolvedValue({ messageId: 'test-message-id' });

      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);

      await service.requestMagicLink(
        'Test@Example.com',
        mockRealmSlim.id,
        'my-client',
        '192.168.1.1',
        'Mozilla/5.0',
        'https://app.example.com/magic-link',
      );

      expect(prisma.magicLinkRequest.create).toHaveBeenCalledWith({
        data: {
          realmId: mockRealmSlim.id,
          userId: mockUser.id,
          email: 'test@example.com',
          tokenHash: 'hashed-magic-link-token',
          expiresAt: new Date(now + 600 * 1000),
          ipAddress: '192.168.1.1',
          userAgent: 'Mozilla/5.0',
        },
      });

      jest.restoreAllMocks();
    });

    it('should use custom expiry from realm configuration', async () => {
      const customRealm = { ...mockRealmSlim, magicLinkExpirySeconds: 900 };
      prisma.realm.findUnique
        .mockResolvedValueOnce(customRealm)
        .mockResolvedValueOnce({ ...mockRealmFull, magicLinkExpirySeconds: 900 });
      prisma.client.findFirst.mockResolvedValue(mockClient);
      prisma.user.findFirst.mockResolvedValue(mockUser);
      mockRateLimit.checkIpLimit.mockResolvedValue(okRateLimit);
      prisma.magicLinkRequest.count.mockResolvedValue(0);
      prisma.magicLinkRequest.create.mockResolvedValue({});
      mockEmail.sendEmail.mockResolvedValue({ messageId: 'test-message-id' });

      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);

      await service.requestMagicLink(
        'test@example.com',
        mockRealmSlim.id,
        'my-client',
      );

      expect(prisma.magicLinkRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            expiresAt: new Date(now + 900 * 1000),
          }),
        }),
      );

      jest.restoreAllMocks();
    });

    it('should use default expiry when realm does not specify', async () => {
      const realmNullExpiry = { ...mockRealmSlim, magicLinkExpirySeconds: null };
      prisma.realm.findUnique
        .mockResolvedValueOnce(realmNullExpiry)
        .mockResolvedValueOnce({ ...mockRealmFull, magicLinkExpirySeconds: null });
      prisma.client.findFirst.mockResolvedValue(mockClient);
      prisma.user.findFirst.mockResolvedValue(mockUser);
      mockRateLimit.checkIpLimit.mockResolvedValue(okRateLimit);
      prisma.magicLinkRequest.count.mockResolvedValue(0);
      prisma.magicLinkRequest.create.mockResolvedValue({});
      mockEmail.sendEmail.mockResolvedValue({ messageId: 'test-message-id' });

      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);

      await service.requestMagicLink(
        'test@example.com',
        mockRealmSlim.id,
        'my-client',
      );

      expect(prisma.magicLinkRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            expiresAt: new Date(now + 600 * 1000),
          }),
        }),
      );

      jest.restoreAllMocks();
    });
  });

  // ─── validateMagicLink ──────────────────────────────────────

  describe('validateMagicLink', () => {
    it('should hash the raw token and look it up', async () => {
      prisma.magicLinkRequest.findUnique.mockResolvedValue(null);

      await service.validateMagicLink('raw-magic-link-token');

      expect(mockCrypto.sha256).toHaveBeenCalledWith('raw-magic-link-token');
      expect(prisma.magicLinkRequest.findUnique).toHaveBeenCalledWith({
        where: { tokenHash: 'hashed-magic-link-token' },
        include: {
          realm: { select: { id: true, name: true, magicLinkEnabled: true } },
          user: { select: { id: true, email: true, enabled: true } },
        },
      });
    });

    it('should return invalid when token is not found', async () => {
      prisma.magicLinkRequest.findUnique.mockResolvedValue(null);

      const result = await service.validateMagicLink('unknown-token');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid or expired token');
    });

    it('should return invalid when realm magic link is disabled', async () => {
      prisma.magicLinkRequest.findUnique.mockResolvedValue({
        id: 'request-1',
        realm: { id: 'realm-1', name: 'test-realm', magicLinkEnabled: false },
        user: mockUser,
        tokenHash: 'hashed-magic-link-token',
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 60_000),
      });

      const result = await service.validateMagicLink('raw-magic-link-token');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Magic link authentication is not enabled');
    });

    it('should return invalid when realm name does not match', async () => {
      prisma.magicLinkRequest.findUnique.mockResolvedValue({
        id: 'request-1',
        realm: { id: 'realm-1', name: 'test-realm', magicLinkEnabled: true },
        user: mockUser,
        tokenHash: 'hashed-magic-link-token',
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 60_000),
      });

      const result = await service.validateMagicLink(
        'raw-magic-link-token',
        'wrong-realm',
      );

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid realm');
    });

    it('should return invalid when user is disabled', async () => {
      prisma.magicLinkRequest.findUnique.mockResolvedValue({
        id: 'request-1',
        realm: { id: 'realm-1', name: 'test-realm', magicLinkEnabled: true },
        user: { ...mockUser, enabled: false },
        tokenHash: 'hashed-magic-link-token',
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 60_000),
      });

      const result = await service.validateMagicLink('raw-magic-link-token');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('User account is disabled');
    });

    it('should return invalid when link is already completed', async () => {
      prisma.magicLinkRequest.findUnique.mockResolvedValue({
        id: 'request-1',
        realm: { id: 'realm-1', name: 'test-realm', magicLinkEnabled: true },
        user: mockUser,
        tokenHash: 'hashed-magic-link-token',
        status: 'COMPLETED',
        expiresAt: new Date(Date.now() + 60_000),
      });

      const result = await service.validateMagicLink('raw-magic-link-token');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('This link has already been used');
    });

    it('should return invalid when link is cancelled', async () => {
      prisma.magicLinkRequest.findUnique.mockResolvedValue({
        id: 'request-1',
        realm: { id: 'realm-1', name: 'test-realm', magicLinkEnabled: true },
        user: mockUser,
        tokenHash: 'hashed-magic-link-token',
        status: 'CANCELLED',
        expiresAt: new Date(Date.now() + 60_000),
      });

      const result = await service.validateMagicLink('raw-magic-link-token');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('This link has been cancelled');
    });

    it('should return invalid when link is expired', async () => {
      prisma.magicLinkRequest.findUnique.mockResolvedValue({
        id: 'request-1',
        realm: { id: 'realm-1', name: 'test-realm', magicLinkEnabled: true },
        user: mockUser,
        tokenHash: 'hashed-magic-link-token',
        status: 'PENDING',
        expiresAt: new Date(Date.now() - 1000),
      });

      const result = await service.validateMagicLink('raw-magic-link-token');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('This link has expired');
    });

    it('should update status to EXPIRED when expiry time passed but status was PENDING', async () => {
      prisma.magicLinkRequest.findUnique.mockResolvedValue({
        id: 'request-1',
        realm: { id: 'realm-1', name: 'test-realm', magicLinkEnabled: true },
        user: mockUser,
        tokenHash: 'hashed-magic-link-token',
        status: 'PENDING',
        expiresAt: new Date(Date.now() - 1000),
      });
      prisma.magicLinkRequest.update.mockResolvedValue({});

      await service.validateMagicLink('raw-magic-link-token');

      expect(prisma.magicLinkRequest.update).toHaveBeenCalledWith({
        where: { id: 'request-1' },
        data: { status: 'EXPIRED' },
      });
    });

    it('should return valid and mark as completed on success', async () => {
      prisma.magicLinkRequest.findUnique.mockResolvedValue({
        id: 'request-1',
        realm: { id: 'realm-1', name: 'test-realm', magicLinkEnabled: true },
        user: { ...mockUser, email: 'test@example.com' },
        tokenHash: 'hashed-magic-link-token',
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 60_000),
      });
      prisma.magicLinkRequest.update.mockResolvedValue({});

      const result = await service.validateMagicLink('raw-magic-link-token');

      expect(result.valid).toBe(true);
      expect(result.userId).toBe(mockUser.id);
      expect(result.email).toBe('test@example.com');
      expect(result.realmId).toBe('realm-1');
    });

    it('should mark token as COMPLETED on successful validation', async () => {
      prisma.magicLinkRequest.findUnique.mockResolvedValue({
        id: 'request-1',
        realm: { id: 'realm-1', name: 'test-realm', magicLinkEnabled: true },
        user: mockUser,
        tokenHash: 'hashed-magic-link-token',
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 60_000),
      });
      prisma.magicLinkRequest.update.mockResolvedValue({});

      await service.validateMagicLink('raw-magic-link-token');

      expect(prisma.magicLinkRequest.update).toHaveBeenCalledWith({
        where: { id: 'request-1' },
        data: {
          status: 'COMPLETED',
          completedAt: expect.any(Date),
        },
      });
    });
  });

  // ─── cancelPendingRequests ──────────────────────────────────

  describe('cancelPendingRequests', () => {
    it('should cancel all pending requests for user in realm', async () => {
      prisma.magicLinkRequest.updateMany.mockResolvedValue({ count: 3 });

      const result = await service.cancelPendingRequests('user-1', 'realm-1');

      expect(result).toBe(3);
      expect(prisma.magicLinkRequest.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          realmId: 'realm-1',
          status: 'PENDING',
        },
        data: {
          status: 'CANCELLED',
        },
      });
    });

    it('should return 0 when no pending requests exist', async () => {
      prisma.magicLinkRequest.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.cancelPendingRequests('user-1', 'realm-1');

      expect(result).toBe(0);
    });
  });

  // ─── cleanupExpiredRequests ─────────────────────────────────

  describe('cleanupExpiredRequests', () => {
    it('should update all expired pending requests to EXPIRED status', async () => {
      prisma.magicLinkRequest.updateMany.mockResolvedValue({ count: 5 });

      const result = await service.cleanupExpiredRequests();

      expect(result).toBe(5);
      expect(prisma.magicLinkRequest.updateMany).toHaveBeenCalledWith({
        where: {
          status: 'PENDING',
          expiresAt: { lt: expect.any(Date) },
        },
        data: {
          status: 'EXPIRED',
        },
      });
    });

    it('should return 0 when no expired requests exist', async () => {
      prisma.magicLinkRequest.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.cleanupExpiredRequests();

      expect(result).toBe(0);
    });
  });
});
