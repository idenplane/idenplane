import { MfaService } from './mfa.service.js';
import {
  createMockPrismaService,
  type MockPrismaService,
} from '../prisma/prisma.mock.js';
import type { Realm } from '@prisma/client';

// ── Module-level mocks ────────────────────────────────────────────────
jest.mock('otpauth', () => {
  const mockSecretInstance = { base32: 'MOCKED_BASE32_SECRET' };
  return {
    Secret: Object.assign(
      jest.fn(() => mockSecretInstance),
      {
        fromBase32: jest.fn(() => mockSecretInstance),
      },
    ),
    TOTP: jest.fn(() => ({
      toString: jest.fn(
        () =>
          'otpauth://totp/Idenplane%20(test-realm):user1?secret=MOCKED_BASE32_SECRET&issuer=Idenplane',
      ),
      validate: jest.fn(() => 0), // default: valid token (delta = 0)
    })),
  };
});

jest.mock('qrcode', () => ({
  toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,MOCK_QR_CODE'),
}));

// Re-import after mock setup so we can manipulate instances in tests
import * as OTPAuth from 'otpauth';
import * as QRCode from 'qrcode';

// ── CryptoService mock factory ────────────────────────────────────────
function createMockCryptoService() {
  return {
    generateSecret: jest.fn().mockReturnValue('ABCD1234'),
    sha256: jest.fn().mockImplementation((input: string) => 'hashed_' + input),
  };
}

// ── Test suite ────────────────────────────────────────────────────────
describe('MfaService', () => {
  let service: MfaService;
  let prisma: MockPrismaService;
  let crypto: ReturnType<typeof createMockCryptoService>;

  beforeEach(() => {
    prisma = createMockPrismaService();

    // Add methods not present on the default mock
    (prisma.userCredential as any).deleteMany = jest.fn();
    (prisma.recoveryCode as any).findFirst = jest.fn();
    (prisma.recoveryCode as any).create = jest.fn();
    (prisma as any).usedTotpCode = {
      findFirst: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    };

    crypto = createMockCryptoService();
    service = new MfaService(prisma as any, crypto as any);

    // Reset module-level mocks
    jest.clearAllMocks();
  });

  // ────────────────────────────────────────────────────────────────────
  // setupTotp
  // ────────────────────────────────────────────────────────────────────
  describe('setupTotp', () => {
    it('should delete existing unverified credentials', async () => {
      prisma.userCredential.create.mockResolvedValue({} as any);

      await service.setupTotp('user-1', 'test-realm', 'user1');

      expect((prisma.userCredential as any).deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', type: 'totp', verified: false },
      });
    });

    it('should create a new unverified TOTP credential', async () => {
      prisma.userCredential.create.mockResolvedValue({} as any);

      await service.setupTotp('user-1', 'test-realm', 'user1');

      expect(prisma.userCredential.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          type: 'totp',
          secretKey: 'MOCKED_BASE32_SECRET',
          algorithm: 'SHA1',
          digits: 6,
          period: 30,
          verified: false,
        },
      });
    });

    it('should construct TOTP with correct issuer label', async () => {
      prisma.userCredential.create.mockResolvedValue({} as any);

      await service.setupTotp('user-1', 'my-realm', 'john');

      expect(OTPAuth.TOTP).toHaveBeenCalledWith(
        expect.objectContaining({
          issuer: 'Idenplane (my-realm)',
          label: 'john',
          algorithm: 'SHA1',
          digits: 6,
          period: 30,
        }),
      );
    });

    it('should generate a QR code from the otpauth URL', async () => {
      prisma.userCredential.create.mockResolvedValue({} as any);

      await service.setupTotp('user-1', 'test-realm', 'user1');

      expect(QRCode.toDataURL).toHaveBeenCalledWith(expect.any(String));
    });

    it('should return secret, qrCodeDataUrl, and otpauthUrl', async () => {
      prisma.userCredential.create.mockResolvedValue({} as any);

      const result = await service.setupTotp('user-1', 'test-realm', 'user1');

      expect(result).toEqual({
        secret: 'MOCKED_BASE32_SECRET',
        qrCodeDataUrl: 'data:image/png;base64,MOCK_QR_CODE',
        otpauthUrl: expect.any(String),
      });
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // verifyAndActivateTotp
  // ────────────────────────────────────────────────────────────────────
  describe('verifyAndActivateTotp', () => {
    const unverifiedCredential = {
      id: 'cred-1',
      userId: 'user-1',
      type: 'totp',
      secretKey: 'MOCKED_BASE32_SECRET',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      verified: false,
    };

    it('should return null when credential is not found', async () => {
      prisma.userCredential.findUnique.mockResolvedValue(null);

      const result = await service.verifyAndActivateTotp('user-1', '123456');

      expect(result).toBeNull();
    });

    it('should return null when credential is already verified', async () => {
      prisma.userCredential.findUnique.mockResolvedValue({
        ...unverifiedCredential,
        verified: true,
      } as any);

      const result = await service.verifyAndActivateTotp('user-1', '123456');

      expect(result).toBeNull();
    });

    it('should return null when TOTP code is invalid', async () => {
      prisma.userCredential.findUnique.mockResolvedValue(
        unverifiedCredential as any,
      );

      // Make validate return null (invalid token)
      (OTPAuth.TOTP as jest.Mock).mockImplementationOnce(() => ({
        toString: jest.fn(),
        validate: jest.fn(() => null),
      }));

      const result = await service.verifyAndActivateTotp('user-1', 'bad-code');

      expect(result).toBeNull();
      expect(prisma.userCredential.update).not.toHaveBeenCalled();
    });

    it('should mark credential as verified and return recovery codes when code is valid', async () => {
      prisma.userCredential.findUnique.mockResolvedValue(
        unverifiedCredential as any,
      );
      prisma.userCredential.update.mockResolvedValue({} as any);
      (prisma.recoveryCode as any).deleteMany.mockResolvedValue({} as any);
      (prisma.recoveryCode as any).create.mockResolvedValue({} as any);

      // Valid token (delta = 0)
      (OTPAuth.TOTP as jest.Mock).mockImplementationOnce(() => ({
        toString: jest.fn(),
        validate: jest.fn(() => 0),
      }));

      const result = await service.verifyAndActivateTotp('user-1', '123456');

      expect(result).toBeInstanceOf(Array);
      expect(result).toHaveLength(10);
      expect(prisma.userCredential.update).toHaveBeenCalledWith({
        where: { id: 'cred-1' },
        data: { verified: true },
      });
    });

    it('should generate recovery codes after successful activation', async () => {
      prisma.userCredential.findUnique.mockResolvedValue(
        unverifiedCredential as any,
      );
      prisma.userCredential.update.mockResolvedValue({} as any);
      (prisma.recoveryCode as any).deleteMany.mockResolvedValue({} as any);
      (prisma.recoveryCode as any).create.mockResolvedValue({} as any);

      (OTPAuth.TOTP as jest.Mock).mockImplementationOnce(() => ({
        toString: jest.fn(),
        validate: jest.fn(() => 0),
      }));

      await service.verifyAndActivateTotp('user-1', '123456');

      // No unused codes yet: delete any used ones and create 10 new
      expect((prisma.recoveryCode as any).deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
      expect((prisma.recoveryCode as any).create).toHaveBeenCalledTimes(10);
    });

    it('keeps the existing recovery codes when another factor already issued them', async () => {
      prisma.userCredential.findUnique.mockResolvedValue(
        unverifiedCredential as any,
      );
      prisma.userCredential.update.mockResolvedValue({} as any);
      (prisma.recoveryCode as any).count.mockResolvedValue(7);
      (OTPAuth.TOTP as jest.Mock).mockImplementationOnce(() => ({
        toString: jest.fn(),
        validate: jest.fn(() => 0),
      }));

      const result = await service.verifyAndActivateTotp('user-1', '123456');

      expect(result).toEqual([]);
      expect((prisma.recoveryCode as any).deleteMany).not.toHaveBeenCalled();
      expect((prisma.recoveryCode as any).create).not.toHaveBeenCalled();
    });

    it('should look up credential by userId_type compound key', async () => {
      prisma.userCredential.findUnique.mockResolvedValue(null);

      await service.verifyAndActivateTotp('user-1', '123456');

      expect(prisma.userCredential.findUnique).toHaveBeenCalledWith({
        where: { userId_type: { userId: 'user-1', type: 'totp' } },
      });
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // verifyTotp
  // ────────────────────────────────────────────────────────────────────
  describe('verifyTotp', () => {
    const verifiedCredential = {
      id: 'cred-1',
      userId: 'user-1',
      type: 'totp',
      secretKey: 'MOCKED_BASE32_SECRET',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      verified: true,
    };

    it('should return false when credential is not found', async () => {
      prisma.userCredential.findUnique.mockResolvedValue(null);

      const result = await service.verifyTotp('user-1', '123456');

      expect(result).toBe(false);
    });

    it('should return false when credential is not verified', async () => {
      prisma.userCredential.findUnique.mockResolvedValue({
        ...verifiedCredential,
        verified: false,
      } as any);

      const result = await service.verifyTotp('user-1', '123456');

      expect(result).toBe(false);
    });

    it('should return false when TOTP code is invalid', async () => {
      prisma.userCredential.findUnique.mockResolvedValue(
        verifiedCredential as any,
      );

      (OTPAuth.TOTP as jest.Mock).mockImplementationOnce(() => ({
        toString: jest.fn(),
        validate: jest.fn(() => null),
      }));

      const result = await service.verifyTotp('user-1', 'bad-code');

      expect(result).toBe(false);
    });

    it('should return true when TOTP code is valid', async () => {
      prisma.userCredential.findUnique.mockResolvedValue(
        verifiedCredential as any,
      );

      (OTPAuth.TOTP as jest.Mock).mockImplementationOnce(() => ({
        toString: jest.fn(),
        validate: jest.fn(() => 0),
      }));

      const result = await service.verifyTotp('user-1', '123456');

      expect(result).toBe(true);
    });

    it('should validate with window of 1', async () => {
      prisma.userCredential.findUnique.mockResolvedValue(
        verifiedCredential as any,
      );

      const mockValidate = jest.fn(() => 1);
      (OTPAuth.TOTP as jest.Mock).mockImplementationOnce(() => ({
        toString: jest.fn(),
        validate: mockValidate,
      }));

      await service.verifyTotp('user-1', '123456');

      expect(mockValidate).toHaveBeenCalledWith({ token: '123456', window: 1 });
    });

    it('should reconstruct TOTP from stored credential fields', async () => {
      prisma.userCredential.findUnique.mockResolvedValue(
        verifiedCredential as any,
      );

      (OTPAuth.TOTP as jest.Mock).mockImplementationOnce(() => ({
        toString: jest.fn(),
        validate: jest.fn(() => 0),
      }));

      await service.verifyTotp('user-1', '123456');

      expect(OTPAuth.Secret.fromBase32).toHaveBeenCalledWith(
        'MOCKED_BASE32_SECRET',
      );
      expect(OTPAuth.TOTP).toHaveBeenCalledWith(
        expect.objectContaining({
          algorithm: 'SHA1',
          digits: 6,
          period: 30,
        }),
      );
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // verifyRecoveryCode
  // ────────────────────────────────────────────────────────────────────
  describe('verifyRecoveryCode', () => {
    it('should return false when no matching unused code is found', async () => {
      (prisma.recoveryCode as any).updateMany.mockResolvedValue({ count: 0 });

      const result = await service.verifyRecoveryCode('user-1', 'ABCD1234');

      expect(result).toBe(false);
    });

    it('should hash the code (lowercased, no spaces) before lookup', async () => {
      await service.verifyRecoveryCode('user-1', '  AB CD  12 34  ');

      expect(crypto.sha256).toHaveBeenCalledWith('abcd1234');
    });

    it('claims the code with one conditional update (no read-then-write race)', async () => {
      (prisma.recoveryCode as any).updateMany.mockResolvedValue({ count: 1 });

      const result = await service.verifyRecoveryCode('user-1', 'ABCD1234');

      expect(result).toBe(true);
      expect((prisma.recoveryCode as any).updateMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          codeHash: 'hashed_abcd1234',
          used: false,
        },
        data: { used: true },
      });
      expect(prisma.recoveryCode.update).not.toHaveBeenCalled();
    });

    it('lets only one of two concurrent uses of the same code succeed', async () => {
      (prisma.recoveryCode as any).updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });

      const results = await Promise.all([
        service.verifyRecoveryCode('user-1', 'ABCD1234'),
        service.verifyRecoveryCode('user-1', 'ABCD1234'),
      ]);

      expect(results.filter(Boolean)).toHaveLength(1);
    });

    it('should handle uppercase input by lowering before hash', async () => {
      await service.verifyRecoveryCode('user-1', 'XYZW9876');

      expect(crypto.sha256).toHaveBeenCalledWith('xyzw9876');
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // generateRecoveryCodes
  // ────────────────────────────────────────────────────────────────────
  describe('generateRecoveryCodes', () => {
    beforeEach(() => {
      (prisma.recoveryCode as any).deleteMany.mockResolvedValue({ count: 0 });
      (prisma.recoveryCode as any).create.mockResolvedValue({} as any);
    });

    it('should delete existing recovery codes for the user', async () => {
      await service.generateRecoveryCodes('user-1');

      expect((prisma.recoveryCode as any).deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
    });

    it('should generate exactly 10 codes', async () => {
      const codes = await service.generateRecoveryCodes('user-1');

      expect(codes).toHaveLength(10);
    });

    it('should create a DB record for each code with hashed value', async () => {
      await service.generateRecoveryCodes('user-1');

      expect((prisma.recoveryCode as any).create).toHaveBeenCalledTimes(10);
      // Each call should store the hashed lowercase version
      expect((prisma.recoveryCode as any).create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          codeHash: expect.stringContaining('hashed_'),
        },
      });
    });

    it('should call generateSecret(4) for each code', async () => {
      await service.generateRecoveryCodes('user-1');

      expect(crypto.generateSecret).toHaveBeenCalledTimes(10);
      for (let i = 0; i < 10; i++) {
        expect(crypto.generateSecret).toHaveBeenNthCalledWith(i + 1, 4);
      }
    });

    it('should return the plain-text uppercase codes', async () => {
      const codes = await service.generateRecoveryCodes('user-1');

      // crypto.generateSecret returns 'ABCD1234', toUpperCase() = 'ABCD1234'
      codes.forEach((code) => {
        expect(code).toBe('ABCD1234');
      });
    });

    it('should hash each code lowercased before storing', async () => {
      await service.generateRecoveryCodes('user-1');

      // 'ABCD1234'.toLowerCase() = 'abcd1234'
      expect(crypto.sha256).toHaveBeenCalledWith('abcd1234');
      expect(crypto.sha256).toHaveBeenCalledTimes(10);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // disableTotp
  // ────────────────────────────────────────────────────────────────────
  describe('disableTotp', () => {
    beforeEach(() => {
      (prisma.userCredential as any).deleteMany.mockResolvedValue({ count: 1 });
      (prisma.recoveryCode as any).deleteMany.mockResolvedValue({ count: 5 });
    });

    it('should delete all TOTP credentials for the user', async () => {
      await service.disableTotp('user-1');

      expect((prisma.userCredential as any).deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', type: 'totp' },
      });
    });

    it('deletes the recovery codes when TOTP was the last factor', async () => {
      (prisma.userCredential as any).findMany.mockResolvedValue([]);

      await service.disableTotp('user-1');

      expect((prisma.recoveryCode as any).deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
    });

    it('keeps the recovery codes while an SMS phone remains', async () => {
      (prisma.userCredential as any).findMany.mockResolvedValue([
        { type: 'sms' },
      ]);

      await service.disableTotp('user-1');

      expect((prisma.recoveryCode as any).deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('disableSms', () => {
    it('removes the phone and pending codes, keeping recovery codes while TOTP remains', async () => {
      (prisma.userCredential as any).findMany.mockResolvedValue([
        { type: 'totp' },
      ]);

      await service.disableSms('user-1');

      expect((prisma.userCredential as any).deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', type: 'sms' },
      });
      expect((prisma as any).otpAttempt.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
      expect((prisma.recoveryCode as any).deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('disableAllFactors', () => {
    it('removes every second factor and the recovery codes', async () => {
      await service.disableAllFactors('user-1');

      expect((prisma.userCredential as any).deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', type: { in: ['totp', 'sms'] } },
      });
      expect((prisma.recoveryCode as any).deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // isMfaEnabled
  // ────────────────────────────────────────────────────────────────────
  describe('isMfaEnabled', () => {
    it('is true for a verified authenticator app', async () => {
      (prisma.userCredential as any).findMany.mockResolvedValue([
        { type: 'totp' },
      ]);

      expect(await service.isMfaEnabled('user-1')).toBe(true);
    });

    it('is true for a user whose only factor is SMS (fail closed)', async () => {
      (prisma.userCredential as any).findMany.mockResolvedValue([
        { type: 'sms' },
      ]);

      expect(await service.isMfaEnabled('user-1')).toBe(true);
    });

    it('is false without verified factors', async () => {
      (prisma.userCredential as any).findMany.mockResolvedValue([]);

      expect(await service.isMfaEnabled('user-1')).toBe(false);
    });

    it('only counts verified second-factor credentials', async () => {
      await service.isMfaEnabled('user-1');

      expect((prisma.userCredential as any).findMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          verified: true,
          type: { in: ['totp', 'sms'] },
        },
        select: { type: true },
      });
    });
  });

  describe('isTotpEnabled', () => {
    it('looks only at the TOTP credential', async () => {
      prisma.userCredential.findUnique.mockResolvedValue({
        verified: true,
      } as any);

      expect(await service.isTotpEnabled('user-1')).toBe(true);
      expect(prisma.userCredential.findUnique).toHaveBeenCalledWith({
        where: { userId_type: { userId: 'user-1', type: 'totp' } },
      });
    });
  });

  describe('verifySecondFactor', () => {
    it('rejects an empty code without touching any factor', async () => {
      const spy = jest.spyOn(service, 'verifyTotp');

      expect(
        await service.verifySecondFactor('user-1', { method: 'otp', code: ' ' }),
      ).toEqual({ verified: false });
      expect(spy).not.toHaveBeenCalled();
    });

    it('"otp" tries the authenticator, then a recovery code', async () => {
      jest.spyOn(service, 'verifyTotp').mockResolvedValue(false);
      jest.spyOn(service, 'verifyRecoveryCode').mockResolvedValue(true);

      expect(
        await service.verifySecondFactor('user-1', {
          method: 'otp',
          code: 'abcd1234',
        }),
      ).toEqual({ verified: true, factor: 'recovery' });
    });

    it('"totp" never falls back to recovery codes', async () => {
      jest.spyOn(service, 'verifyTotp').mockResolvedValue(false);
      const recovery = jest.spyOn(service, 'verifyRecoveryCode');

      expect(
        await service.verifySecondFactor('user-1', {
          method: 'totp',
          code: '123456',
        }),
      ).toEqual({ verified: false });
      expect(recovery).not.toHaveBeenCalled();
    });

    it('"sms" checks the code against the challenge it was sent for', async () => {
      const smsOtp = {
        verifyCode: jest.fn().mockResolvedValue({ ok: true, phone: '+201' }),
      };
      const svc = new MfaService(
        prisma as any,
        crypto as any,
        undefined,
        undefined,
        smsOtp as any,
      );

      expect(
        await svc.verifySecondFactor('user-1', {
          method: 'sms',
          code: '123456',
          realmId: 'realm-1',
          purpose: 'login',
          binding: 'challenge-token',
        }),
      ).toEqual({ verified: true, factor: 'sms' });
      expect(smsOtp.verifyCode).toHaveBeenCalledWith({
        realmId: 'realm-1',
        userId: 'user-1',
        purpose: 'login',
        binding: 'challenge-token',
        code: '123456',
      });
    });

    it('"sms" fails closed when the SMS service is not available', async () => {
      expect(
        await service.verifySecondFactor('user-1', {
          method: 'sms',
          code: '123456',
          realmId: 'realm-1',
          purpose: 'login',
          binding: 'challenge-token',
        }),
      ).toEqual({ verified: false });
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // isMfaRequired
  // ────────────────────────────────────────────────────────────────────
  describe('isMfaRequired', () => {
    it('should return true when realm.mfaRequired is true', async () => {
      const realm = { id: 'realm-1', mfaRequired: true } as Realm;

      const result = await service.isMfaRequired(realm, 'user-1');

      expect(result).toBe(true);
      // Should short-circuit, no DB lookup needed
      expect((prisma.userCredential as any).findMany).not.toHaveBeenCalled();
    });

    it('should return true when realm does not require MFA but user has a factor', async () => {
      const realm = { id: 'realm-1', mfaRequired: false } as Realm;
      (prisma.userCredential as any).findMany.mockResolvedValue([
        { type: 'totp' },
      ]);

      expect(await service.isMfaRequired(realm, 'user-1')).toBe(true);
    });

    it('should return false when neither realm requires MFA nor user has a factor', async () => {
      const realm = { id: 'realm-1', mfaRequired: false } as Realm;
      (prisma.userCredential as any).findMany.mockResolvedValue([]);

      expect(await service.isMfaRequired(realm, 'user-1')).toBe(false);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // createMfaChallenge
  // ────────────────────────────────────────────────────────────────────
  describe('createMfaChallenge', () => {
    beforeEach(() => {
      prisma.pendingAction.create.mockResolvedValue({} as any);
    });

    it('should create a pending action with type mfa_challenge', async () => {
      await service.createMfaChallenge('user-1', 'realm-1');

      expect(prisma.pendingAction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tokenHash: 'hashed_ABCD1234',
          type: 'mfa_challenge',
        }),
      });
    });

    it('should store userId, realmId and oauthParams in data field', async () => {
      const oauthParams = { redirect_uri: 'http://localhost', state: 'abc' };

      await service.createMfaChallenge('user-1', 'realm-1', oauthParams);

      expect(prisma.pendingAction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          data: {
            userId: 'user-1',
            realmId: 'realm-1',
            oauthParams,
          },
        }),
      });
    });

    it('should set a 5-minute TTL on expiresAt', async () => {
      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);

      await service.createMfaChallenge('user-1', 'realm-1');

      const callArgs = prisma.pendingAction.create.mock.calls[0][0];
      const expiresAt = callArgs.data.expiresAt as Date;
      expect(expiresAt.getTime()).toBe(now + 5 * 60 * 1000);

      jest.restoreAllMocks();
    });

    it('should return the raw token (not the hash)', async () => {
      const token = await service.createMfaChallenge('user-1', 'realm-1');

      // crypto.generateSecret returns 'ABCD1234'
      expect(token).toBe('ABCD1234');
    });

    it('should hash the token before storing', async () => {
      await service.createMfaChallenge('user-1', 'realm-1');

      expect(crypto.sha256).toHaveBeenCalledWith('ABCD1234');
      expect(prisma.pendingAction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tokenHash: 'hashed_ABCD1234',
        }),
      });
    });

    it('should handle undefined oauthParams', async () => {
      await service.createMfaChallenge('user-1', 'realm-1');

      expect(prisma.pendingAction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          data: {
            userId: 'user-1',
            realmId: 'realm-1',
            oauthParams: undefined,
          },
        }),
      });
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // validateMfaChallenge
  // ────────────────────────────────────────────────────────────────────
  describe('validateMfaChallenge', () => {
    it('should return null when no action is found', async () => {
      prisma.pendingAction.findUnique.mockResolvedValue(null);

      const result = await service.validateMfaChallenge('some-token');

      expect(result).toBeNull();
    });

    it('should return null when action type is not mfa_challenge', async () => {
      prisma.pendingAction.findUnique.mockResolvedValue({
        id: 'action-1',
        tokenHash: 'hashed_some-token',
        type: 'password_reset',
        data: { userId: 'user-1', realmId: 'realm-1' },
        expiresAt: new Date(Date.now() + 60_000),
      } as any);

      const result = await service.validateMfaChallenge('some-token');

      expect(result).toBeNull();
    });

    it('should return null and delete the action when it is expired', async () => {
      prisma.pendingAction.findUnique.mockResolvedValue({
        id: 'action-1',
        tokenHash: 'hashed_some-token',
        type: 'mfa_challenge',
        data: { userId: 'user-1', realmId: 'realm-1' },
        expiresAt: new Date(Date.now() - 60_000), // expired
      } as any);
      prisma.pendingAction.delete.mockResolvedValue({} as any);

      const result = await service.validateMfaChallenge('some-token');

      expect(result).toBeNull();
      expect(prisma.pendingAction.delete).toHaveBeenCalledWith({
        where: { id: 'action-1' },
      });
    });

    it('should delete the action (consume) and return data on valid challenge', async () => {
      const oauthParams = { redirect_uri: 'http://localhost' };
      prisma.pendingAction.findUnique.mockResolvedValue({
        id: 'action-1',
        tokenHash: 'hashed_some-token',
        type: 'mfa_challenge',
        data: { userId: 'user-1', realmId: 'realm-1', oauthParams },
        expiresAt: new Date(Date.now() + 60_000), // not expired
      } as any);
      prisma.pendingAction.delete.mockResolvedValue({} as any);

      const result = await service.validateMfaChallenge('some-token');

      expect(result).toEqual({
        userId: 'user-1',
        realmId: 'realm-1',
        oauthParams,
      });
      expect(prisma.pendingAction.delete).toHaveBeenCalledWith({
        where: { id: 'action-1' },
      });
    });

    it('should hash the challenge token for lookup', async () => {
      prisma.pendingAction.findUnique.mockResolvedValue(null);

      await service.validateMfaChallenge('my-challenge-token');

      expect(crypto.sha256).toHaveBeenCalledWith('my-challenge-token');
      expect(prisma.pendingAction.findUnique).toHaveBeenCalledWith({
        where: { tokenHash: 'hashed_my-challenge-token' },
      });
    });

    it('should return oauthParams as undefined when not present in data', async () => {
      prisma.pendingAction.findUnique.mockResolvedValue({
        id: 'action-1',
        tokenHash: 'hashed_some-token',
        type: 'mfa_challenge',
        data: { userId: 'user-1', realmId: 'realm-1' },
        expiresAt: new Date(Date.now() + 60_000),
      } as any);
      prisma.pendingAction.delete.mockResolvedValue({} as any);

      const result = await service.validateMfaChallenge('some-token');

      expect(result).toEqual({
        userId: 'user-1',
        realmId: 'realm-1',
        oauthParams: undefined,
      });
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // validateMfaChallengeWithAttemptCheck
  // ────────────────────────────────────────────────────────────────────
  describe('validateMfaChallengeWithAttemptCheck', () => {
    const live = {
      id: 'action-1',
      type: 'mfa_challenge',
      data: { userId: 'user-1', realmId: 'realm-1' },
      expiresAt: new Date(Date.now() + 60_000),
    };

    it('spends an attempt atomically, only on a live challenge under the limit', async () => {
      prisma.pendingAction.updateMany.mockResolvedValue({ count: 1 });
      prisma.pendingAction.findUnique.mockResolvedValue(live as any);

      const result =
        await service.validateMfaChallengeWithAttemptCheck('some-token');

      expect(result).toEqual({
        userId: 'user-1',
        realmId: 'realm-1',
        clientId: undefined,
        oauthParams: undefined,
        primaryAmr: undefined,
      });
      expect(prisma.pendingAction.updateMany).toHaveBeenCalledWith({
        where: {
          tokenHash: 'hashed_some-token',
          type: 'mfa_challenge',
          expiresAt: { gt: expect.any(Date) },
          attempts: { lt: 5 },
        },
        data: { attempts: { increment: 1 } },
      });
    });

    it('returns null and discards the challenge when it is unknown, expired or out of attempts', async () => {
      prisma.pendingAction.updateMany.mockResolvedValue({ count: 0 });
      prisma.pendingAction.deleteMany.mockResolvedValue({ count: 1 });

      const result =
        await service.validateMfaChallengeWithAttemptCheck('some-token');

      expect(result).toBeNull();
      expect(prisma.pendingAction.deleteMany).toHaveBeenCalledWith({
        where: { tokenHash: 'hashed_some-token', type: 'mfa_challenge' },
      });
      expect(prisma.pendingAction.findUnique).not.toHaveBeenCalled();
    });

    it('lets no more than 5 of many parallel guesses through', async () => {
      let attempts = 0;
      prisma.pendingAction.updateMany.mockImplementation(async () => {
        if (attempts >= 5) return { count: 0 };
        attempts++;
        return { count: 1 };
      });
      prisma.pendingAction.findUnique.mockResolvedValue(live as any);
      prisma.pendingAction.deleteMany.mockResolvedValue({ count: 1 });

      const results = await Promise.all(
        Array.from({ length: 12 }, () =>
          service.validateMfaChallengeWithAttemptCheck('some-token'),
        ),
      );

      expect(results.filter((r) => r !== null)).toHaveLength(5);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // consumeMfaChallenge
  // ────────────────────────────────────────────────────────────────────
  describe('consumeMfaChallenge', () => {
    it('should delete the pending action by tokenHash', async () => {
      prisma.pendingAction.delete.mockResolvedValue({} as any);

      await service.consumeMfaChallenge('some-token');

      expect(prisma.pendingAction.delete).toHaveBeenCalledWith({
        where: { tokenHash: 'hashed_some-token' },
      });
    });

    it('should not throw when action does not exist', async () => {
      prisma.pendingAction.delete.mockRejectedValue(new Error('Not found'));

      await expect(
        service.consumeMfaChallenge('nonexistent'),
      ).resolves.toBeUndefined();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // Required-MFA enrolment
  // ────────────────────────────────────────────────────────────────────
  describe('required-MFA enrolment', () => {
    const future = () => new Date(Date.now() + 60_000);
    const enrollmentAction = (
      data: Record<string, unknown>,
      expiresAt = future(),
    ) =>
      ({
        id: 'pa-1',
        type: 'mfa_enrollment',
        tokenHash: 'hashed_tok',
        data,
        expiresAt,
      }) as any;

    it('stores a hashed, unverified enrolment and returns the raw token', async () => {
      prisma.pendingAction.create.mockResolvedValue({} as any);

      const token = await service.createMfaEnrollment({
        userId: 'u1',
        realmId: 'r1',
        oauthParams: { client_id: 'app' },
        rememberMe: true,
      });

      expect(token).toBe('ABCD1234');
      expect(prisma.pendingAction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tokenHash: 'hashed_ABCD1234',
          type: 'mfa_enrollment',
          data: {
            userId: 'u1',
            realmId: 'r1',
            oauthParams: { client_id: 'app' },
            rememberMe: true,
            verified: false,
          },
        }),
      });
    });

    it('does not return an expired enrolment or another kind of pending action', async () => {
      prisma.pendingAction.findUnique.mockResolvedValueOnce(
        enrollmentAction({ userId: 'u1' }, new Date(Date.now() - 1000)),
      );
      await expect(service.getMfaEnrollment('tok')).resolves.toBeNull();

      prisma.pendingAction.findUnique.mockResolvedValueOnce({
        ...enrollmentAction({ userId: 'u1' }),
        type: 'mfa_challenge',
      });
      await expect(service.getMfaEnrollment('tok')).resolves.toBeNull();
    });

    it('marks the enrolment verified', async () => {
      prisma.pendingAction.findUnique.mockResolvedValue(
        enrollmentAction({ userId: 'u1', verified: false }),
      );
      prisma.pendingAction.update.mockResolvedValue({} as any);

      await service.markMfaEnrollmentVerified('tok');

      expect(prisma.pendingAction.update).toHaveBeenCalledWith({
        where: { id: 'pa-1' },
        data: { data: { userId: 'u1', verified: true } },
      });
    });

    it('consumes a verified enrolment exactly once', async () => {
      prisma.pendingAction.delete
        .mockResolvedValueOnce(
          enrollmentAction({ userId: 'u1', realmId: 'r1', verified: true }),
        )
        .mockRejectedValueOnce(new Error('Record not found'));

      await expect(
        service.consumeVerifiedMfaEnrollment('tok'),
      ).resolves.toMatchObject({ userId: 'u1', verified: true });
      await expect(
        service.consumeVerifiedMfaEnrollment('tok'),
      ).resolves.toBeNull();
    });

    it('refuses to complete an enrolment that never activated TOTP', async () => {
      prisma.pendingAction.delete.mockResolvedValue(
        enrollmentAction({ userId: 'u1', verified: false }),
      );

      await expect(
        service.consumeVerifiedMfaEnrollment('tok'),
      ).resolves.toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // cleanupExpiredActions
  // ────────────────────────────────────────────────────────────────────
  describe('cleanupExpiredActions', () => {
    it('should delete expired MFA challenge and enrolment pending actions', async () => {
      prisma.pendingAction.deleteMany.mockResolvedValue({ count: 3 });
      (prisma as any).usedTotpCode.deleteMany.mockResolvedValue({ count: 0 });

      await service.cleanupExpiredActions();

      expect(prisma.pendingAction.deleteMany).toHaveBeenCalledWith({
        where: {
          type: { in: ['mfa_challenge', 'mfa_enrollment'] },
          expiresAt: { lt: expect.any(Date) },
        },
      });
    });

    it('should succeed even when no expired actions exist', async () => {
      prisma.pendingAction.deleteMany.mockResolvedValue({ count: 0 });
      (prisma as any).usedTotpCode.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.cleanupExpiredActions()).resolves.toBeUndefined();

      expect(prisma.pendingAction.deleteMany).toHaveBeenCalledTimes(1);
      expect((prisma as any).usedTotpCode.deleteMany).toHaveBeenCalledTimes(1);
    });
  });
});
