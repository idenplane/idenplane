import {
  RECORDED_CACHE_LIMIT,
  UsageActivityRecorder,
} from './usage-activity.recorder.js';

describe('UsageActivityRecorder', () => {
  let createMany: jest.Mock;
  let recorder: UsageActivityRecorder;

  const nov = new Date('2026-11-19T10:00:00.000Z');
  const dec = new Date('2026-12-01T00:00:00.000Z');

  beforeEach(() => {
    createMany = jest.fn().mockResolvedValue({ count: 1 });
    recorder = new UsageActivityRecorder({
      userMonthlyActivity: { createMany },
    } as never);
  });

  it('writes the user once for the UTC month, idempotently', async () => {
    await recorder.record('realm-1', 'user-1', nov);

    expect(createMany).toHaveBeenCalledWith({
      data: [
        {
          month: new Date('2026-11-01T00:00:00.000Z'),
          realmId: 'realm-1',
          userId: 'user-1',
        },
      ],
      skipDuplicates: true,
    });
  });

  it('answers a user already written this month from memory', async () => {
    await recorder.record('realm-1', 'user-1', nov);
    await recorder.record('realm-1', 'user-1', nov);
    await recorder.record('realm-1', 'user-2', nov);

    expect(createMany).toHaveBeenCalledTimes(2);
  });

  it('writes the user again in a new month', async () => {
    await recorder.record('realm-1', 'user-1', nov);
    await recorder.record('realm-1', 'user-1', dec);

    expect(createMany).toHaveBeenCalledTimes(2);
    expect(createMany.mock.calls[1][0].data[0].month).toEqual(
      new Date('2026-12-01T00:00:00.000Z'),
    );
  });

  it('uses the UTC month, not the server time zone', async () => {
    // 23:30 on 31 October in UTC-something is still October in UTC.
    await recorder.record(
      'realm-1',
      'user-1',
      new Date('2026-10-31T23:30:00Z'),
    );
    expect(createMany.mock.calls[0][0].data[0].month).toEqual(
      new Date('2026-10-01T00:00:00.000Z'),
    );
  });

  it('never throws, and retries after a failed write', async () => {
    createMany.mockRejectedValueOnce(new Error('connection lost'));

    await expect(
      recorder.record('realm-1', 'user-1', nov),
    ).resolves.toBeUndefined();
    await recorder.record('realm-1', 'user-1', nov);

    expect(createMany).toHaveBeenCalledTimes(2);
  });

  it('forgets the oldest users past the cache limit', async () => {
    for (let i = 0; i <= RECORDED_CACHE_LIMIT; i++) {
      await recorder.record('realm-1', `user-${i}`, nov);
    }
    expect(createMany).toHaveBeenCalledTimes(RECORDED_CACHE_LIMIT + 1);

    // user-0 was evicted: written again (a no-op insert in the database).
    await recorder.record('realm-1', 'user-0', nov);
    expect(createMany).toHaveBeenCalledTimes(RECORDED_CACHE_LIMIT + 2);

    // The most recent one is still remembered.
    await recorder.record('realm-1', `user-${RECORDED_CACHE_LIMIT}`, nov);
    expect(createMany).toHaveBeenCalledTimes(RECORDED_CACHE_LIMIT + 2);
  });
});
