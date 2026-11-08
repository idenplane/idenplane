import * as OTPAuth from 'otpauth';
import { createTestApp, type TestContext } from './setup';
import { MfaService } from '../src/mfa/mfa.service';

/**
 * A TOTP code is good once. Ten submissions of the same valid code at the
 * same moment used to be able to pass together: each checked "not used yet"
 * before any had recorded it. The claim is now the insert on a unique index.
 */
describe('TOTP replay under concurrency (e2e)', () => {
  let ctx: TestContext;
  let mfa: MfaService;
  const REALM = 'e2e-totp-replay';
  let userId: string;
  let totp: OTPAuth.TOTP;

  beforeAll(async () => {
    ctx = await createTestApp();
    mfa = ctx.app.get(MfaService);
    await ctx.seedTestRealm(REALM);
    const user = await ctx.prisma.user.findFirstOrThrow({
      where: { username: 'testuser', realm: { name: REALM } },
    });
    userId = user.id;
    const secret = new OTPAuth.Secret({ size: 20 });
    totp = new OTPAuth.TOTP({
      secret,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    });
    await ctx.prisma.userCredential.create({
      data: {
        userId,
        type: 'totp',
        secretKey: secret.base32,
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        verified: true,
      },
    });
  }, 30_000);

  afterAll(async () => {
    await ctx.prisma.realm.delete({ where: { name: REALM } }).catch(() => {});
    await ctx.cleanup();
  });

  it('accepts a code exactly once when it is submitted ten times at once', async () => {
    const code = totp.generate();
    // The race in its worst case: every submission passes the "already
    // used?" check before any of them has recorded the code. Only the claim
    // itself can then stop the other nine.
    const check = jest
      .spyOn(
        mfa as unknown as { isTotpCodeUsed: () => Promise<boolean> },
        'isTotpCodeUsed',
      )
      .mockResolvedValue(false);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => mfa.verifyTotp(userId, code)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    check.mockRestore();
    expect(await mfa.verifyTotp(userId, code)).toBe(false);
  });

  it('accepts the same code again once its earlier use has expired', async () => {
    const code = totp.generate();
    await ctx.prisma.usedTotpCode.updateMany({
      where: { userId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    // The process-local fast path still remembers it; a second process would
    // not, so ask a fresh service the way another replica would.
    const other = new MfaService(
      ctx.prisma as never,
      ctx.app.get(MfaService)['crypto'],
    );
    expect(await other.verifyTotp(userId, code)).toBe(true);
  });
});
