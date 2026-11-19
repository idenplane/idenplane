import {
  DEFAULT_USAGE_RETENTION_MONTHS,
  loadUsageRetention,
  retentionCutoff,
  UsageRetentionConfigError,
  USAGE_RETENTION_ENV,
} from './usage-retention.config.js';

const load = (value: string | undefined) =>
  loadUsageRetention({ [USAGE_RETENTION_ENV]: value });

describe('USAGE_ACTIVITY_RETENTION_MONTHS', () => {
  it('defaults to 13 months', () => {
    expect(DEFAULT_USAGE_RETENTION_MONTHS).toBe(13);
    expect(load(undefined)).toBe(13);
    expect(load('')).toBe(13);
    expect(load('  ')).toBe(13);
  });

  it('takes a number of months', () => {
    expect(load('1')).toBe(1);
    expect(load('24')).toBe(24);
    expect(load(' 36 ')).toBe(36);
    expect(load('1200')).toBe(1200);
  });

  it('turns pruning off explicitly', () => {
    expect(load('off')).toBeNull();
    expect(load('OFF')).toBeNull();
  });

  it.each(['0', '-1', '1201', '1.5', '13 months', 'of', 'false', 'never'])(
    'refuses %j',
    (value) => {
      expect(() => load(value)).toThrow(UsageRetentionConfigError);
    },
  );

  describe('cutoff', () => {
    const november = new Date('2026-11-01T00:00:00.000Z');

    it('keeps the current month and the N whole months before it', () => {
      // 13: October 2025 to November 2026 are kept.
      expect(retentionCutoff(13, november)).toEqual(
        new Date('2025-10-01T00:00:00.000Z'),
      );
    });

    it('never prunes the current or the previous month, even at the minimum', () => {
      const cutoff = retentionCutoff(1, november)!;
      expect(cutoff).toEqual(new Date('2026-10-01T00:00:00.000Z'));
      // Pruned are months strictly before the cutoff.
      expect(cutoff.getTime()).toBeLessThanOrEqual(
        new Date('2026-10-01T00:00:00.000Z').getTime(),
      );
    });

    it('crosses year boundaries', () => {
      expect(retentionCutoff(2, new Date('2027-01-01T00:00:00.000Z'))).toEqual(
        new Date('2026-11-01T00:00:00.000Z'),
      );
    });

    it('prunes nothing when off', () => {
      expect(retentionCutoff(null, november)).toBeNull();
    });
  });
});
