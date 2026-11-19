import { BadRequestException } from '@nestjs/common';
import { UsageService } from './usage.service.js';
import { APP_VERSION } from '../versioning/app-version.js';

describe('UsageService', () => {
  const now = new Date('2026-11-19T10:00:00.000Z');

  let prisma: {
    realm: { findMany: jest.Mock };
    $queryRaw: jest.Mock;
    userMonthlyActivity: { groupBy: jest.Mock };
    usageTracking: { findUnique: jest.Mock };
  };
  let service: UsageService;
  let retention: { retentionMonths: number | null; cutoff: jest.Mock };

  beforeEach(() => {
    prisma = {
      realm: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'r-acme', name: 'acme' },
          { id: 'r-master', name: 'master' },
          { id: 'r-empty', name: 'zeta' },
        ]),
      },
      $queryRaw: jest.fn().mockResolvedValue([
        { realmId: 'r-acme', users: 120 },
        { realmId: 'r-master', users: 2 },
      ]),
      userMonthlyActivity: {
        groupBy: jest.fn().mockResolvedValue([
          { realmId: 'r-acme', _count: { _all: 40 } },
          { realmId: 'r-master', _count: { _all: 1 } },
          // Activity of a realm deleted later in the month.
          { realmId: 'r-gone', _count: { _all: 7 } },
        ]),
      },
      usageTracking: {
        findUnique: jest.fn().mockResolvedValue({
          trackingSince: new Date('2026-06-15T09:00:00.000Z'),
          prunedBefore: null,
        }),
      },
    };
    retention = {
      retentionMonths: 13,
      cutoff: jest.fn().mockReturnValue(new Date('2025-10-01T00:00:00.000Z')),
    };
    service = new UsageService(prisma as never, retention as never);
  });

  it('reports the current UTC month by default', async () => {
    const usage = await service.getUsage(undefined, now);

    expect(usage.version).toBe(APP_VERSION);
    expect(usage.generatedAt).toBe(now.toISOString());
    expect(usage.period).toEqual({
      month: '2026-11',
      start: '2026-11-01T00:00:00.000Z',
      end: '2026-12-01T00:00:00.000Z',
      closed: false,
      complete: true,
      pruned: false,
    });
    expect(usage.retention).toEqual({ months: 13, oldestMonth: '2025-10' });
    expect(prisma.userMonthlyActivity.groupBy).toHaveBeenCalledWith({
      by: ['realmId'],
      where: { month: new Date('2026-11-01T00:00:00.000Z') },
      _count: { _all: true },
    });
  });

  it('gives per-realm and total numbers, deleted realms included', async () => {
    const usage = await service.getUsage(undefined, now);

    expect(usage.realms).toEqual([
      {
        id: 'r-acme',
        name: 'acme',
        deleted: false,
        users: 120,
        monthlyActiveUsers: 40,
      },
      {
        id: 'r-master',
        name: 'master',
        deleted: false,
        users: 2,
        monthlyActiveUsers: 1,
      },
      {
        id: 'r-empty',
        name: 'zeta',
        deleted: false,
        users: 0,
        monthlyActiveUsers: 0,
      },
      {
        id: 'r-gone',
        name: null,
        deleted: true,
        users: 0,
        monthlyActiveUsers: 7,
      },
    ]);
    expect(usage.totals).toEqual({
      realms: 3,
      users: 122,
      monthlyActiveUsers: 48,
    });
    expect(usage.tracking).toEqual({ since: '2026-06-15T09:00:00.000Z' });
  });

  it('reports a closed past month', async () => {
    const usage = await service.getUsage('2026-10', now);

    expect(usage.period).toEqual({
      month: '2026-10',
      start: '2026-10-01T00:00:00.000Z',
      end: '2026-11-01T00:00:00.000Z',
      closed: true,
      complete: true,
      pruned: false,
    });
    expect(prisma.userMonthlyActivity.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { month: new Date('2026-10-01T00:00:00.000Z') },
      }),
    );
  });

  it('marks a month that started before tracking as incomplete', async () => {
    const usage = await service.getUsage('2026-06', now);
    expect(usage.period.complete).toBe(false);
  });

  it('marks every month incomplete when the tracking start is unknown', async () => {
    prisma.usageTracking.findUnique.mockResolvedValue(null);
    const usage = await service.getUsage(undefined, now);
    expect(usage.period.complete).toBe(false);
    expect(usage.tracking.since).toBeNull();
  });

  it('flags a month older than the retention as pruned, not as zero', async () => {
    const usage = await service.getUsage('2025-09', now);
    expect(usage.period.pruned).toBe(true);
    expect(usage.period.complete).toBe(false);
    // The oldest kept month is not pruned.
    const kept = await service.getUsage('2025-10', now);
    expect(kept.period.pruned).toBe(false);
  });

  it('keeps reporting months pruned under an earlier, shorter retention', async () => {
    retention.retentionMonths = null;
    retention.cutoff.mockReturnValue(null);
    prisma.usageTracking.findUnique.mockResolvedValue({
      trackingSince: new Date('2024-01-01T00:00:00.000Z'),
      prunedBefore: new Date('2026-03-01T00:00:00.000Z'),
    });

    const usage = await service.getUsage('2026-02', now);
    expect(usage.period.pruned).toBe(true);
    expect(usage.retention).toEqual({ months: null, oldestMonth: '2026-03' });
    expect((await service.getUsage('2026-03', now)).period.pruned).toBe(false);
  });

  it('prunes nothing with retention off and no earlier prune', async () => {
    retention.retentionMonths = null;
    retention.cutoff.mockReturnValue(null);
    const usage = await service.getUsage('2020-01', now);
    expect(usage.period.pruned).toBe(false);
    expect(usage.retention).toEqual({ months: null, oldestMonth: null });
  });

  it('refuses a future month', async () => {
    await expect(service.getUsage('2026-12', now)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.userMonthlyActivity.groupBy).not.toHaveBeenCalled();
  });

  it('counts users without service accounts, in one grouped query', async () => {
    await service.getUsage(undefined, now);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const sql = (prisma.$queryRaw.mock.calls[0][0] as string[]).join('?');
    expect(sql).toContain('service_account_user_id');
    expect(sql).toContain('GROUP BY');
  });
});
