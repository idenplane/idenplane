import {
  ADMIN_EVENT_PURGE_BATCH,
  ADMIN_EVENT_PURGE_TASK,
  ADMIN_EVENT_PURGE_VERSION,
  AdminEventPurgeService,
} from './admin-event-purge.service.js';

type Task = {
  completedVersion: number;
  cursor: string | null;
  cursorVersion: number;
};

/** admin_events and maintenance_tasks in memory; raw UPDATEs are counted. */
function fakeDb(events: Array<{ id: string; representation: unknown }>) {
  let task: Task | null = null;
  const updates: number[] = [];
  const tx = {
    $executeRawUnsafe: jest.fn(() => Promise.resolve(0)),
    $executeRaw: jest.fn((strings: TemplateStringsArray, values: unknown) => {
      void strings;
      void values;
      return Promise.resolve(0);
    }),
    maintenanceTask: {
      findUnique: jest.fn(() => Promise.resolve(task)),
      upsert: jest.fn(
        (args: { create: Partial<Task>; update: Partial<Task> }) => {
          task = {
            completedVersion: 0,
            cursor: null,
            cursorVersion: 0,
            ...(task ?? {}),
            ...(task ? args.update : args.create),
          };
          return Promise.resolve(task);
        },
      ),
    },
    adminEvent: {
      findMany: jest.fn(
        (args: { where: { id?: { gt: string } }; take: number }) => {
          const after = args.where.id?.gt;
          return Promise.resolve(
            [...events]
              .sort((a, b) => (a.id < b.id ? -1 : 1))
              .filter((e) => after === undefined || e.id > after)
              .slice(0, args.take),
          );
        },
      ),
    },
  };
  // Count the rows each UPDATE … FROM (VALUES …) carries.
  tx.$executeRaw.mockImplementation((_s: unknown, values: unknown) => {
    const n = (values as { values: unknown[] }).values.length / 2;
    updates.push(n);
    return Promise.resolve(n);
  });
  const prisma = {
    $transaction: jest.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    onBeforeDisconnect: jest.fn(),
  };
  return { prisma, updates, task: () => task };
}

describe('AdminEventPurgeService', () => {
  const events = (n: number, secretEvery: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `e${String(i).padStart(6, '0')}`,
      representation:
        i % secretEvery === 0
          ? { name: 'x', bindCredential: 'pass' }
          : { name: 'x' },
    }));

  it('rewrites only rows that held a secret, in batches, then marks the task done', async () => {
    const rows = events(ADMIN_EVENT_PURGE_BATCH * 2 + 5, 10);
    const { prisma, updates, task } = fakeDb(rows);
    const service = new AdminEventPurgeService(prisma as any);
    const result = await service.run();
    expect(result).toEqual({
      scanned: rows.length,
      redacted: Math.ceil(rows.length / 10),
      alreadyDone: false,
    });
    expect(updates).toEqual([100, 100, 1]);
    expect(task()).toMatchObject({
      completedVersion: ADMIN_EVENT_PURGE_VERSION,
      cursor: null,
      cursorVersion: ADMIN_EVENT_PURGE_VERSION,
    });

    const again = await service.run();
    expect(again).toEqual({ scanned: 0, redacted: 0, alreadyDone: true });
  });

  it('resumes from the stored cursor', async () => {
    const rows = events(ADMIN_EVENT_PURGE_BATCH + 10, 1);
    const { prisma } = fakeDb(rows);
    const service = new AdminEventPurgeService(prisma as any);
    // Interrupted after the first batch: only the cursor was kept.
    const tx = (prisma.$transaction as jest.Mock).getMockImplementation()!;
    let calls = 0;
    (prisma.$transaction as jest.Mock).mockImplementation((fn: any) => {
      calls++;
      if (calls === 2) return Promise.reject(new Error('process stopped'));
      return tx(fn);
    });
    await expect(service.run()).rejects.toThrow('process stopped');
    (prisma.$transaction as jest.Mock).mockImplementation(tx);
    const resumed = await service.run();
    expect(resumed.scanned).toBe(10);
  });

  it('stops before the pool closes: no batch starts after shutdown', async () => {
    const { prisma } = fakeDb(events(ADMIN_EVENT_PURGE_BATCH * 3, 1));
    const service = new AdminEventPurgeService(prisma as any);
    const stop = (prisma.onBeforeDisconnect as jest.Mock).mock.calls[0][0];
    service.onApplicationBootstrap();
    await stop();
    const batches = (prisma.$transaction as jest.Mock).mock.calls.length;
    expect(batches).toBeLessThan(3);
    await new Promise((r) => setImmediate(r));
    expect((prisma.$transaction as jest.Mock).mock.calls.length).toBe(batches);
  });

  it('starts over when the stored walk belongs to an older version', async () => {
    const rows = events(5, 1);
    const { prisma } = fakeDb(rows);
    await prisma.$transaction((t: any) =>
      t.maintenanceTask.upsert({
        where: { id: ADMIN_EVENT_PURGE_TASK },
        create: {
          completedVersion: ADMIN_EVENT_PURGE_VERSION - 1,
          cursor: 'e000003',
          cursorVersion: ADMIN_EVENT_PURGE_VERSION - 1,
        },
        update: {},
      }),
    );
    const result = await new AdminEventPurgeService(prisma as any).run();
    expect(result.scanned).toBe(5);
  });
});
