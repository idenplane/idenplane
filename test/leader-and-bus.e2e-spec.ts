import { createTestApp, type TestContext } from './setup';
import { LeaderService } from '../src/cache/leader.service';
import { CacheBusService } from '../src/cache/cache-bus.service';

/**
 * Two processes' worth of LeaderService and CacheBusService against one
 * real PostgreSQL: exactly one leader at a time, a successor once it goes,
 * and messages published on one process reaching the other.
 */
describe('Leader election and the message bus across processes (e2e)', () => {
  let ctx: TestContext;
  const url = () => process.env['DATABASE_URL'] ?? '';
  const prismaStub = { onBeforeDisconnect: () => {} } as never;

  const eventually = async (check: () => void, ms = 10_000) => {
    const deadline = Date.now() + ms;
    for (;;) {
      try {
        return check();
      } catch (err) {
        if (Date.now() > deadline) throw err;
        await new Promise((r) => setTimeout(r, 50));
      }
    }
  };

  /**
   * A LeaderService as another process would run it, on a lock of the
   * test's own: the apps of other test files compete for the real one.
   */
  class TestLeader extends LeaderService {
    protected readonly lockKey = 424_242_001;
  }
  const candidate = async () => {
    const l = new TestLeader(prismaStub);
    l.onModuleInit();
    return l;
  };
  const tryNow = (l: LeaderService) =>
    (l as unknown as { attempt: (u: string) => Promise<void> }).attempt(url());

  beforeAll(async () => {
    ctx = await createTestApp();
  }, 30_000);

  afterAll(async () => {
    await ctx.cleanup();
  });

  it('elects exactly one leader, and a successor once the leader goes', async () => {
    const a = await candidate();
    const b = await candidate();
    await eventually(() => expect(a.isLeader() || b.isLeader()).toBe(true));
    await tryNow(a);
    await tryNow(b);
    expect([a.isLeader(), b.isLeader()].filter(Boolean)).toHaveLength(1);

    const [leader, other] = a.isLeader() ? [a, b] : [b, a];
    await leader.onModuleDestroy();
    expect(leader.isLeader()).toBe(false);
    await tryNow(other);
    expect(other.isLeader()).toBe(true);
    await other.onModuleDestroy();
  }, 30_000);

  it('steps down when its connection is killed, so another can take over', async () => {
    const a = await candidate();
    await eventually(() => expect(a.isLeader()).toBe(true));
    await ctx.prisma.$executeRawUnsafe(
      `SELECT pg_terminate_backend(l.pid) FROM pg_locks l WHERE l.locktype = 'advisory' AND l.objid = 424242001 AND l.granted`,
    );
    await eventually(() => expect(a.isLeader()).toBe(false));
    const b = await candidate();
    await eventually(() => expect(b.isLeader()).toBe(true));
    await a.onModuleDestroy();
    await b.onModuleDestroy();
  }, 30_000);

  it('delivers a message published on one process to the others, and to itself', async () => {
    const one = new CacheBusService(prismaStub);
    const two = new CacheBusService(prismaStub);
    one.onModuleInit();
    two.onModuleInit();
    await eventually(() =>
      expect(one.isConnected() && two.isConnected()).toBe(true),
    );
    const heardByOne: unknown[] = [];
    const heardByTwo: unknown[] = [];
    one.onMessage('test-topic', (p) => heardByOne.push(p));
    two.onMessage('test-topic', (p) => heardByTwo.push(p));

    await one.publish('test-topic', { userId: 'u1', n: 1 });

    await eventually(() => {
      expect(heardByTwo).toEqual([{ userId: 'u1', n: 1 }]);
      expect(heardByOne).toEqual([{ userId: 'u1', n: 1 }]);
    });
    await one.onModuleDestroy();
    await two.onModuleDestroy();
  }, 30_000);
});
