import {
  USAGE_PRUNE_BATCH,
  UsageRetentionService,
} from './usage-retention.service.js';
import { USAGE_RETENTION_ENV } from './usage-retention.config.js';

describe('UsageRetentionService', () => {
  const ENV = USAGE_RETENTION_ENV;
  const now = new Date('2026-11-19T10:00:00.000Z');
  let previous: string | undefined;
  let executeRaw: jest.Mock;
  let leader: { isLeader: jest.Mock };

  const make = (setting?: string) => {
    if (setting === undefined) delete process.env[ENV];
    else process.env[ENV] = setting;
    return new UsageRetentionService(
      { $executeRaw: executeRaw } as never,
      leader as never,
    );
  };
  /** The SQL text of the n-th $executeRaw call (a tagged template). */
  const sqlOf = (n: number) =>
    (executeRaw.mock.calls[n][0] as string[]).join('$');
  const paramsOf = (n: number) => executeRaw.mock.calls[n].slice(1);

  beforeEach(() => {
    previous = process.env[ENV];
    executeRaw = jest.fn().mockResolvedValue(0);
    leader = { isLeader: jest.fn().mockReturnValue(true) };
  });

  afterEach(() => {
    if (previous === undefined) delete process.env[ENV];
    else process.env[ENV] = previous;
  });

  it('keeps 13 months by default', () => {
    const service = make();
    expect(service.retentionMonths).toBe(13);
    expect(service.cutoff(now)).toEqual(new Date('2025-10-01T00:00:00.000Z'));
  });

  it('marks the cutoff, then deletes the months before it', async () => {
    const service = make('13');
    await service.prune(now);

    expect(sqlOf(0)).toContain('UPDATE "usage_tracking"');
    expect(sqlOf(0)).toContain('GREATEST');
    expect(paramsOf(0)[0]).toEqual(new Date('2025-10-01T00:00:00.000Z'));

    expect(sqlOf(1)).toContain('DELETE FROM "user_monthly_activity"');
    expect(sqlOf(1)).toContain('"month" <');
    expect(sqlOf(1)).toContain('LIMIT');
    expect(paramsOf(1)).toEqual([
      new Date('2025-10-01T00:00:00.000Z'),
      USAGE_PRUNE_BATCH,
    ]);
  });

  it('deletes in bounded batches until a short one', async () => {
    const service = make('13');
    executeRaw
      .mockResolvedValueOnce(1) // the mark
      .mockResolvedValueOnce(USAGE_PRUNE_BATCH)
      .mockResolvedValueOnce(USAGE_PRUNE_BATCH)
      .mockResolvedValueOnce(12);

    await expect(service.prune(now)).resolves.toBe(2 * USAGE_PRUNE_BATCH + 12);
    expect(executeRaw).toHaveBeenCalledTimes(4);
  });

  it('never deletes the current or the previous month at the minimum', async () => {
    const service = make('1');
    await service.prune(now);
    expect(paramsOf(1)[0]).toEqual(new Date('2026-10-01T00:00:00.000Z'));
  });

  it('does nothing when pruning is off', async () => {
    const service = make('off');
    expect(service.cutoff(now)).toBeNull();
    await expect(service.prune(now)).resolves.toBe(0);
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it('runs on the leader only', async () => {
    const service = make('13');
    leader.isLeader.mockReturnValue(false);
    await service.pruneOnSchedule();
    expect(executeRaw).not.toHaveBeenCalled();

    leader.isLeader.mockReturnValue(true);
    await service.pruneOnSchedule();
    expect(executeRaw).toHaveBeenCalled();
  });

  it('logs a failed scheduled prune instead of throwing', async () => {
    const service = make('13');
    executeRaw.mockRejectedValue(new Error('lock timeout'));
    await expect(service.pruneOnSchedule()).resolves.toBeUndefined();
  });

  it('refuses an invalid setting', () => {
    expect(() => make('0')).toThrow();
  });
});
