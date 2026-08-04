/**
 * This service provides statistical data for different realms.
 * It includes metrics like active users, login attempts, and session counts.
 */
import { Injectable } from '@nestjs/common';
import type { Realm } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export interface RealmStats {
  activeUsers24h: number;
  activeUsers7d: number;
  activeUsers30d: number;
  loginSuccessCount: number;
  loginFailureCount: number;
  activeSessionCount: number;
}

export interface FailedLoginHeatmap {
  windowDays: number;
  totalFailures: number;
  /**
   * 7x24 grid of failed-login counts: heatmap[dayOfWeek][hour].
   * dayOfWeek 0 = Sunday. Bucketed in UTC, independent of server timezone.
   */
  heatmap: number[][];
}

const HEATMAP_WINDOW_DAYS = 30;

const LOGIN_SUCCESS_TYPES = [
  'LOGIN',
  'TOKEN_REFRESH',
  'CODE_TO_TOKEN',
  'CLIENT_LOGIN',
  'LOGOUT',
  'MFA_VERIFY',
  'DEVICE_CODE_TO_TOKEN',
  'FEDERATED_LOGIN',
  'REGISTER',
];

const LOGIN_FAILURE_TYPES = [
  'LOGIN_ERROR',
  'TOKEN_REFRESH_ERROR',
  'MFA_VERIFY_ERROR',
  'CODE_TO_TOKEN_ERROR',
  'CLIENT_LOGIN_ERROR',
];

@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  async getRealmStats(realm: Realm): Promise<RealmStats> {
    const now = new Date();

    const cutoff24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const cutoff7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const cutoff30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      activeUsers24h,
      activeUsers7d,
      activeUsers30d,
      loginSuccessCount,
      loginFailureCount,
      oauthSessionCount,
      ssoSessionCount,
    ] = await Promise.all([
      // Distinct users who had a successful LOGIN event in the last 24 h
      this.prisma.loginEvent
        .groupBy({
          by: ['userId'],
          where: {
            realmId: realm.id,
            type: 'LOGIN',
            userId: { not: null },
            createdAt: { gte: cutoff24h },
          },
        })
        .then((rows) => rows.length),

      this.prisma.loginEvent
        .groupBy({
          by: ['userId'],
          where: {
            realmId: realm.id,
            type: 'LOGIN',
            userId: { not: null },
            createdAt: { gte: cutoff7d },
          },
        })
        .then((rows) => rows.length),

      this.prisma.loginEvent
        .groupBy({
          by: ['userId'],
          where: {
            realmId: realm.id,
            type: 'LOGIN',
            userId: { not: null },
            createdAt: { gte: cutoff30d },
          },
        })
        .then((rows) => rows.length),

      // Login success events in the last 24 h
      this.prisma.loginEvent.count({
        where: {
          realmId: realm.id,
          type: { in: LOGIN_SUCCESS_TYPES },
          createdAt: { gte: cutoff24h },
        },
      }),

      // Login failure events in the last 24 h
      this.prisma.loginEvent.count({
        where: {
          realmId: realm.id,
          type: { in: LOGIN_FAILURE_TYPES },
          createdAt: { gte: cutoff24h },
        },
      }),

      // Active OAuth sessions
      this.prisma.session.count({
        where: {
          user: { realmId: realm.id },
          expiresAt: { gt: now },
        },
      }),

      // Active SSO (login) sessions
      this.prisma.loginSession.count({
        where: {
          realmId: realm.id,
          expiresAt: { gt: now },
        },
      }),
    ]);

    return {
      activeUsers24h,
      activeUsers7d,
      activeUsers30d,
      loginSuccessCount,
      loginFailureCount,
      activeSessionCount: oauthSessionCount + ssoSessionCount,
    };
  }

  /**
   * Buckets failed-login events into a 7 (day-of-week) x 24 (hour) grid over
   * the last HEATMAP_WINDOW_DAYS, for the "when do failed logins happen"
   * dashboard chart.
   */
  async getFailedLoginHeatmap(realm: Realm): Promise<FailedLoginHeatmap> {
    const cutoff = new Date(
      Date.now() - HEATMAP_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );

    const events = await this.prisma.loginEvent.findMany({
      where: {
        realmId: realm.id,
        type: { in: LOGIN_FAILURE_TYPES },
        createdAt: { gte: cutoff },
      },
      select: { createdAt: true },
    });

    const heatmap: number[][] = Array.from({ length: 7 }, () =>
      new Array<number>(24).fill(0),
    );

    for (const event of events) {
      const day = event.createdAt.getUTCDay();
      const hour = event.createdAt.getUTCHours();
      heatmap[day][hour]++;
    }

    return {
      windowDays: HEATMAP_WINDOW_DAYS,
      totalFailures: events.length,
      heatmap,
    };
  }
}
