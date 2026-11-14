import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { EventsService } from '../events/events.service.js';
import { OperationType, ResourceType } from '../events/event-types.js';
import {
  ADMIN_ROLES,
  isAdminRole,
  MASTER_REALM,
  REALM_ADMIN,
  type AdminRole,
} from './admin-access-policy.js';

export interface AdminAccountView {
  id: string;
  username: string;
  email: string | null;
  enabled: boolean;
  roles: AdminRole[];
  /** Realms managed as a realm-admin, by name. */
  realms: string[];
}

/**
 * The admin accounts of the master realm and the realms each `realm-admin`
 * manages. Super-admin only (the controller is server-wide).
 */
@Injectable()
export class AdminRealmAssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  private async masterRealmId(): Promise<string> {
    const master = await this.prisma.realm.findUnique({
      where: { name: MASTER_REALM },
      select: { id: true },
    });
    if (!master) throw new NotFoundException('Admin system not initialized');
    return master.id;
  }

  /** Every master realm user that holds at least one admin role. */
  async listAdmins(): Promise<AdminAccountView[]> {
    const masterId = await this.masterRealmId();
    const users = await this.prisma.user.findMany({
      where: {
        realmId: masterId,
        userRoles: {
          some: {
            role: {
              realmId: masterId,
              clientId: null,
              name: { in: [...ADMIN_ROLES] },
            },
          },
        },
      },
      select: {
        id: true,
        username: true,
        email: true,
        enabled: true,
        userRoles: {
          select: {
            role: { select: { name: true, realmId: true, clientId: true } },
          },
        },
        adminRealmAssignments: {
          select: { realm: { select: { name: true } } },
        },
      },
      orderBy: { username: 'asc' },
    });
    return users.map((u) => ({
      id: u.id,
      username: u.username,
      email: u.email,
      enabled: u.enabled,
      roles: u.userRoles
        .map((ur) => ur.role)
        .filter((r) => r.realmId === masterId && r.clientId === null)
        .map((r) => r.name)
        .filter(isAdminRole),
      realms: u.adminRealmAssignments
        .map((a) => a.realm.name)
        .filter((n) => n !== MASTER_REALM)
        .sort(),
    }));
  }

  private async requireAdmin(userId: string): Promise<AdminAccountView> {
    const admin = (await this.listAdmins()).find((a) => a.id === userId);
    if (!admin) throw new NotFoundException('Admin account not found');
    return admin;
  }

  async getRealms(userId: string): Promise<{ realms: string[] }> {
    const admin = await this.requireAdmin(userId);
    return { realms: admin.realms };
  }

  /**
   * Replaces the realms a realm-admin manages. Refuses an admin without the
   * `realm-admin` role, the master realm, and unknown realms; nothing is
   * changed unless every name is valid.
   */
  async setRealms(
    userId: string,
    realmNames: string[],
    actor: { userId: string; ipAddress?: string },
  ): Promise<{ realms: string[] }> {
    const admin = await this.requireAdmin(userId);
    if (!admin.roles.includes(REALM_ADMIN)) {
      throw new ConflictException(
        'Only an admin with the realm-admin role can be assigned realms',
      );
    }
    const names = [...new Set(realmNames)];
    if (names.includes(MASTER_REALM)) {
      throw new BadRequestException(
        'The master realm cannot be assigned to a realm-admin',
      );
    }
    const realms = await this.prisma.realm.findMany({
      where: { name: { in: names } },
      select: { id: true, name: true },
    });
    if (realms.length !== names.length) {
      const known = new Set(realms.map((r) => r.name));
      const unknown = names.filter((n) => !known.has(n));
      throw new BadRequestException(`Unknown realm(s): ${unknown.join(', ')}`);
    }

    const ids = realms.map((r) => r.id);
    await this.prisma.$transaction([
      this.prisma.adminRealmAssignment.deleteMany({
        where: { userId, realmId: { notIn: ids } },
      }),
      this.prisma.adminRealmAssignment.createMany({
        data: ids.map((realmId) => ({
          userId,
          realmId,
          createdBy: actor.userId,
        })),
        skipDuplicates: true,
      }),
    ]);

    const masterId = await this.masterRealmId();
    void this.events
      .recordAdminEvent({
        realmId: masterId,
        adminUserId: actor.userId,
        operationType: OperationType.UPDATE,
        resourceType: ResourceType.ADMIN_REALM_ASSIGNMENT,
        resourcePath: `admin-accounts/${userId}/realms`,
        representation: { realms: names.sort() },
        ipAddress: actor.ipAddress,
      })
      .catch(() => undefined);

    return this.getRealms(userId);
  }
}
