import { createTestApp, type TestContext } from './setup';
import { AdminSeedService } from '../src/admin-auth/admin-seed.service';
import { SetupWizardService } from '../src/setup-wizard/setup-wizard.service';

/**
 * First boot with several instances starting at once: the master realm and
 * the setup wizard's state are each created exactly once, and complete.
 */
describe('First-boot work with several instances (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  }, 30_000);

  afterAll(async () => {
    // Leave a master realm behind, as every other suite expects one.
    await ctx.app.get(AdminSeedService).onApplicationBootstrap();
    await ctx.cleanup();
  });

  it('creates the master realm and its admin once when four instances boot at once', async () => {
    await ctx.prisma.realm.deleteMany({ where: { name: 'master' } });
    const seed = ctx.app.get(AdminSeedService);
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => seed.onApplicationBootstrap()),
    );

    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(0);
    const masters = await ctx.prisma.realm.findMany({
      where: { name: 'master' },
      include: { users: true, roles: true },
    });
    expect(masters).toHaveLength(1);
    expect(masters[0].users).toHaveLength(1);
    expect(masters[0].roles.map((r) => r.name).sort()).toEqual([
      'realm-admin',
      'super-admin',
      'view-only',
    ]);
  }, 60_000);

  it('creates one wizard state when the first requests arrive together', async () => {
    await ctx.prisma.wizardState.deleteMany({});
    const wizard = ctx.app.get(SetupWizardService);
    const states = await Promise.all(
      Array.from({ length: 5 }, () => wizard.getWizardState()),
    );
    expect(new Set(states.map((s) => s.id)).size).toBe(1);
    expect(await ctx.prisma.wizardState.count()).toBe(1);
  });
});
