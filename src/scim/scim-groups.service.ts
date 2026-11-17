/**
 * SCIM Groups Service
 * Implements RFC 7644 Section 3.3 - Group Operations
 */

import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { EventsService } from '../events/events.service.js';
import { ScimFilterParserService } from './filter-parser.service.js';
import { planGroupPatch, memberIds, externalIdValue } from './group-patch.js';
import { scimBadRequest, scimConflict } from './scim-errors.js';
import {
  normalizePagination,
  projectResource,
  projectionIncludes,
  scimLocation,
  type ScimProjection,
} from './scim-resource.js';
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
  scimExternalId?: string | null;
  createdAt: Date;
  updatedAt: Date;
  userGroups?: Array<{
    user: {
      id: string;
      username: string;
    };
  }>;
}

/** Only the member columns a response needs, not whole user rows. */
const WITH_MEMBERS = {
  userGroups: {
    select: { user: { select: { id: true, username: true } } },
  },
} as const;

/** The top-level attributes every Group response carries. */
const ALWAYS_RETURNED = ['schemas', 'id', 'meta', 'displayName'];
const GROUP_SCHEMA_URNS = [SCIM_SCHEMAS.GROUP];

/** The Prisma client or an interactive transaction of it. */
type Db = Pick<PrismaService, 'group' | 'user' | 'userGroup'>;

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
    const externalId = externalIdValue(scimGroup?.externalId);
    const members =
      scimGroup.members === undefined || scimGroup.members === null
        ? []
        : memberIds(scimGroup.members);

    await this.assertNameFree(realmId, null, null, name);

    const group = await this.prisma.$transaction(async (tx) => {
      const created = await tx.group.create({
        data: { realmId, name, description: name, scimExternalId: externalId },
      });
      await addMembers(tx, realmId, created.id, members);
      return created;
    });

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
   * RFC 7644 Section 3.4.1. With `excludedAttributes=members` (what Entra
   * ID asks for) the members are not even read, so a large group costs no
   * more than an empty one.
   */
  async findById(
    realm: ScimRealmRef,
    groupId: string,
    projection: ScimProjection | string[] = {},
  ): Promise<ScimGroup> {
    const proj = Array.isArray(projection)
      ? { excludedAttributes: projection }
      : projection;
    const group = await this.prisma.group.findFirst({
      where: { id: requireId(groupId), realmId: realm.id },
      include: projectionIncludes(proj, 'members') ? WITH_MEMBERS : undefined,
    });

    if (!group) {
      throw new NotFoundException(`Group '${groupId}' not found`);
    }

    return this.toScimGroup(group, realm, proj);
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
    const projection: ScimProjection = {
      attributes: options.attributes,
      excludedAttributes: options.excludedAttributes,
    };

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
            include: projectionIncludes(projection, 'members')
              ? WITH_MEMBERS
              : undefined,
            skip: startIndex - 1,
            take: count,
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
          });

    return {
      schemas: [SCIM_SCHEMAS.LIST_RESPONSE],
      totalResults,
      startIndex,
      itemsPerPage: groups.length,
      Resources: groups.map((g) => this.toScimGroup(g, realm, projection)),
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
    projection: ScimProjection = {},
  ): Promise<ScimGroup> {
    const realmId = realm.id;
    const existing = await this.prisma.group.findFirst({
      where: { id: requireId(groupId), realmId },
    });

    if (!existing) {
      throw new NotFoundException(`Group '${groupId}' not found`);
    }

    const name = requireDisplayName(scimGroup);
    const externalId = externalIdValue(scimGroup?.externalId);
    // A PUT replaces the group, members included: none listed is none.
    const members =
      scimGroup.members === undefined || scimGroup.members === null
        ? []
        : memberIds(scimGroup.members);

    await this.assertNameFree(realmId, existing.id, existing.name, name);

    await this.prisma.$transaction(async (tx) => {
      await tx.group.update({
        where: { id: existing.id },
        data: { name, description: name, scimExternalId: externalId },
      });
      await setMembers(tx, realmId, existing.id, members);
    });

    await this.eventsService.recordAdminEvent({
      realmId,
      adminUserId: 'scim',
      operationType: 'UPDATE',
      resourceType: 'GROUP',
      resourcePath: `/scim/v2/Groups/${groupId}`,
      representation: { scimGroup },
    });

    this.logger.log(`SCIM: Updated group ${groupId} in realm ${realmId}`);

    return this.findById(realm, existing.id, projection);
  }

  /**
   * Patch a group (SCIM PATCH /Groups/{id})
   * RFC 7644 Section 3.5.2. Every operation is validated before anything
   * is written, and the changes are written in one transaction.
   *
   * Returns the group only when `projection` is given (the client sent
   * `attributes` or `excludedAttributes`); otherwise null, and the
   * controller answers 204, as RFC 7644 allows: Entra ID adds members to a
   * large group in batches, and sending the whole member list back after
   * each one would cost more than the change itself.
   */
  async patch(
    realm: ScimRealmRef,
    groupId: string,
    operations: NormalizedScimPatchOperation[],
    projection?: ScimProjection,
  ): Promise<ScimGroup | null> {
    const realmId = realm.id;
    const group = await this.prisma.group.findFirst({
      where: { id: requireId(groupId), realmId },
    });

    if (!group) {
      throw new NotFoundException(`Group '${groupId}' not found`);
    }

    const plan = planGroupPatch(operations);

    if (plan.displayName !== undefined) {
      await this.assertNameFree(
        realmId,
        group.id,
        group.name,
        plan.displayName,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const data: Record<string, unknown> = {};
      if (plan.displayName !== undefined && plan.displayName !== group.name) {
        data['name'] = plan.displayName;
        data['description'] = plan.displayName;
      }
      if (
        plan.externalId !== undefined &&
        plan.externalId !== group.scimExternalId
      ) {
        data['scimExternalId'] = plan.externalId;
      }
      if (Object.keys(data).length > 0) {
        await tx.group.update({ where: { id: group.id }, data });
      }

      for (const step of plan.members) {
        switch (step.kind) {
          case 'add':
            await addMembers(tx, realmId, group.id, step.userIds);
            break;
          case 'set':
            await setMembers(tx, realmId, group.id, step.userIds);
            break;
          case 'remove':
            await tx.userGroup.deleteMany({
              where: { groupId: group.id, userId: { in: step.userIds } },
            });
            break;
          case 'clear':
            await tx.userGroup.deleteMany({ where: { groupId: group.id } });
            break;
        }
      }
      if (plan.members.length > 0 && Object.keys(data).length === 0) {
        // A member change is a change of the group (meta.lastModified).
        await tx.group.update({
          where: { id: group.id },
          data: { updatedAt: new Date() },
        });
      }
    });

    await this.eventsService.recordAdminEvent({
      realmId,
      adminUserId: 'scim',
      operationType: 'PATCH',
      resourceType: 'GROUP',
      resourcePath: `/scim/v2/Groups/${groupId}`,
      representation: { operations },
    });

    this.logger.log(`SCIM: Patched group ${groupId} in realm ${realmId}`);

    return projection ? this.findById(realm, group.id, projection) : null;
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
   * 409 uniqueness when another group of the realm has this name,
   * compared case-insensitively as the `displayName eq` lookup is.
   */
  private async assertNameFree(
    realmId: string,
    groupId: string | null,
    currentName: string | null,
    name: string,
  ): Promise<void> {
    if (name === currentName) return;
    const taken = await this.prisma.group.findFirst({
      where: {
        realmId,
        name: { equals: name, mode: 'insensitive' },
        ...(groupId ? { NOT: { id: groupId } } : {}),
      },
      select: { id: true },
    });
    if (taken) {
      throw scimConflict(`Group '${name}' already exists`);
    }
  }

  /**
   * Convert database group to SCIM Group format
   */
  private toScimGroup(
    group: DbGroupWithUserGroups,
    realm: ScimRealmRef,
    projection: ScimProjection = {},
  ): ScimGroup {
    const scimGroup: ScimGroup = {
      schemas: [SCIM_SCHEMAS.GROUP],
      id: group.id,
      ...(group.scimExternalId ? { externalId: group.scimExternalId } : {}),
      displayName: group.name,
      meta: {
        resourceType: 'Group',
        created: group.createdAt?.toISOString(),
        lastModified: group.updatedAt?.toISOString(),
        location: scimLocation(realm, 'Groups', group.id),
      },
    };

    if (group.userGroups) {
      scimGroup.members = group.userGroups.map((ug) => ({
        value: ug.user.id,
        display: ug.user.username,
        type: 'User',
        $ref: scimLocation(realm, 'Users', ug.user.id),
      }));
    }

    return projectResource(
      scimGroup,
      projection,
      GROUP_SCHEMA_URNS,
      ALWAYS_RETURNED,
    );
  }
}

/**
 * Add users to a group. Ids that are not users of this realm are
 * skipped, as before.
 */
async function addMembers(
  db: Db,
  realmId: string,
  groupId: string,
  userIds: string[],
): Promise<void> {
  if (userIds.length === 0) return;
  const users = await db.user.findMany({
    where: { id: { in: userIds }, realmId },
    select: { id: true },
  });
  if (users.length === 0) return;
  await db.userGroup.createMany({
    data: users.map((u) => ({ userId: u.id, groupId })),
    skipDuplicates: true,
  });
}

/** Make the group's members exactly these users. */
async function setMembers(
  db: Db,
  realmId: string,
  groupId: string,
  userIds: string[],
): Promise<void> {
  await db.userGroup.deleteMany({
    where: { groupId, userId: { notIn: userIds } },
  });
  await addMembers(db, realmId, groupId, userIds);
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
