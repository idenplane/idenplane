import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { Realm } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

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

  async createClientRole(
    realm: Realm,
    clientId: string,
    name: string,
    description?: string,
  ) {
    const client = await this.prisma.client.findUnique({
      where: { realmId_clientId: { realmId: realm.id, clientId } },
    });
    if (!client) {
      throw new NotFoundException(`Client '${clientId}' not found`);
    }

    return this.prisma.role.create({
      data: { realmId: realm.id, clientId: client.id, name, description },
    });
  }

  async findClientRoles(realm: Realm, clientId: string) {
    const client = await this.prisma.client.findUnique({
      where: { realmId_clientId: { realmId: realm.id, clientId } },
    });
    if (!client) {
      throw new NotFoundException(`Client '${clientId}' not found`);
    }

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
    clientId: string,
    roleNames: string[],
  ) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, realmId: realm.id },
    });
    if (!user) {
      throw new NotFoundException(`User '${userId}' not found`);
    }

    const client = await this.prisma.client.findUnique({
      where: { realmId_clientId: { realmId: realm.id, clientId } },
    });
    if (!client) {
      throw new NotFoundException(`Client '${clientId}' not found`);
    }

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
    clientId: string,
    roleNames: string[],
  ) {
    const client = await this.prisma.client.findUnique({
      where: { realmId_clientId: { realmId: realm.id, clientId } },
    });
    if (!client) {
      throw new NotFoundException(`Client '${clientId}' not found`);
    }

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

  async getUserClientRoles(realm: Realm, userId: string, clientId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, realmId: realm.id },
    });
    if (!user) {
      throw new NotFoundException(`User '${userId}' not found`);
    }

    const client = await this.prisma.client.findUnique({
      where: { realmId_clientId: { realmId: realm.id, clientId } },
    });
    if (!client) {
      throw new NotFoundException(`Client '${clientId}' not found`);
    }

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
