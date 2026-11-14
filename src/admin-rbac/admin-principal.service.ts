import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AdminRealmLookup } from '../common/decorators/admin-access.decorator.js';
import {
  isAdminRole,
  MASTER_REALM,
  SUPER_ADMIN,
  type AdminPrincipal,
  type ResolvedRealm,
} from './admin-access-policy.js';

/** What AdminApiKeyGuard put on the request. */
export interface AuthenticatedAdmin {
  userId: string;
  roles: string[];
}

/** The `sub` of the API key and of sessions minted from it. */
export const API_KEY_SUBJECT_PREFIX = 'api-key:';

/**
 * Builds the authorization view of an authenticated admin, from the
 * database, on every request:
 *
 * - The admin API key (and a session minted from it) is a super-admin,
 *   as long as an API key is still configured.
 * - An admin user gets the admin roles it holds *now* (direct master realm
 *   role mappings, as at login) and its realm assignments. Roles taken away
 *   and assignments removed apply to the very next request, not when the
 *   token expires. A disabled or deleted admin gets no role at all.
 */
@Injectable()
export class AdminPrincipalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async load(admin: AuthenticatedAdmin): Promise<AdminPrincipal> {
    if (admin.userId.startsWith(API_KEY_SUBJECT_PREFIX)) {
      const configured = !!this.config.get<string>('ADMIN_API_KEY');
      return {
        kind: 'api-key',
        userId: admin.userId,
        username: null,
        roles: configured ? [SUPER_ADMIN] : [],
        realmIds: new Set(),
      };
    }

    const user = await this.prisma.user.findFirst({
      where: { id: admin.userId, realm: { name: MASTER_REALM } },
      select: {
        id: true,
        username: true,
        enabled: true,
        realmId: true,
        userRoles: {
          select: {
            role: { select: { name: true, realmId: true, clientId: true } },
          },
        },
        adminRealmAssignments: {
          select: { realmId: true, realm: { select: { name: true } } },
        },
      },
    });

    if (!user || !user.enabled) {
      return {
        kind: 'user',
        userId: admin.userId,
        username: user?.username ?? null,
        roles: [],
        realmIds: new Set(),
      };
    }

    const roles = new Set<string>();
    for (const { role } of user.userRoles) {
      // Realm roles of the master realm only, as login reads them.
      if (role.realmId === user.realmId && role.clientId === null) {
        if (isAdminRole(role.name)) roles.add(role.name);
      }
    }

    return {
      kind: 'user',
      userId: user.id,
      username: user.username,
      roles: [...roles].filter(isAdminRole),
      realmIds: new Set(
        user.adminRealmAssignments
          .filter((a) => a.realm.name !== MASTER_REALM)
          .map((a) => a.realmId),
      ),
    };
  }

  /**
   * The realm a route parameter names, read the way its handler reads it.
   * `{ id: null }` when there is no such realm.
   */
  async resolveRealm(
    value: string,
    lookup: AdminRealmLookup,
  ): Promise<ResolvedRealm> {
    if (lookup === 'id-or-name') {
      const byId = await this.prisma.realm.findUnique({
        where: { id: value },
        select: { id: true, name: true },
      });
      if (byId) return byId;
    }
    const byName = await this.prisma.realm.findUnique({
      where: { name: value },
      select: { id: true, name: true },
    });
    return byName ?? { id: null, name: null };
  }

  /** Realm names for ids, for the who-am-I answer. */
  async realmNames(ids: Iterable<string>): Promise<string[]> {
    const list = [...ids];
    if (list.length === 0) return [];
    const realms = await this.prisma.realm.findMany({
      where: { id: { in: list } },
      select: { name: true },
      orderBy: { name: 'asc' },
    });
    return realms.map((r) => r.name);
  }
}
