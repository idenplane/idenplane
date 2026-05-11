/**
 * SCIM Groups Service
 * Implements RFC 7644 Section 3.3 - Group Operations
 */

import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { EventsService } from '../events/events.service.js';
import { ScimFilterParserService } from './filter-parser.service.js';
import type {
  ScimGroup,
  ScimListResponse,
  ScimMember,
  ScimPatchOperation,
} from './types/scim.types.js';

@Injectable()
export class ScimGroupsService {
  private readonly logger = new Logger(ScimGroupsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsService: EventsService,
    private readonly filterParser: ScimFilterParserService,
  ) {}

  /**
   * Create a new group (SCIM POST /Groups)
   * RFC 7644 Section 3.3
   */
  async create(realmId: string, scimGroup: ScimGroup): Promise<ScimGroup> {
    const name = scimGroup.displayName;

    // Check for existing group
    const existing = await this.prisma.group.findFirst({
      where: { realmId, name },
    });
    if (existing) {
      throw new ConflictException(`Group '${name}' already exists`);
    }

    // Create group in database
    const group = await this.prisma.group.create({
      data: {
        realmId,
        name,
        description: scimGroup.displayName,
      },
    });

    // Add members if provided
    if (scimGroup.members && scimGroup.members.length > 0) {
      await this.addMembers(realmId, group.id, scimGroup.members);
    }

    // Log SCIM provisioning event
    await this.eventsService.recordAdminEvent({
      realmId,
      adminUserId: 'scim',
      operationType: 'CREATE',
      resourceType: 'GROUP',
      resourcePath: `/scim/v2/Groups/${group.id}`,
      representation: { scimGroup },
    });

    this.logger.log(`SCIM: Created group ${group.id} in realm ${realmId}`);

    return this.toScimGroup(group);
  }

  /**
   * Get a group by ID (SCIM GET /Groups/{id})
   * RFC 7644 Section 3.3
   */
  async findById(realmId: string, groupId: string): Promise<ScimGroup> {
    const group = await this.prisma.group.findFirst({
      where: { id: groupId, realmId },
      include: {
        userGroups: {
          include: { user: true },
        },
      },
    });

    if (!group) {
      throw new NotFoundException(`Group '${groupId}' not found`);
    }

    return this.toScimGroup(group);
  }

  /**
   * Get all groups with pagination and filtering (SCIM GET /Groups)
   * RFC 7644 Section 3.3
   */
  async findAll(
    realmId: string,
    options: {
      startIndex?: number;
      count?: number;
      filter?: string;
      attributes?: string[];
      excludedAttributes?: string[];
    } = {},
  ): Promise<ScimListResponse<ScimGroup>> {
    const {
      startIndex = 1,
      count = 100,
      filter,
    } = options;

    // Build where clause
    let where: Record<string, unknown> = { realmId };

    if (filter) {
      try {
        where = { ...where, ...this.filterParser.toPrismaWhereGroup(filter, realmId) };
      } catch {
        // Ignore invalid filter - return empty result
        return this.emptyListResponse(startIndex, count);
      }
    }

    // Get total count
    const totalResults = await this.prisma.group.count({ where });

    // Get groups with pagination
    const groups = await this.prisma.group.findMany({
      where,
      include: {
        userGroups: {
          include: { user: true },
        },
      },
      skip: Math.max(0, startIndex - 1),
      take: Math.min(count, 100),
      orderBy: { name: 'asc' },
    });

    return {
      schemas: ['urn:scim:schemas:core:1.0:ListResponse'],
      totalResults,
      startIndex,
      itemsPerPage: groups.length,
      Resources: groups.map(g => this.toScimGroup(g)),
    };
  }

  /**
   * Update a group (SCIM PUT /Groups/{id})
   * RFC 7644 Section 3.3
   */
  async update(realmId: string, groupId: string, scimGroup: ScimGroup): Promise<ScimGroup> {
    const existing = await this.prisma.group.findFirst({
      where: { id: groupId, realmId },
      include: {
        userGroups: {
          include: { user: true },
        },
      },
    });

    if (!existing) {
      throw new NotFoundException(`Group '${groupId}' not found`);
    }

    // Check for name conflict
    if (scimGroup.displayName !== existing.name) {
      const nameExists = await this.prisma.group.findFirst({
        where: { realmId, name: scimGroup.displayName, NOT: { id: groupId } },
      });
      if (nameExists) {
        throw new ConflictException(`Group name '${scimGroup.displayName}' already exists`);
      }
    }

    const group = await this.prisma.group.update({
      where: { id: groupId },
      data: {
        name: scimGroup.displayName,
        description: scimGroup.displayName,
      },
      include: {
        userGroups: {
          include: { user: true },
        },
      },
    });

    // Update members if provided
    if (scimGroup.members) {
      // Clear existing members and add new ones
      await this.prisma.userGroup.deleteMany({
        where: { groupId },
      });
      await this.addMembers(realmId, groupId, scimGroup.members);
    }

    await this.eventsService.recordAdminEvent({
      realmId,
      adminUserId: 'scim',
      operationType: 'UPDATE',
      resourceType: 'GROUP',
      resourcePath: `/scim/v2/Groups/${groupId}`,
      representation: { scimGroup },
    });

    this.logger.log(`SCIM: Updated group ${groupId} in realm ${realmId}`);

    return this.findById(realmId, groupId);
  }

  /**
   * Patch a group (SCIM PATCH /Groups/{id})
   * RFC 7644 Section 3.6
   */
  async patch(realmId: string, groupId: string, operations: ScimPatchOperation[]): Promise<ScimGroup> {
    const group = await this.prisma.group.findFirst({
      where: { id: groupId, realmId },
    });

    if (!group) {
      throw new NotFoundException(`Group '${groupId}' not found`);
    }

    for (const op of operations) {
      switch (op.op) {
        case 'add':
        case 'replace':
          if (op.path === 'members' && Array.isArray(op.value)) {
            await this.addMembers(realmId, groupId, op.value as ScimMember[]);
          }
          break;
        case 'remove':
          if (op.path) {
            // Parse path to extract member value to remove
            const memberValue = this.extractMemberValueFromPath(op.path);
            if (memberValue) {
              await this.removeMember(realmId, groupId, memberValue);
            }
          }
          break;
      }
    }

    await this.eventsService.recordAdminEvent({
      realmId,
      adminUserId: 'scim',
      operationType: 'PATCH',
      resourceType: 'GROUP',
      resourcePath: `/scim/v2/Groups/${groupId}`,
      representation: { operations },
    });

    this.logger.log(`SCIM: Patched group ${groupId} in realm ${realmId}`);

    return this.findById(realmId, groupId);
  }

  /**
   * Delete a group (SCIM DELETE /Groups/{id})
   * RFC 7644 Section 3.3
   */
  async delete(realmId: string, groupId: string): Promise<void> {
    const group = await this.prisma.group.findFirst({
      where: { id: groupId, realmId },
    });

    if (!group) {
      throw new NotFoundException(`Group '${groupId}' not found`);
    }

    await this.prisma.group.delete({
      where: { id: groupId },
    });

    await this.eventsService.recordAdminEvent({
      realmId,
      adminUserId: 'scim',
      operationType: 'DELETE',
      resourceType: 'GROUP',
      resourcePath: `/scim/v2/Groups/${groupId}`,
      representation: { groupId },
    });

    this.logger.log(`SCIM: Deleted group ${groupId} in realm ${realmId}`);
  }

  /**
   * Search groups using POST /Groups with filter
   * RFC 7644 Section 3.3
   */
  async search(
    realmId: string,
    request: {
      filter?: string;
      attributes?: string[];
      excludedAttributes?: string[];
      startIndex?: number;
      count?: number;
    },
  ): Promise<ScimListResponse<ScimGroup>> {
    return this.findAll(realmId, {
      startIndex: request.startIndex,
      count: request.count,
      filter: request.filter,
      attributes: request.attributes,
      excludedAttributes: request.excludedAttributes,
    });
  }

  /**
   * Add members to a group
   */
  private async addMembers(realmId: string, groupId: string, members: ScimMember[]): Promise<void> {
    for (const member of members) {
      if (!member.value) continue;

      // Validate user exists
      const user = await this.prisma.user.findFirst({
        where: { id: member.value, realmId },
      });

      if (user) {
        await this.prisma.userGroup.upsert({
          where: {
            userId_groupId: { userId: user.id, groupId },
          },
          create: {
            userId: user.id,
            groupId,
          },
          update: {},
        });
      }
    }
  }

  /**
   * Remove a member from a group
   */
  private async removeMember(realmId: string, groupId: string, memberValue: string): Promise<void> {
    await this.prisma.userGroup.deleteMany({
      where: {
        groupId,
        userId: memberValue,
      },
    });
  }

  /**
   * Extract member value from SCIM path (e.g., "members[value eq '123']")
   */
  private extractMemberValueFromPath(path: string): string | null {
    // Handle path like "members[value eq 'user-123']"
    const match = path.match(/members\[value eq '([^']+)'\]$/);
    return match ? match[1] : null;
  }

  /**
   * Convert database group to SCIM Group format
   */
  private toScimGroup(group: any): ScimGroup {
    const scimGroup: ScimGroup = {
      schemas: ['urn:scim:schemas:core:1.0:Group'],
      id: group.id,
      displayName: group.name,
      externalId: group.id,
      meta: {
        resourceType: 'GROUP',
        created: group.createdAt?.toISOString(),
        lastModified: group.updatedAt?.toISOString(),
        location: `/scim/v2/Groups/${group.id}`,
      },
    };

    // Add members if available
    if (group.userGroups && group.userGroups.length > 0) {
      scimGroup.members = group.userGroups.map((ug: any) => ({
        value: ug.user.id,
        display: ug.user.username,
        type: 'User',
      }));
    }

    return scimGroup;
  }

  /**
   * Return empty list response
   */
  private emptyListResponse(startIndex: number, count: number): ScimListResponse<ScimGroup> {
    return {
      schemas: ['urn:scim:schemas:core:1.0:ListResponse'],
      totalResults: 0,
      startIndex,
      itemsPerPage: 0,
      Resources: [],
    };
  }
}