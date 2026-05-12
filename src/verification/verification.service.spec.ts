// Mock JwkService module to avoid importing jose (ESM-only)
jest.mock('../crypto/jwk.service.js', () => ({
  JwkService: jest.fn(),
}));

import { VerificationService } from './verification.service.js';
import {
  createMockPrismaService,
  MockPrismaService,
} from '../prisma/prisma.mock.js';

const mockCrypto = {
  generateSecret: jest.fn().mockReturnValue('raw-token-abc'),
  sha256: jest.fn().mockReturnValue('hashed-token-abc'),
  verifyPassword: jest.fn(),
  hashPassword: jest.fn(),
};

describe('VerificationService', () => {
  let service: VerificationService;
  let prisma: MockPrismaService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = createMockPrismaService();
    service = new VerificationService(prisma as any, mockCrypto as any);
  });

  // ─── createToken ───────────────────────────────────────────

  describe('createToken', () => {
    it('should delete existing tokens of the same type for the user', async () => {
      prisma.verificationToken.deleteMany.mockResolvedValue({ count: 1 });
      prisma.verificationToken.create.mockResolvedValue({});

      await service.createToken('user-1', 'EMAIL_VERIFY', 3600);

      expect(prisma.verificationToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', type: 'EMAIL_VERIFY' },
      });
    });

    it('should generate a raw token and hash it', async () => {
      prisma.verificationToken.deleteMany.mockResolvedValue({ count: 0 });
      prisma.verificationToken.create.mockResolvedValue({});

      await service.createToken('user-1', 'EMAIL_VERIFY', 3600);

      expect(mockCrypto.generateSecret).toHaveBeenCalledWith(32);
      expect(mockCrypto.sha256).toHaveBeenCalledWith('raw-token-abc');
    });

    it('should store the hashed token in the database with correct expiry', async () => {
      prisma.verificationToken.deleteMany.mockResolvedValue({ count: 0 });
      prisma.verificationToken.create.mockResolvedValue({});

      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);

      await service.createToken('user-1', 'PASSWORD_RESET', 7200);

      expect(prisma.verificationToken.create).toHaveBeenCalledWith({
        data: {
          tokenHash: 'hashed-token-abc',
          userId: 'user-1',
          type: 'PASSWORD_RESET',
          expiresAt: new Date(now + 7200 * 1000),
        },
      });

      jest.restoreAllMocks();
    });

    it('should return the raw (unhashed) token', async () => {
      prisma.verificationToken.deleteMany.mockResolvedValue({ count: 0 });
      prisma.verificationToken.create.mockResolvedValue({});

      const result = await service.createToken('user-1', 'EMAIL_VERIFY', 3600);

      expect(result).toBe('raw-token-abc');
    });
  });

  // ─── createTokenWithHash ───────────────────────────────────

  describe('createTokenWithHash', () => {
    it('should delete existing tokens of the same type for the user', async () => {
      prisma.verificationToken.deleteMany.mockResolvedValue({ count: 0 });
      prisma.verificationToken.create.mockResolvedValue({});

      await service.createTokenWithHash(
        'user-1',
        'EMAIL_VERIFY',
        3600,
        'pre-hashed-xyz',
      );

      expect(prisma.verificationToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', type: 'EMAIL_VERIFY' },
      });
    });

    it('should store the provided hash (not generate one)', async () => {
      prisma.verificationToken.deleteMany.mockResolvedValue({ count: 0 });
      prisma.verificationToken.create.mockResolvedValue({});

      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);

      await service.createTokenWithHash(
        'user-1',
        'EMAIL_VERIFY',
        1800,
        'pre-hashed-xyz',
      );

      expect(mockCrypto.generateSecret).not.toHaveBeenCalled();
      expect(prisma.verificationToken.create).toHaveBeenCalledWith({
        data: {
          tokenHash: 'pre-hashed-xyz',
          userId: 'user-1',
          type: 'EMAIL_VERIFY',
          expiresAt: new Date(now + 1800 * 1000),
        },
      });

      jest.restoreAllMocks();
    });

    it('should return void (undefined)', async () => {
      prisma.verificationToken.deleteMany.mockResolvedValue({ count: 0 });
      prisma.verificationToken.create.mockResolvedValue({});

      const result = await service.createTokenWithHash(
        'user-1',
        'EMAIL_VERIFY',
        3600,
        'hash',
      );

      expect(result).toBeUndefined();
    });
  });

  // ─── validateToken ─────────────────────────────────────────

  describe('validateToken', () => {
    it('should hash the raw token and look it up', async () => {
      prisma.verificationToken.findUnique.mockResolvedValue(null);

      await service.validateToken('raw-token-abc', 'EMAIL_VERIFY');

      expect(mockCrypto.sha256).toHaveBeenCalledWith('raw-token-abc');
      expect(prisma.verificationToken.findUnique).toHaveBeenCalledWith({
        where: { tokenHash: 'hashed-token-abc' },
      });
    });

    it('should return null when token is not found', async () => {
      prisma.verificationToken.findUnique.mockResolvedValue(null);

      const result = await service.validateToken(
        'unknown-token',
        'EMAIL_VERIFY',
      );

      expect(result).toBeNull();
    });

    it('should not attempt to delete when token is not found', async () => {
      prisma.verificationToken.findUnique.mockResolvedValue(null);

      await service.validateToken('unknown-token', 'EMAIL_VERIFY');

      expect(prisma.verificationToken.delete).not.toHaveBeenCalled();
    });

    it('should return null and delete token when type does not match', async () => {
      prisma.verificationToken.findUnique.mockResolvedValue({
        id: 'token-1',
        tokenHash: 'hashed-token-abc',
        userId: 'user-1',
        type: 'PASSWORD_RESET',
        expiresAt: new Date(Date.now() + 3600_000), // not expired
      });
      prisma.verificationToken.delete.mockResolvedValue({});

      const result = await service.validateToken(
        'raw-token-abc',
        'EMAIL_VERIFY',
      );

      expect(result).toBeNull();
      expect(prisma.verificationToken.delete).toHaveBeenCalledWith({
        where: { id: 'token-1' },
      });
    });

    it('should return null and delete token when it is expired', async () => {
      prisma.verificationToken.findUnique.mockResolvedValue({
        id: 'token-2',
        tokenHash: 'hashed-token-abc',
        userId: 'user-1',
        type: 'EMAIL_VERIFY',
        expiresAt: new Date(Date.now() - 1000), // expired 1 second ago
      });
      prisma.verificationToken.delete.mockResolvedValue({});

      const result = await service.validateToken(
        'raw-token-abc',
        'EMAIL_VERIFY',
      );

      expect(result).toBeNull();
      expect(prisma.verificationToken.delete).toHaveBeenCalledWith({
        where: { id: 'token-2' },
      });
    });

    it('should return { userId } and delete token on successful validation', async () => {
      prisma.verificationToken.findUnique.mockResolvedValue({
        id: 'token-3',
        tokenHash: 'hashed-token-abc',
        userId: 'user-42',
        type: 'EMAIL_VERIFY',
        expiresAt: new Date(Date.now() + 3600_000), // valid for 1 hour
      });
      prisma.verificationToken.delete.mockResolvedValue({});

      const result = await service.validateToken(
        'raw-token-abc',
        'EMAIL_VERIFY',
      );

      expect(result).toEqual({ userId: 'user-42' });
      expect(prisma.verificationToken.delete).toHaveBeenCalledWith({
        where: { id: 'token-3' },
      });
    });

    it('should delete on success (one-time use token)', async () => {
      prisma.verificationToken.findUnique.mockResolvedValue({
        id: 'token-4',
        tokenHash: 'hashed-token-abc',
        userId: 'user-1',
        type: 'PASSWORD_RESET',
        expiresAt: new Date(Date.now() + 60_000),
      });
      prisma.verificationToken.delete.mockResolvedValue({});

      await service.validateToken('raw-token-abc', 'PASSWORD_RESET');

      expect(prisma.verificationToken.delete).toHaveBeenCalledTimes(1);
      expect(prisma.verificationToken.delete).toHaveBeenCalledWith({
        where: { id: 'token-4' },
      });
    });

    it('should return null when token is expired AND type mismatches (still deletes)', async () => {
      prisma.verificationToken.findUnique.mockResolvedValue({
        id: 'token-5',
        tokenHash: 'hashed-token-abc',
        userId: 'user-1',
        type: 'PASSWORD_RESET',
        expiresAt: new Date(Date.now() - 5000), // expired
      });
      prisma.verificationToken.delete.mockResolvedValue({});

      const result = await service.validateToken(
        'raw-token-abc',
        'EMAIL_VERIFY',
      );

      expect(result).toBeNull();
      expect(prisma.verificationToken.delete).toHaveBeenCalledWith({
        where: { id: 'token-5' },
      });
    });
  });
});
