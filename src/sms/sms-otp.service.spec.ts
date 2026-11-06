import { createHmac } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  SmsOtpService,
  SmsOtpError,
  SMS_OTP_MAX_ATTEMPTS,
  SMS_OTP_MAX_SENDS,
} from './sms-otp.service.js';
import {
  createMockPrismaService,
  type MockPrismaService,
} from '../prisma/prisma.mock.js';

function createCrypto() {
  return {
    hmac: jest.fn((purpose: string, data: string) =>
      createHmac('sha256', purpose).update(data).digest('hex'),
    ),
    encrypt: jest.fn((v: string) => `enc(${v})`),
    decrypt: jest.fn((v: string) => v.replace(/^enc\((.*)\)$/, '$1')),
    decryptSecret: jest.fn((v: string) => v.replace(/^enc\((.*)\)$/, '$1')),
  };
}

const realm = {
  id: 'realm-1',
  name: 'acme',
  displayName: 'Acme',
  smsMfaEnabled: true,
  smsProvider: 'twilio',
  otpLength: 6,
  otpExpirySeconds: 300,
  smsMaxRequestsPerUser: 3,
  smsRateLimitWindow: 900,
};

describe('SmsOtpService', () => {
  let prisma: MockPrismaService;
  let crypto: ReturnType<typeof createCrypto>;
  let smsService: { sendSms: jest.Mock };
  let service: SmsOtpService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    crypto = createCrypto();
    smsService = { sendSms: jest.fn().mockResolvedValue(undefined) };
    service = new SmsOtpService(prisma as any, crypto as any, smsService as any);
    (prisma as any).otpAttempt.findUnique.mockResolvedValue(null);
    (prisma as any).otpAttempt.create.mockResolvedValue({});
    (prisma as any).smsDeliveryLog.create.mockResolvedValue({ id: 'log-1' });
    (prisma as any).smsDeliveryLog.update.mockResolvedValue({});
    (prisma as any).smsDeliveryLog.count.mockResolvedValue(0);
  });

  const sentCode = () =>
    /^(\d+) is your/.exec(smsService.sendSms.mock.calls[0][2])![1];

  describe('phone helpers', () => {
    it.each([
      ['+201012345678', '+201012345678'],
      ['+20 101 234-5678', '+201012345678'],
      ['00201012345678', '+201012345678'],
      ['(+1) 415 555 0100', '+14155550100'],
    ])('normalises %s', (input, expected) => {
      expect(SmsOtpService.normalizePhone(input)).toBe(expected);
    });

    it.each(['01012345678', '+0123456789', '+12', 'call me', '', undefined])(
      'rejects %s',
      (input) => {
        expect(SmsOtpService.normalizePhone(input as any)).toBeNull();
      },
    );

    it('masks all but the prefix and last four digits', () => {
      expect(SmsOtpService.maskPhone('+201012345678')).toBe('+20••••••5678');
    });

    it('allows enrolment only when switched on and a provider is set', () => {
      expect(SmsOtpService.canEnroll(realm)).toBe(true);
      expect(SmsOtpService.canEnroll({ ...realm, smsMfaEnabled: false })).toBe(
        false,
      );
      expect(SmsOtpService.canEnroll({ ...realm, smsProvider: 'none' })).toBe(
        false,
      );
    });
  });

  describe('sendCode', () => {
    const enrol = (over: Record<string, unknown> = {}) =>
      service.sendCode({
        realm: realm as any,
        userId: 'user-1',
        purpose: 'enroll',
        binding: 'tok',
        phone: '+201012345678',
        ip: '203.0.113.9',
        ...over,
      });

    it('sends a random numeric code and stores only keyed hashes of it', async () => {
      const result = await enrol();

      const code = sentCode();
      expect(code).toMatch(/^\d{6}$/);
      expect(smsService.sendSms).toHaveBeenCalledWith(
        'acme',
        '+201012345678',
        expect.stringContaining('Acme verification code'),
      );
      const stored = (prisma as any).otpAttempt.create.mock.calls[0][0].data;
      expect(JSON.stringify(stored)).not.toContain(code);
      expect(JSON.stringify(stored)).not.toContain('1012345678"');
      expect(stored.phoneEncrypted).toBe('enc(+201012345678)');
      expect(stored.purpose).toBe('enroll');
      expect(result.maskedPhone).toBe('+20••••••5678');
      expect((prisma as any).smsDeliveryLog.update).toHaveBeenLastCalledWith({
        where: { id: 'log-1' },
        data: { status: 'SENT' },
      });
    });

    it('refuses enrolment when SMS MFA is switched off', async () => {
      await expect(
        enrol({ realm: { ...realm, smsMfaEnabled: false } }),
      ).rejects.toMatchObject({ code: 'unavailable' });
      expect(smsService.sendSms).not.toHaveBeenCalled();
    });

    it('still sends sign-in codes to enrolled users when the switch is off', async () => {
      prisma.userCredential.findUnique.mockResolvedValue({
        phoneNumber: 'enc(+201012345678)',
        verified: true,
      } as any);

      await service.sendCode({
        realm: { ...realm, smsMfaEnabled: false } as any,
        userId: 'user-1',
        purpose: 'login',
        binding: 'challenge',
      });

      expect(smsService.sendSms).toHaveBeenCalledWith(
        'acme',
        '+201012345678',
        expect.any(String),
      );
    });

    it('refuses sign-in codes for a user without an enrolled phone', async () => {
      prisma.userCredential.findUnique.mockResolvedValue(null);

      await expect(
        service.sendCode({
          realm: realm as any,
          userId: 'user-1',
          purpose: 'login',
          binding: 'challenge',
        }),
      ).rejects.toMatchObject({ code: 'unavailable' });
    });

    it('rejects a malformed number', async () => {
      await expect(enrol({ phone: '0101234' })).rejects.toMatchObject({
        code: 'invalid_phone',
      });
    });

    it('enforces the resend cooldown', async () => {
      (prisma as any).otpAttempt.findUnique.mockResolvedValue({
        id: 'otp-1',
        userId: 'user-1',
        realmId: 'realm-1',
        attempts: 0,
        sendCount: 1,
        lastSentAt: new Date(),
      });

      const err = await enrol().catch((e: unknown) => e);

      expect(err).toBeInstanceOf(SmsOtpError);
      expect((err as SmsOtpError).code).toBe('cooldown');
      expect((err as SmsOtpError).retryAfterSeconds).toBeGreaterThan(0);
      expect(smsService.sendSms).not.toHaveBeenCalled();
    });

    it('resends with a new code but keeps the guess budget', async () => {
      (prisma as any).otpAttempt.findUnique.mockResolvedValue({
        id: 'otp-1',
        userId: 'user-1',
        realmId: 'realm-1',
        attempts: 3,
        sendCount: 1,
        lastSentAt: new Date(Date.now() - 60_000),
      });
      (prisma as any).otpAttempt.updateMany.mockResolvedValue({ count: 1 });

      await enrol();

      const update = (prisma as any).otpAttempt.updateMany.mock.calls[0][0];
      expect(update.data).not.toHaveProperty('attempts');
      expect(update.data.sendCount).toEqual({ increment: 1 });
      expect(update.where.sendCount).toEqual({ lt: SMS_OTP_MAX_SENDS });
    });

    it('refuses to resend once the guess budget is spent', async () => {
      (prisma as any).otpAttempt.findUnique.mockResolvedValue({
        id: 'otp-1',
        userId: 'user-1',
        realmId: 'realm-1',
        attempts: SMS_OTP_MAX_ATTEMPTS,
        sendCount: 1,
        lastSentAt: new Date(0),
      });

      await expect(enrol()).rejects.toMatchObject({ code: 'locked' });
    });

    it('refuses after too many sends for one challenge', async () => {
      (prisma as any).otpAttempt.findUnique.mockResolvedValue({
        id: 'otp-1',
        userId: 'user-1',
        realmId: 'realm-1',
        attempts: 0,
        sendCount: SMS_OTP_MAX_SENDS,
        lastSentAt: new Date(0),
      });

      await expect(enrol()).rejects.toMatchObject({ code: 'too_many_sends' });
    });

    it("refuses a binding that belongs to another user's challenge", async () => {
      (prisma as any).otpAttempt.findUnique.mockResolvedValue({
        id: 'otp-1',
        userId: 'someone-else',
        realmId: 'realm-1',
        attempts: 0,
        sendCount: 1,
        lastSentAt: new Date(0),
      });

      await expect(enrol()).rejects.toMatchObject({ code: 'unavailable' });
    });

    it.each([
      ['user', [3, 0, 0, 0]],
      ['phone', [0, 3, 0, 0]],
      ['ip', [0, 0, 10, 0]],
      ['realm', [0, 0, 0, 1000]],
    ])('enforces the per-%s send limit', async (_label, counts) => {
      const c = (prisma as any).smsDeliveryLog.count;
      for (const n of counts) c.mockResolvedValueOnce(n);

      await expect(enrol()).rejects.toMatchObject({ code: 'rate_limited' });
      expect(smsService.sendSms).not.toHaveBeenCalled();
    });

    it('treats a concurrent first send as a cooldown', async () => {
      (prisma as any).otpAttempt.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'x',
        }),
      );

      await expect(enrol()).rejects.toMatchObject({ code: 'cooldown' });
    });

    it('reports a provider failure without leaking its details', async () => {
      smsService.sendSms.mockRejectedValue(new Error('401 bad token xyz'));

      const err = (await enrol().catch((e: unknown) => e)) as SmsOtpError;

      expect(err.code).toBe('send_failed');
      expect(err.message).not.toContain('xyz');
      expect((prisma as any).smsDeliveryLog.update).toHaveBeenCalledWith({
        where: { id: 'log-1' },
        data: { status: 'FAILED', errorMessage: '401 bad token xyz' },
      });
    });

    it('clamps an unsafe code length up to 6 digits', async () => {
      await enrol({ realm: { ...realm, otpLength: 4 } });

      expect(sentCode()).toMatch(/^\d{6}$/);
    });
  });

  describe('verifyCode', () => {
    let row: Record<string, any>;

    beforeEach(async () => {
      await service.sendCode({
        realm: realm as any,
        userId: 'user-1',
        purpose: 'enroll',
        binding: 'tok',
        phone: '+201012345678',
      });
      const data = (prisma as any).otpAttempt.create.mock.calls[0][0].data;
      row = {
        id: 'otp-1',
        ...data,
        attempts: 0,
        expiresAt: new Date(Date.now() + 60_000),
      };
      (prisma as any).otpAttempt.findUnique.mockResolvedValue(row);
      (prisma as any).otpAttempt.updateMany.mockResolvedValue({ count: 1 });
      (prisma as any).otpAttempt.deleteMany.mockResolvedValue({ count: 1 });
    });

    const verify = (code: string, over: Record<string, unknown> = {}) =>
      service.verifyCode({
        realmId: 'realm-1',
        userId: 'user-1',
        purpose: 'enroll',
        binding: 'tok',
        code,
        ...over,
      });

    it('accepts the right code once and returns the enrolling number', async () => {
      expect(await verify(sentCode())).toEqual({
        ok: true,
        phone: '+201012345678',
      });
      expect((prisma as any).otpAttempt.deleteMany).toHaveBeenCalledWith({
        where: { id: 'otp-1', codeHash: row.codeHash },
      });
    });

    it('spends an attempt before comparing', async () => {
      await verify('000000');

      expect((prisma as any).otpAttempt.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'otp-1',
          attempts: { lt: SMS_OTP_MAX_ATTEMPTS },
          expiresAt: { gt: expect.any(Date) },
        },
        data: { attempts: { increment: 1 } },
      });
    });

    it('reports the remaining attempts on a wrong code', async () => {
      const wrong = sentCode() === '000000' ? '111111' : '000000';

      expect(await verify(wrong)).toEqual({
        ok: false,
        reason: 'invalid',
        remainingAttempts: SMS_OTP_MAX_ATTEMPTS - 1,
      });
      expect((prisma as any).otpAttempt.deleteMany).not.toHaveBeenCalled();
    });

    it('is locked once no attempt can be reserved', async () => {
      (prisma as any).otpAttempt.updateMany.mockResolvedValue({ count: 0 });

      expect(await verify(sentCode())).toEqual({
        ok: false,
        reason: 'locked',
        remainingAttempts: 0,
      });
    });

    it('reports an expired code', async () => {
      row.expiresAt = new Date(Date.now() - 1000);
      (prisma as any).otpAttempt.updateMany.mockResolvedValue({ count: 0 });

      expect(await verify(sentCode())).toEqual({
        ok: false,
        reason: 'expired',
      });
    });

    it('fails when another request claimed the code first', async () => {
      (prisma as any).otpAttempt.deleteMany.mockResolvedValue({ count: 0 });

      expect(await verify(sentCode())).toEqual({
        ok: false,
        reason: 'not_found',
      });
    });

    it("never checks a code against another user's challenge", async () => {
      expect(await verify(sentCode(), { userId: 'user-2' })).toEqual({
        ok: false,
        reason: 'not_found',
      });
      expect((prisma as any).otpAttempt.updateMany).not.toHaveBeenCalled();
    });
  });
});
