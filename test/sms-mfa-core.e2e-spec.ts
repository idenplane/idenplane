import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  createTestApp,
  TEST_ADMIN_API_KEY,
  type SeededRealm,
  type TestContext,
} from './setup';
import { MfaService } from '../src/mfa/mfa.service.js';
import { SmsService } from '../src/sms/sms.service.js';
import {
  SmsOtpService,
  SMS_OTP_MAX_ATTEMPTS,
} from '../src/sms/sms-otp.service.js';

/**
 * SMS as a second factor, at the service level (the screens come later):
 * an SMS-only user can't skip MFA, guesses are capped even when sent in
 * parallel, codes only work for the challenge they were sent for, and
 * recovery codes outlive the removal of one factor while another remains.
 */
describe('SMS MFA core (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;
  let seeded: SeededRealm;
  let smsOtp: SmsOtpService;
  let mfa: MfaService;
  const sent: { to: string; message: string }[] = [];

  const REALM_NAME = 'e2e-sms-mfa-core';
  const PHONE = '+201012345678';

  const realm = () =>
    ctx.prisma.realm.findUniqueOrThrow({ where: { name: REALM_NAME } });
  const lastCode = () => /^(\d+)/.exec(sent[sent.length - 1].message)![1];

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    seeded = await ctx.seedTestRealm(REALM_NAME);
    await ctx.prisma.realm.update({
      where: { name: REALM_NAME },
      data: {
        smsMfaEnabled: true,
        smsProvider: 'webhook',
        smsMaxRequestsPerUser: 100,
      },
    });
    smsOtp = app.get(SmsOtpService);
    mfa = app.get(MfaService);
    // Capture messages instead of calling a real provider.
    jest
      .spyOn(app.get(SmsService), 'sendSms')
      .mockImplementation(async (_realm, to, message) => {
        sent.push({ to, message });
      });
  }, 30_000);

  afterAll(async () => {
    await ctx.prisma.realm
      .delete({ where: { name: REALM_NAME } })
      .catch(() => {});
    await ctx.cleanup();
  });

  it('stores the enrolled phone encrypted, not as plain text', async () => {
    await smsOtp.saveEnrolledPhone(seeded.user.id, PHONE);

    const row = await ctx.prisma.userCredential.findUniqueOrThrow({
      where: { userId_type: { userId: seeded.user.id, type: 'sms' } },
    });
    expect(row.phoneNumber).not.toContain('1012345678');
    expect(await smsOtp.getEnrolledPhone(seeded.user.id)).toBe(PHONE);
  });

  it('makes the password grant demand a second factor from an SMS-only user', async () => {
    const res = await request(app.getHttpServer())
      .post(`/realms/${REALM_NAME}/protocol/openid-connect/token`)
      .type('form')
      .send({
        grant_type: 'password',
        client_id: 'test-client',
        client_secret: 'test-client-secret',
        username: 'testuser',
        password: 'TestPassword123!',
        scope: 'openid',
      });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('mfa_required');
    expect(res.body).not.toHaveProperty('access_token');
  });

  it('reports the SMS factor in the admin MFA status', async () => {
    const res = await request(app.getHttpServer())
      .get(`/admin/realms/${REALM_NAME}/users/${seeded.user.id}/mfa/status`)
      .set('x-admin-api-key', TEST_ADMIN_API_KEY)
      .expect(200);

    expect(res.body).toEqual({ enabled: true, methods: ['sms'] });
  });

  it('accepts a correct code exactly once', async () => {
    await smsOtp.sendCode({
      realm: await realm(),
      userId: seeded.user.id,
      purpose: 'login',
      binding: 'challenge-once',
    });
    expect(sent[sent.length - 1].to).toBe(PHONE);
    const code = lastCode();
    const verify = () =>
      mfa.verifySecondFactor(seeded.user.id, {
        method: 'sms',
        code,
        realmId: seeded.realm.id,
        purpose: 'login',
        binding: 'challenge-once',
      });

    const results = await Promise.all([verify(), verify(), verify()]);

    expect(results.filter((r) => r.verified)).toHaveLength(1);
  });

  it('rejects a code sent for another challenge', async () => {
    await smsOtp.sendCode({
      realm: await realm(),
      userId: seeded.user.id,
      purpose: 'login',
      binding: 'challenge-a',
    });
    const codeForA = lastCode();

    const onB = await smsOtp.verifyCode({
      realmId: seeded.realm.id,
      userId: seeded.user.id,
      purpose: 'login',
      binding: 'challenge-b',
      code: codeForA,
    });
    const onStepUp = await smsOtp.verifyCode({
      realmId: seeded.realm.id,
      userId: seeded.user.id,
      purpose: 'step_up',
      binding: 'challenge-a',
      code: codeForA,
    });

    expect(onB.ok).toBe(false);
    expect(onStepUp.ok).toBe(false);
  });

  it('caps parallel guesses and keeps the budget across a resend', async () => {
    const binding = 'challenge-brute';
    await smsOtp.sendCode({
      realm: await realm(),
      userId: seeded.user.id,
      purpose: 'login',
      binding,
    });
    const realCode = lastCode();
    const wrong = realCode === '000000' ? '111111' : '000000';

    const guesses = await Promise.all(
      Array.from({ length: 3 }, () =>
        smsOtp.verifyCode({
          realmId: seeded.realm.id,
          userId: seeded.user.id,
          purpose: 'login',
          binding,
          code: wrong,
        }),
      ),
    );
    expect(guesses.every((g) => !g.ok)).toBe(true);

    // Resend after the cooldown: new code, same guess budget.
    await ctx.prisma.otpAttempt.updateMany({
      where: { userId: seeded.user.id, purpose: 'login' },
      data: { lastSentAt: new Date(Date.now() - 60_000) },
    });
    await smsOtp.sendCode({
      realm: await realm(),
      userId: seeded.user.id,
      purpose: 'login',
      binding,
    });
    const resentCode = lastCode();
    const wrong2 = resentCode === '000000' ? '111111' : '000000';

    const more = await Promise.all(
      Array.from({ length: 10 }, () =>
        smsOtp.verifyCode({
          realmId: seeded.realm.id,
          userId: seeded.user.id,
          purpose: 'login',
          binding,
          code: wrong2,
        }),
      ),
    );
    expect(more.every((g) => !g.ok)).toBe(true);

    const row = await ctx.prisma.otpAttempt.findFirstOrThrow({
      where: { userId: seeded.user.id, purpose: 'login', sendCount: 2 },
    });
    expect(row.attempts).toBe(SMS_OTP_MAX_ATTEMPTS);

    // Budget spent: even the right code is refused now.
    const late = await smsOtp.verifyCode({
      realmId: seeded.realm.id,
      userId: seeded.user.id,
      purpose: 'login',
      binding,
      code: resentCode,
    });
    expect(late).toMatchObject({ ok: false, reason: 'locked' });
  });

  it('enrols a new phone only after its code is confirmed', async () => {
    const NEW_PHONE = '+201098765432';
    const send = await smsOtp.sendCode({
      realm: await realm(),
      userId: seeded.user.id,
      purpose: 'enroll',
      binding: 'enrol-1',
      phone: '+20 109 876 5432',
    });
    expect(send.maskedPhone).toBe('+20••••••5432');
    expect(sent[sent.length - 1].to).toBe(NEW_PHONE);
    // The old number stays active until the new one is confirmed.
    expect(await smsOtp.getEnrolledPhone(seeded.user.id)).toBe(PHONE);

    const result = await smsOtp.verifyCode({
      realmId: seeded.realm.id,
      userId: seeded.user.id,
      purpose: 'enroll',
      binding: 'enrol-1',
      code: lastCode(),
    });
    expect(result).toEqual({ ok: true, phone: NEW_PHONE });
  });

  it('keeps recovery codes when the app is removed but the phone remains', async () => {
    await ctx.prisma.userCredential.create({
      data: {
        userId: seeded.user.id,
        type: 'totp',
        secretKey: 'JBSWY3DPEHPK3PXP',
        verified: true,
      },
    });
    const codes = await mfa.ensureRecoveryCodes(seeded.user.id);
    expect(codes).toHaveLength(10);

    await mfa.disableTotp(seeded.user.id);
    expect(
      await ctx.prisma.recoveryCode.count({ where: { userId: seeded.user.id } }),
    ).toBe(10);

    await mfa.disableSms(seeded.user.id);
    expect(
      await ctx.prisma.recoveryCode.count({ where: { userId: seeded.user.id } }),
    ).toBe(0);
    expect(await mfa.isMfaEnabled(seeded.user.id)).toBe(false);
  });
});
