import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { Realm } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { ClientsService } from '../clients/clients.service.js';

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clientsService: ClientsService,
  ) {}

  // ─── Realm Roles ────────────────────────────────────────

  async createRealmRole(realm: Realm, name: string, description?: string) {
    const existing = await this.prisma.role.findFirst({
      where: { realmId: realm.id, clientId: null, name },
    });
    if (existing) {
      throw new ConflictException(`Role '${name}' already exists`);
    }

    return this.prisma.role.create({
      data: { realmId: realm.id, name, description },
    });
  }

  async findRealmRoles(realm: Realm) {
    return this.prisma.role.findMany({
      where: { realmId: realm.id, clientId: null },
      orderBy: { name: 'asc' },
    });
  }

  async findByName(realm: Realm, roleName: string) {
    const role = await this.prisma.role.findFirst({
      where: { realmId: realm.id, clientId: null, name: roleName },
    });
    if (!role) {
      throw new NotFoundException(`Role '${roleName}' not found`);
    }
    return role;
  }

  async updateRealmRole(
    realm: Realm,
    roleName: string,
    data: { name?: string; description?: string },
  ) {
    const role = await this.prisma.role.findFirst({
      where: { realmId: realm.id, clientId: null, name: roleName },
    });
    if (!role) {
      throw new NotFoundException(`Role '${roleName}' not found`);
    }

    if (data.name && data.name !== roleName) {
      const existing = await this.prisma.role.findFirst({
        where: { realmId: realm.id, clientId: null, name: data.name },
      });
      if (existing) {
        throw new ConflictException(`Role '${data.name}' already exists`);
      }
    }

    return this.prisma.role.update({
      where: { id: role.id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && {
          description: data.description,
        }),
      },
    });
  }

  async deleteRealmRole(realm: Realm, roleName: string) {
    const role = await this.prisma.role.findFirst({
      where: { realmId: realm.id, clientId: null, name: roleName },
    });
    if (!role) {
      throw new NotFoundException(`Role '${roleName}' not found`);
    }
    await this.prisma.role.delete({ where: { id: role.id } });
  }

  // ─── Client Roles ──────────────────────────────────────

  // The `:clientId` URL param accepts either the human client_id string or
  // the row UUID — same shape as `/admin/realms/:r/clients/:id` CRUD. Route
  // through ClientsService.findByClientId so both forms work; previously the
  // raw param went into `realmId_clientId` which only matched the string.

  async createClientRole(
    realm: Realm,
    clientIdOrUuid: string,
    name: string,
    description?: string,
  ) {
    const client = await this.clientsService.findByClientId(
      realm,
      clientIdOrUuid,
    );
    return this.prisma.role.create({
      data: { realmId: realm.id, clientId: client.id, name, description },
    });
  }

  async findClientRoles(realm: Realm, clientIdOrUuid: string) {
    const client = await this.clientsService.findByClientId(
      realm,
      clientIdOrUuid,
    );
    return this.prisma.role.findMany({
      where: { realmId: realm.id, clientId: client.id },
      orderBy: { name: 'asc' },
    });
  }

  // ─── Role Assignment ───────────────────────────────────

  async assignRealmRoles(realm: Realm, userId: string, roleNames: string[]) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, realmId: realm.id },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const roles = await this.prisma.role.findMany({
      where: { realmId: realm.id, clientId: null, name: { in: roleNames } },
    });

    const foundNames = roles.map((r) => r.name);
    const missing = roleNames.filter((n) => !foundNames.includes(n));
    if (missing.length > 0) {
      throw new NotFoundException(`Roles not found: ${missing.join(', ')}`);
    }

    await this.prisma.userRole.createMany({
      data: roles.map((role) => ({ userId, roleId: role.id })),
      skipDuplicates: true,
    });

    return { assigned: foundNames };
  }

  async getUserRealmRoles(realm: Realm, userId: string) {
    return this.prisma.role.findMany({
      where: {
        realmId: realm.id,
        clientId: null,
        userRoles: { some: { userId } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async removeUserRealmRoles(
    realm: Realm,
    userId: string,
    roleNames: string[],
  ) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, realmId: realm.id },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const roles = await this.prisma.role.findMany({
      where: { realmId: realm.id, clientId: null, name: { in: roleNames } },
    });

    await this.prisma.userRole.deleteMany({
      where: {
        userId,
        roleId: { in: roles.map((r) => r.id) },
      },
    });

    return { removed: roleNames };
  }

  // ─── Client Role Assignment ─────────────────────────────

  async assignClientRoles(
    realm: Realm,
    userId: string,
    clientIdOrUuid: string,
    roleNames: string[],
  ) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, realmId: realm.id },
    });
    if (!user) {
      throw new NotFoundException(`User '${userId}' not found`);
    }

    const client = await this.clientsService.findByClientId(
      realm,
      clientIdOrUuid,
    );

    const roles = await this.prisma.role.findMany({
      where: {
        realmId: realm.id,
        clientId: client.id,
        name: { in: roleNames },
      },
    });

    await this.prisma.userRole.createMany({
      data: roles.map((role) => ({ userId, roleId: role.id })),
      skipDuplicates: true,
    });

    return { assigned: roles.map((r) => r.name) };
  }

  async removeUserClientRoles(
    realm: Realm,
    userId: string,
    clientIdOrUuid: string,
    roleNames: string[],
  ) {
    const client = await this.clientsService.findByClientId(
      realm,
      clientIdOrUuid,
    );

    const user = await this.prisma.user.findFirst({
      where: { id: userId, realmId: realm.id },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const roles = await this.prisma.role.findMany({
      where: {
        realmId: realm.id,
        clientId: client.id,
        name: { in: roleNames },
      },
    });

    await this.prisma.userRole.deleteMany({
      where: {
        userId,
        roleId: { in: roles.map((r) => r.id) },
      },
    });

    return { removed: roleNames };
  }

  async getUserClientRoles(
    realm: Realm,
    userId: string,
    clientIdOrUuid: string,
  ) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, realmId: realm.id },
    });
    if (!user) {
      throw new NotFoundException(`User '${userId}' not found`);
    }

    const client = await this.clientsService.findByClientId(
      realm,
      clientIdOrUuid,
    );

    return this.prisma.role.findMany({
      where: {
        realmId: realm.id,
        clientId: client.id,
        userRoles: { some: { userId } },
      },
      orderBy: { name: 'asc' },
    });
  }
}
