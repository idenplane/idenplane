import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import type { Realm } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateGroupDto } from './dto/create-group.dto.js';
import type { UpdateGroupDto } from './dto/update-group.dto.js';

@Injectable()
export class GroupsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(realm: Realm, dto: CreateGroupDto) {
    const existing = await this.prisma.group.findFirst({
      where: { realmId: realm.id, name: dto.name },
    });
    if (existing) {
      throw new ConflictException(`Group "${dto.name}" already exists`);
    }

    if (dto.parentId) {
      const parent = await this.prisma.group.findFirst({
        where: { id: dto.parentId, realmId: realm.id },
      });
      if (!parent) {
        throw new NotFoundException('Parent group not found');
      }
    }

    return this.prisma.group.create({
      data: {
        realmId: realm.id,
        name: dto.name,
        description: dto.description,
        parentId: dto.parentId,
      },
    });
  }

  async findAll(realm: Realm) {
    return this.prisma.group.findMany({
      where: { realmId: realm.id },
      include: {
        _count: { select: { userGroups: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async findById(realm: Realm, groupId: string) {
    const group = await this.prisma.group.findFirst({
      where: { id: groupId, realmId: realm.id },
      include: {
        children: { orderBy: { name: 'asc' } },
        _count: { select: { userGroups: true, groupRoles: true } },
      },
    });
    if (!group) throw new NotFoundException('Group not found');
    return group;
  }

  async update(realm: Realm, groupId: string, dto: UpdateGroupDto) {
    const group = await this.prisma.group.findFirst({
      where: { id: groupId, realmId: realm.id },
    });
    if (!group) throw new NotFoundException('Group not found');

    if (dto.parentId === groupId) {
      throw new ConflictException('A group cannot be its own parent');
    }

    return this.prisma.group.update({
      where: { id: groupId },
      data: {
        name: dto.name,
        description: dto.description,
        parentId: dto.parentId,
      },
    });
  }

  async delete(realm: Realm, groupId: string) {
    const group = await this.prisma.group.findFirst({
      where: { id: groupId, realmId: realm.id },
    });
    if (!group) throw new NotFoundException('Group not found');

    await this.prisma.group.delete({ where: { id: groupId } });
  }

  // ─── Membership ──────────────────────────────

  async getMembers(realm: Realm, groupId: string) {
    const group = await this.prisma.group.findFirst({
      where: { id: groupId, realmId: realm.id },
    });
    if (!group) throw new NotFoundException('Group not found');

    const memberships = await this.prisma.userGroup.findMany({
      where: { groupId },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            email: true,
            emailVerified: true,
            firstName: true,
            lastName: true,
            enabled: true,
            createdAt: true,
          },
        },
      },
      orderBy: { user: { username: 'asc' } },
    });

    return memberships.map((m) => m.user);
  }

  async addUserToGroup(realm: Realm, userId: string, groupId: string) {
    const [user, group] = await Promise.all([
      this.prisma.user.findFirst({ where: { id: userId, realmId: realm.id } }),
      this.prisma.group.findFirst({
        where: { id: groupId, realmId: realm.id },
      }),
    ]);
    if (!user) throw new NotFoundException('User not found');
    if (!group) throw new NotFoundException('Group not found');

    await this.prisma.userGroup.upsert({
      where: { userId_groupId: { userId, groupId } },
      create: { userId, groupId },
      update: {},
    });
  }

  async removeUserFromGroup(realm: Realm, userId: string, groupId: string) {
    await this.prisma.userGroup.deleteMany({
      where: { userId, groupId },
    });
  }

  async getUserGroups(realm: Realm, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, realmId: realm.id },
    });
    if (!user) throw new NotFoundException('User not found');

    const memberships = await this.prisma.userGroup.findMany({
      where: { userId },
      include: { group: true },
      orderBy: { group: { name: 'asc' } },
    });

    return memberships.map((m) => m.group);
  }

  // ─── Group Role Mappings ─────────────────────

  async getGroupRoles(realm: Realm, groupId: string) {
    const group = await this.prisma.group.findFirst({
      where: { id: groupId, realmId: realm.id },
    });
    if (!group) throw new NotFoundException('Group not found');

    const mappings = await this.prisma.groupRole.findMany({
      where: { groupId },
      include: { role: true },
      orderBy: { role: { name: 'asc' } },
    });

    return mappings.map((m) => m.role);
  }

  async assignRolesToGroup(realm: Realm, groupId: string, roleNames: string[]) {
    const group = await this.prisma.group.findFirst({
      where: { id: groupId, realmId: realm.id },
    });
    if (!group) throw new NotFoundException('Group not found');

    const roles = await this.prisma.role.findMany({
      where: { realmId: realm.id, clientId: null, name: { in: roleNames } },
    });

    const foundNames = roles.map((r) => r.name);
    const missing = roleNames.filter((n) => !foundNames.includes(n));
    if (missing.length > 0) {
      throw new NotFoundException(`Roles not found: ${missing.join(', ')}`);
    }

    await this.prisma.groupRole.createMany({
      data: roles.map((role) => ({ groupId, roleId: role.id })),
      skipDuplicates: true,
    });

    return { assigned: foundNames };
  }

  async removeRolesFromGroup(
    realm: Realm,
    groupId: string,
    roleNames: string[],
  ) {
    const roles = await this.prisma.role.findMany({
      where: { realmId: realm.id, clientId: null, name: { in: roleNames } },
    });

    const roleIds = roles.map((r) => r.id);

    await this.prisma.groupRole.deleteMany({
      where: { groupId, roleId: { in: roleIds } },
    });
  }

  /**
   * Get all roles a user inherits via groups (including ancestor groups).
   */
  async getUserGroupRoles(userId: string) {
    // Get all groups the user belongs to
    const memberships = await this.prisma.userGroup.findMany({
      where: { userId },
      include: { group: true },
    });

    // Collect roles from all groups and their ancestors
    const allRoles: Array<{
      id: string;
      name: string;
      clientId: string | null;
      client?: { clientId: string } | null;
    }> = [];
    const visitedGroupIds = new Set<string>();

    for (const membership of memberships) {
      await this.collectGroupRoles(
        membership.groupId,
        allRoles,
        visitedGroupIds,
      );
    }

    return allRoles;
  }

  private async collectGroupRoles(
    groupId: string,
    allRoles: Array<{
      id: string;
      name: string;
      clientId: string | null;
      client?: { clientId: string } | null;
    }>,
    visited: Set<string>,
  ) {
    if (visited.has(groupId)) return;
    visited.add(groupId);

    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      include: {
        groupRoles: {
          include: { role: { include: { client: true } } },
        },
      },
    });

    if (!group) return;

    for (const gr of group.groupRoles) {
      allRoles.push(gr.role);
    }

    // Walk up to parent
    if (group.parentId) {
      await this.collectGroupRoles(group.parentId, allRoles, visited);
    }
  }
}
