/**
 * Calendar months in UTC, the unit instance usage is counted in.
 *
 * A month is written `YYYY-MM` and stored as the date of its first day
 * (`user_monthly_activity.month`, a PostgreSQL `date`). Boundaries are
 * computed here, in UTC, so the server's time zone never shifts a month.
 */

/** `YYYY-MM`, months 01 to 12. */
export const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface UsagePeriod {
  /** `YYYY-MM`. */
  month: string;
  /** First instant of the month, UTC (inclusive). */
  start: Date;
  /** First instant of the next month, UTC (exclusive). */
  end: Date;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** The UTC month `at` falls in. */
export function monthOf(at: Date): UsagePeriod {
  const year = at.getUTCFullYear();
  const monthIndex = at.getUTCMonth();
  return {
    month: `${year}-${pad2(monthIndex + 1)}`,
    start: new Date(Date.UTC(year, monthIndex, 1)),
    end: new Date(Date.UTC(year, monthIndex + 1, 1)),
  };
}

/**
 * The period of a `YYYY-MM` string. Throws on anything else: callers
 * validate first (the DTO does), so a bad value here is a programming error.
 */
export function parseMonth(month: string): UsagePeriod {
  if (!MONTH_PATTERN.test(month)) {
    throw new Error(`Not a YYYY-MM month: ${JSON.stringify(month)}`);
  }
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7)) - 1;
  return monthOf(new Date(Date.UTC(year, monthIndex, 1)));
}
