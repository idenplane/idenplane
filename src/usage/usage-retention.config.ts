/**
 * How long monthly activity (`user_monthly_activity`) is kept:
 * USAGE_ACTIVITY_RETENTION_MONTHS.
 *
 * `N` keeps the current month and the N whole months before it; older
 * months are deleted. The default, 13, keeps the last closed month together
 * with the same month a year earlier (a year-over-year comparison), and
 * every closed month for over a year for billing questions. `off` keeps
 * every month. The minimum, 1, still keeps the previous month for a whole
 * month after it closes: neither the current nor the previous month can
 * ever be pruned.
 *
 * Anything else stops the server at startup (validateUsageRetentionConfig in
 * main.ts): a typo must not silently delete billing data, nor keep user ids
 * the operator meant to delete.
 */

export const USAGE_RETENTION_ENV = 'USAGE_ACTIVITY_RETENTION_MONTHS';
export const DEFAULT_USAGE_RETENTION_MONTHS = 13;
/** Keeps the previous month: it is never pruned. */
export const MIN_USAGE_RETENTION_MONTHS = 1;
/** A hundred years: anything above is a mistake, not a policy. */
export const MAX_USAGE_RETENTION_MONTHS = 1200;

export class UsageRetentionConfigError extends Error {}

/** Whole months kept before the current one, or null for no pruning. */
export type UsageRetentionMonths = number | null;

export function loadUsageRetention(
  env: Record<string, string | undefined> = process.env,
): UsageRetentionMonths {
  const raw = env[USAGE_RETENTION_ENV]?.trim();
  if (raw === undefined || raw === '') return DEFAULT_USAGE_RETENTION_MONTHS;
  if (raw.toLowerCase() === 'off') return null;
  if (!/^\d+$/.test(raw)) {
    throw new UsageRetentionConfigError(
      `${USAGE_RETENTION_ENV} must be a whole number of months (${MIN_USAGE_RETENTION_MONTHS} to ${MAX_USAGE_RETENTION_MONTHS}) or "off", not ${JSON.stringify(raw)}`,
    );
  }
  const months = Number(raw);
  if (
    months < MIN_USAGE_RETENTION_MONTHS ||
    months > MAX_USAGE_RETENTION_MONTHS
  ) {
    throw new UsageRetentionConfigError(
      `${USAGE_RETENTION_ENV} must be between ${MIN_USAGE_RETENTION_MONTHS} and ${MAX_USAGE_RETENTION_MONTHS} months, or "off" (it can never prune the current or the previous month), not ${months}`,
    );
  }
  return months;
}

/**
 * The first month kept, for a retention and the current month's start:
 * every month before it is pruned. Null when nothing is pruned.
 */
export function retentionCutoff(
  months: UsageRetentionMonths,
  currentMonthStart: Date,
): Date | null {
  if (months === null) return null;
  return new Date(
    Date.UTC(
      currentMonthStart.getUTCFullYear(),
      currentMonthStart.getUTCMonth() - months,
      1,
    ),
  );
}
