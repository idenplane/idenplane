import { createTestApp, type TestContext } from './setup';
import { WebhookSchedulerService } from '../src/webhooks/webhook-scheduler.service';
import { CryptoService } from '../src/crypto/crypto.service';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * The webhook outbox with more than one process draining it, as with
 * replicas or a rolling deploy. Each event must be delivered once, and an
 * event left PROCESSING by a process that died must be delivered later.
 * The HTTP call is replaced by a counter; everything else is real.
 */
describe('Webhook outbox with several processes (e2e)', () => {
  let ctx: TestContext;
  const REALM = 'e2e-webhook-outbox';
  let realmId: string;
  const sent: string[] = [];

  /** A scheduler as a separate process would have it, with its HTTP stubbed. */
  const scheduler = () => {
    const s = new WebhookSchedulerService(
      ctx.app.get(PrismaService),
      ctx.app.get(CryptoService),
    );
    jest
      .spyOn(
        s as unknown as { doHttpPost: () => Promise<unknown> },
        'doHttpPost',
      )
      .mockImplementation(async (...args: unknown[]) => {
        sent.push(JSON.parse(args[1] as string).id as string);
        await new Promise((r) => setTimeout(r, 20));
        return { statusCode: 200, body: 'ok' };
      });
    return s;
  };

  const enqueue = (n: number) =>
    Promise.all(
      Array.from({ length: n }, (_, i) =>
        ctx.prisma.$executeRawUnsafe(
          `INSERT INTO webhook_events (id, realm_id, event_type, payload, status, attempts, max_attempts, next_retry_at, created_at, updated_at)
           VALUES (gen_random_uuid(), '${realmId}', 'user.login', jsonb_build_object('id', 'evt-${n}-${i}'), 'PENDING', 0, 4, now(), now(), now())`,
        ),
      ),
    );

  beforeAll(async () => {
    ctx = await createTestApp();
    await ctx.seedTestRealm(REALM);
    realmId = (
      await ctx.prisma.realm.findUniqueOrThrow({ where: { name: REALM } })
    ).id;
    await ctx.prisma.webhook.create({
      data: {
        realmId,
        url: 'https://hooks.example.com/idenplane',
        secret: ctx.app.get(CryptoService).encrypt('whsec'),
        eventTypes: ['user.login'],
      },
    });
  }, 30_000);

  afterAll(async () => {
    await ctx.prisma.$executeRawUnsafe(
      `DELETE FROM webhook_events WHERE realm_id = '${realmId}'`,
    );
    await ctx.prisma.realm.delete({ where: { name: REALM } }).catch(() => {});
    await ctx.cleanup();
  });

  beforeEach(() => {
    sent.length = 0;
  });

  it('delivers every event exactly once when three processes drain the queue at once', async () => {
    await enqueue(30);
    const [a, b, c] = [scheduler(), scheduler(), scheduler()];

    await Promise.all([a.processQueue(), b.processQueue(), c.processQueue()]);

    expect(sent).toHaveLength(30);
    expect(new Set(sent).size).toBe(30);
    const delivered = await ctx.prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*) AS n FROM webhook_events WHERE realm_id = '${realmId}' AND status = 'DELIVERED'`,
    );
    expect(Number(delivered[0].n)).toBe(30);
  });

  it('takes over an event left PROCESSING by a process that died, once its lease ran out', async () => {
    await ctx.prisma.$executeRawUnsafe(
      `INSERT INTO webhook_events (id, realm_id, event_type, payload, status, attempts, max_attempts, next_retry_at, created_at, updated_at)
       VALUES (gen_random_uuid(), '${realmId}', 'user.login', jsonb_build_object('id', 'stranded'), 'PROCESSING', 0, 4, now(), now(), now() - interval '6 minutes'),
              (gen_random_uuid(), '${realmId}', 'user.login', jsonb_build_object('id', 'in-flight'), 'PROCESSING', 0, 4, now(), now(), now())`,
    );

    await scheduler().processQueue();

    expect(sent).toEqual(['stranded']);
  });
});
