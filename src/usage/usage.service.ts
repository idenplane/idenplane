import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { APP_VERSION } from '../versioning/app-version.js';
import { monthOf, parseMonth } from './usage-period.js';

export interface RealmUsage {
  /** The realm id. Activity outlives a deleted realm, so it may be gone. */
  id: string;
  /** Null for a deleted realm. */
  name: string | null;
  /** The realm no longer exists; its activity in the month still counts. */
  deleted: boolean;
  /** User accounts now (service accounts excluded); 0 for a deleted realm. */
  users: number;
  /** Distinct users who authenticated in the month. */
  monthlyActiveUsers: number;
}

export interface InstanceUsage {
  /** The server version (package.json). */
  version: string;
  /** When this report was computed, ISO 8601. */
  generatedAt: string;
  period: {
    /** YYYY-MM, UTC. */
    month: string;
    /** First instant of the month, inclusive. */
    start: string;
    /** First instant of the next month, exclusive. */
    end: string;
    /** The month is over: its count can no longer change. */
    closed: boolean;
    /**
     * Activity was recorded for the whole month. False for a month that
     * starts before recording did (`tracking.since`): its count is a
     * lower bound, backfilled from the login events still retained.
     */
    complete: boolean;
  };
  tracking: {
    /** When this instance started recording activity; null if unknown. */
    since: string | null;
  };
  totals: {
    /** Realms that exist now. */
    realms: number;
    /** User accounts now, across all realms (service accounts excluded). */
    users: number;
    /** Distinct users who authenticated in the month, across all realms. */
    monthlyActiveUsers: number;
  };
  /** Existing realms by name, then deleted realms with activity in the month. */
  realms: RealmUsage[];
}

/**
 * Instance-wide usage for GET /admin/system/usage: monthly active users
 * from `user_monthly_activity` (see UsageActivityRecorder for what counts),
 * and user and realm totals. Four queries, none of them over login events:
 * the month's activity is read through its primary key.
 */
@Injectable()
export class UsageService {
  constructor(private readonly prisma: PrismaService) {}

  async getUsage(month?: string, now = new Date()): Promise<InstanceUsage> {
    const current = monthOf(now);
    const period = month ? parseMonth(month) : current;
    if (period.start.getTime() > current.start.getTime()) {
      throw new BadRequestException(
        `month ${period.month} is in the future (the current month is ${current.month})`,
      );
    }

    const [realms, users, active, tracking] = await Promise.all([
      this.prisma.realm.findMany({
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      // Service accounts are user rows too (client_credentials); they are
      // not people and never count as active, so they are left out here.
      this.prisma.$queryRaw<Array<{ realmId: string; users: number }>>`
        SELECT u."realm_id" AS "realmId", count(*)::int AS "users"
        FROM "users" u
        WHERE NOT EXISTS (
          SELECT 1 FROM "clients" c WHERE c."service_account_user_id" = u."id"
        )
        GROUP BY u."realm_id"`,
      this.prisma.userMonthlyActivity.groupBy({
        by: ['realmId'],
        where: { month: period.start },
        _count: { _all: true },
      }),
      this.prisma.usageTracking.findUnique({
        where: { id: 1 },
        select: { trackingSince: true },
      }),
    ]);

    const usersByRealm = new Map(
      users.map((r) => [r.realmId, Number(r.users)]),
    );
    const activeByRealm = new Map(
      active.map((r) => [r.realmId, r._count._all]),
    );

    const rows: RealmUsage[] = realms.map((realm) => ({
      id: realm.id,
      name: realm.name,
      deleted: false,
      users: usersByRealm.get(realm.id) ?? 0,
      monthlyActiveUsers: activeByRealm.get(realm.id) ?? 0,
    }));
    const existing = new Set(realms.map((r) => r.id));
    const deleted = [...activeByRealm.keys()]
      .filter((id) => !existing.has(id))
      .sort()
      .map((id) => ({
        id,
        name: null,
        deleted: true,
        users: 0,
        monthlyActiveUsers: activeByRealm.get(id) ?? 0,
      }));
    rows.push(...deleted);

    const since = tracking?.trackingSince ?? null;
    return {
      version: APP_VERSION,
      generatedAt: now.toISOString(),
      period: {
        month: period.month,
        start: period.start.toISOString(),
        end: period.end.toISOString(),
        closed: period.end.getTime() <= now.getTime(),
        complete: since !== null && since.getTime() <= period.start.getTime(),
      },
      tracking: { since: since ? since.toISOString() : null },
      totals: {
        realms: realms.length,
        users: rows.reduce((sum, r) => sum + r.users, 0),
        monthlyActiveUsers: rows.reduce(
          (sum, r) => sum + r.monthlyActiveUsers,
          0,
        ),
      },
      realms: rows,
    };
  }
}
