import { createTestApp, type TestContext } from './setup';
import { BruteForceService } from '../src/brute-force/brute-force.service';

/**
 * Failed sign-ins counted under concurrency, as a password-guessing attack
 * produces them: every failure must count towards the lockout.
 */
describe('Brute-force counting under concurrency (e2e)', () => {
  let ctx: TestContext;
  let bruteForce: BruteForceService;
  const REALM = 'e2e-brute-force-concurrency';

  beforeAll(async () => {
    ctx = await createTestApp();
    bruteForce = ctx.app.get(BruteForceService);
    await ctx.seedTestRealm(REALM);
  }, 30_000);

  afterAll(async () => {
    await ctx.prisma.realm.delete({ where: { name: REALM } }).catch(() => {});
    await ctx.cleanup();
  });

  const setup = async (maxLoginFailures: number) => {
    const realm = await ctx.prisma.realm.update({
      where: { name: REALM },
      data: {
        bruteForceEnabled: true,
        maxLoginFailures,
        failureResetTime: 600,
        lockoutDuration: 600,
      },
    });
    const user = await ctx.prisma.user.findFirstOrThrow({
      where: { username: 'testuser', realmId: realm.id },
    });
    await bruteForce.resetFailures(realm.id, user.id);
    return { realm, user };
  };

  it('counts every one of twenty simultaneous failures', async () => {
    const { realm, user } = await setup(1000);
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        bruteForce.recordFailure(realm, user.id, '203.0.113.7'),
      ),
    );
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(0);
    expect(
      await ctx.prisma.loginFailure.count({ where: { userId: user.id } }),
    ).toBe(20);
  });

  it('locks the account when simultaneous failures reach the limit', async () => {
    const { realm, user } = await setup(5);
    await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        bruteForce.recordFailure(realm, user.id, '203.0.113.7'),
      ),
    );
    const after = await ctx.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(after.lockedUntil?.getTime()).toBeGreaterThan(Date.now());
  });
});
