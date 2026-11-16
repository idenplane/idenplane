/**
 * SCIM Groups Service
 * Implements RFC 7644 Section 3.3 - Group Operations
 */

import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { EventsService } from '../events/events.service.js';
import { ScimFilterParserService } from './filter-parser.service.js';
import { planGroupPatch, memberIds } from './group-patch.js';
import { scimBadRequest, scimConflict } from './scim-errors.js';
import { normalizePagination, scimLocation } from './scim-resource.js';
import { SCIM_SCHEMAS } from './types/scim.types.js';
import type {
  ScimGroup,
  ScimListResponse,
  ScimRealmRef,
  NormalizedScimPatchOperation,
} from './types/scim.types.js';

/**
 * Database group with included user relations for SCIM conversion
 */
interface DbGroupWithUserGroups {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  userGroups?: Array<{
    user: {
      id: string;
      username: string;
    };
  }>;
}

const WITH_MEMBERS = {
  userGroups: {
    include: { user: true },
  },
} as const;

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
  async create(realm: ScimRealmRef, scimGroup: ScimGroup): Promise<ScimGroup> {
    const realmId = realm.id;
    const name = requireDisplayName(scimGroup);
    const members =
      scimGroup.members === undefined || scimGroup.members === null
        ? []
        : memberIds(scimGroup.members);

    // Check for existing group
    const existing = await this.prisma.group.findFirst({
      where: { realmId, name },
    });
    if (existing) {
      throw scimConflict(`Group '${name}' already exists`);
    }

    // Create group in database
    const group = await this.prisma.group.create({
      data: {
        realmId,
        name,
        description: name,
      },
    });

    // Add members if provided
    await this.addMembers(realmId, group.id, members);

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

    return this.findById(realm, group.id);
  }

  /**
   * Get a group by ID (SCIM GET /Groups/{id})
   * RFC 7644 Section 3.4.1
   */
  async findById(
    realm: ScimRealmRef,
    groupId: string,
    excludedAttributes?: string[],
  ): Promise<ScimGroup> {
    const group = await this.prisma.group.findFirst({
      where: { id: requireId(groupId), realmId: realm.id },
      include: WITH_MEMBERS,
    });

    if (!group) {
      throw new NotFoundException(`Group '${groupId}' not found`);
    }

    return this.toScimGroup(group, realm, excludedAttributes);
  }

  /**
   * Get all groups with pagination and filtering (SCIM GET /Groups)
   * RFC 7644 Section 3.4.2
   */
  async findAll(
    realm: ScimRealmRef,
    options: {
      startIndex?: number;
      count?: number;
      filter?: string;
      attributes?: string[];
      excludedAttributes?: string[];
    } = {},
  ): Promise<ScimListResponse<ScimGroup>> {
    const { startIndex, count } = normalizePagination(
      options.startIndex,
      options.count,
    );

    // An unsupported or malformed filter is a 400 invalidFilter.
    const where: Record<string, unknown> = options.filter
      ? this.filterParser.toPrismaWhereGroup(options.filter, realm.id)
      : { realmId: realm.id };

    const totalResults = await this.prisma.group.count({ where });

    const groups =
      count === 0
        ? []
        : await this.prisma.group.findMany({
            where,
            include: WITH_MEMBERS,
            skip: startIndex - 1,
            take: count,
            orderBy: { name: 'asc' },
          });

    return {
      schemas: [SCIM_SCHEMAS.LIST_RESPONSE],
      totalResults,
      startIndex,
      itemsPerPage: groups.length,
      Resources: groups.map((g) =>
        this.toScimGroup(g, realm, options.excludedAttributes),
      ),
    };
  }

  /**
   * Update a group (SCIM PUT /Groups/{id})
   * RFC 7644 Section 3.5.1
   */
  async update(
    realm: ScimRealmRef,
    groupId: string,
    scimGroup: ScimGroup,
  ): Promise<ScimGroup> {
    const realmId = realm.id;
    const existing = await this.prisma.group.findFirst({
      where: { id: requireId(groupId), realmId },
    });

    if (!existing) {
      throw new NotFoundException(`Group '${groupId}' not found`);
    }

    const name = requireDisplayName(scimGroup);
    const members =
      scimGroup.members === undefined || scimGroup.members === null
        ? undefined
        : memberIds(scimGroup.members);

    await this.assertNameFree(realmId, existing.id, existing.name, name);

    await this.prisma.group.update({
      where: { id: existing.id },
      data: {
        name,
        description: name,
      },
    });

    // Replace the members if the request lists them
    if (members) {
      await this.setMembers(realmId, existing.id, members);
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

    return this.findById(realm, existing.id);
  }

  /**
   * Patch a group (SCIM PATCH /Groups/{id})
   * RFC 7644 Section 3.5.2. Every operation is validated before anything
   * is written.
   */
  async patch(
    realm: ScimRealmRef,
    groupId: string,
    operations: NormalizedScimPatchOperation[],
  ): Promise<ScimGroup> {
    const realmId = realm.id;
    const group = await this.prisma.group.findFirst({
      where: { id: requireId(groupId), realmId },
    });

    if (!group) {
      throw new NotFoundException(`Group '${groupId}' not found`);
    }

    const plan = planGroupPatch(operations);

    if (plan.displayName !== undefined && plan.displayName !== group.name) {
      await this.assertNameFree(
        realmId,
        group.id,
        group.name,
        plan.displayName,
      );
      await this.prisma.group.update({
        where: { id: group.id },
        data: { name: plan.displayName, description: plan.displayName },
      });
    }

    for (const step of plan.members) {
      switch (step.kind) {
        case 'add':
          await this.addMembers(realmId, group.id, step.userIds);
          break;
        case 'set':
          await this.setMembers(realmId, group.id, step.userIds);
          break;
        case 'remove':
          await this.prisma.userGroup.deleteMany({
            where: { groupId: group.id, userId: { in: step.userIds } },
          });
          break;
        case 'clear':
          await this.prisma.userGroup.deleteMany({
            where: { groupId: group.id },
          });
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

    return this.findById(realm, group.id);
  }

  /**
   * Delete a group (SCIM DELETE /Groups/{id})
   * RFC 7644 Section 3.6
   */
  async delete(realm: ScimRealmRef, groupId: string): Promise<void> {
    const realmId = realm.id;
    const group = await this.prisma.group.findFirst({
      where: { id: requireId(groupId), realmId },
    });

    if (!group) {
      throw new NotFoundException(`Group '${groupId}' not found`);
    }

    await this.prisma.group.delete({
      where: { id: group.id },
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
   * Search groups using POST /Groups/.search
   * RFC 7644 Section 3.4.3
   */
  async search(
    realm: ScimRealmRef,
    request: {
      filter?: string;
      attributes?: string[];
      excludedAttributes?: string[];
      startIndex?: number;
      count?: number;
    },
  ): Promise<ScimListResponse<ScimGroup>> {
    return this.findAll(realm, {
      startIndex: request.startIndex,
      count: request.count,
      filter: request.filter,
      attributes: request.attributes,
      excludedAttributes: request.excludedAttributes,
    });
  }

  /**
   * Add users to a group. Ids that are not users of this realm are
   * skipped, as before.
   */
  private async addMembers(
    realmId: string,
    groupId: string,
    userIds: string[],
  ): Promise<void> {
    if (userIds.length === 0) return;
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds }, realmId },
      select: { id: true },
    });
    if (users.length === 0) return;
    await this.prisma.userGroup.createMany({
      data: users.map((u) => ({ userId: u.id, groupId })),
      skipDuplicates: true,
    });
  }

  /** Make the group's members exactly these users. */
  private async setMembers(
    realmId: string,
    groupId: string,
    userIds: string[],
  ): Promise<void> {
    await this.prisma.userGroup.deleteMany({
      where: { groupId, userId: { notIn: userIds } },
    });
    await this.addMembers(realmId, groupId, userIds);
  }

  /** 409 uniqueness when another group of the realm has this name. */
  private async assertNameFree(
    realmId: string,
    groupId: string,
    currentName: string,
    name: string,
  ): Promise<void> {
    if (name === currentName) return;
    const taken = await this.prisma.group.findFirst({
      where: { realmId, name, NOT: { id: groupId } },
      select: { id: true },
    });
    if (taken) {
      throw scimConflict(`Group name '${name}' already exists`);
    }
  }

  /**
   * Convert database group to SCIM Group format
   */
  private toScimGroup(
    group: DbGroupWithUserGroups,
    realm: ScimRealmRef,
    excludedAttributes?: string[],
  ): ScimGroup {
    const scimGroup: ScimGroup = {
      schemas: [SCIM_SCHEMAS.GROUP],
      id: group.id,
      displayName: group.name,
      meta: {
        resourceType: 'Group',
        created: group.createdAt?.toISOString(),
        lastModified: group.updatedAt?.toISOString(),
        location: scimLocation(realm, 'Groups', group.id),
      },
    };

    const withoutMembers = excludedAttributes?.some(
      (a) => a.trim().toLowerCase() === 'members',
    );
    if (!withoutMembers) {
      scimGroup.members = (group.userGroups ?? []).map((ug) => ({
        value: ug.user.id,
        display: ug.user.username,
        type: 'User',
        $ref: scimLocation(realm, 'Users', ug.user.id),
      }));
    }

    return scimGroup;
  }
}

/** A missing id would make `findFirst` match any group of the realm. */
function requireId(id: string | undefined): string {
  if (typeof id !== 'string' || id === '') {
    throw new NotFoundException('A group id is required');
  }
  return id;
}

function requireDisplayName(scimGroup: ScimGroup | undefined): string {
  const name = (scimGroup as Partial<ScimGroup> | undefined)?.displayName;
  if (typeof name !== 'string' || name.trim() === '') {
    throw scimBadRequest('invalidValue', '"displayName" is required');
  }
  return name;
}
