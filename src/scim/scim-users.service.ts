/**
 * SCIM Users Service
 * Implements RFC 7644 Section 3.2 - User Operations
 */

import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { EventsService } from '../events/events.service.js';
import { ScimFilterParserService } from './filter-parser.service.js';
import type {
  ScimUser,
  ScimListResponse,
  ScimMeta as _ScimMeta,
  ScimPatchOperation,
  ScimEmail,
} from './types/scim.types.js';
import { DEFAULT_USER_ATTRIBUTE_MAPPING as _DEFAULT_USER_ATTRIBUTE_MAPPING } from './schemas/scim.schemas.js';

/**
 * Database user with included relations for SCIM conversion
 */
interface DbUserWithGroups {
  id: string;
  username: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  displayName?: string | null;
  enabled: boolean;
  title?: string | null;
  preferredLanguage?: string | null;
  locale?: string | null;
  timezone?: string | null;
  federationLink?: string | null;
  createdAt: Date;
  updatedAt: Date;
  userGroups?: Array<{
    group: {
      id: string;
      name: string;
    };
  }>;
}

@Injectable()
export class ScimUsersService {
  private readonly logger = new Logger(ScimUsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly eventsService: EventsService,
    private readonly filterParser: ScimFilterParserService,
  ) {}

  /**
   * Create a new user (SCIM POST /Users)
   * RFC 7644 Section 3.2
   */
  async create(realmId: string, scimUser: ScimUser): Promise<ScimUser> {
    const username = scimUser.userName;
    const email =
      scimUser.emails?.find((e) => e.primary)?.value ||
      scimUser.emails?.[0]?.value;

    // Check for existing user
    const existing = await this.prisma.user.findFirst({
      where: { realmId, username },
    });
    if (existing) {
      throw new ConflictException(`User '${username}' already exists`);
    }

    if (email) {
      const emailExists = await this.prisma.user.findFirst({
        where: { realmId, email },
      });
      if (emailExists) {
        throw new ConflictException(`Email '${email}' is already in use`);
      }
    }

    // Create user in database
    const user = await this.prisma.user.create({
      data: {
        realmId,
        username,
        email: email || null,
        firstName: scimUser.name?.givenName || null,
        lastName: scimUser.name?.familyName || null,
        federationLink: scimUser.externalId || null,
      },
    });

    // Log SCIM provisioning event
    await this.eventsService.recordAdminEvent({
      realmId,
      adminUserId: 'scim',
      operationType: 'CREATE',
      resourceType: 'USER',
      resourcePath: `/scim/v2/Users/${user.id}`,
      representation: { scimUser },
    });

    this.logger.log(`SCIM: Created user ${user.id} in realm ${realmId}`);

    return this.toScimUser(user);
  }

  /**
   * Get a user by ID (SCIM GET /Users/{id})
   * RFC 7644 Section 3.2
   */
  async findById(
    realmId: string,
    userId: string,
    attributes?: string[],
  ): Promise<ScimUser> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, realmId },
      include: {
        userGroups: {
          include: { group: true },
        },
      },
    });

    if (!user) {
      throw new NotFoundException(`User '${userId}' not found`);
    }

    return this.toScimUser(user, attributes);
  }

  /**
   * Get all users with pagination and filtering (SCIM GET /Users)
   * RFC 7644 Section 3.2
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
  ): Promise<ScimListResponse<ScimUser>> {
    const { startIndex = 1, count = 100, filter } = options;

    // Build where clause
    let where: Record<string, unknown> = { realmId };

    if (filter) {
      try {
        where = {
          ...where,
          ...this.filterParser.toPrismaWhereUser(filter, realmId),
        };
      } catch {
        // Ignore invalid filter - return empty result
        return this.emptyListResponse(startIndex, count);
      }
    }

    // Get total count
    const totalResults = await this.prisma.user.count({ where });

    // Get users with pagination
    const users = await this.prisma.user.findMany({
      where,
      include: {
        userGroups: {
          include: { group: true },
        },
      },
      skip: Math.max(0, startIndex - 1),
      take: Math.min(count, 100),
      orderBy: { username: 'asc' },
    });

    return {
      schemas: ['urn:scim:schemas:core:1.0:ListResponse'],
      totalResults,
      startIndex,
      itemsPerPage: users.length,
      Resources: users.map((u) => this.toScimUser(u, options.attributes)),
    };
  }

  /**
   * Update a user (SCIM PUT /Users/{id})
   * RFC 7644 Section 3.2
   */
  async update(
    realmId: string,
    userId: string,
    scimUser: ScimUser,
  ): Promise<ScimUser> {
    const existing = await this.prisma.user.findFirst({
      where: { id: userId, realmId },
    });

    if (!existing) {
      throw new NotFoundException(`User '${userId}' not found`);
    }

    const email =
      scimUser.emails?.find((e) => e.primary)?.value ||
      scimUser.emails?.[0]?.value;

    // Check for conflicts
    if (scimUser.userName !== existing.username) {
      const usernameExists = await this.prisma.user.findFirst({
        where: { realmId, username: scimUser.userName, NOT: { id: userId } },
      });
      if (usernameExists) {
        throw new ConflictException(
          `UserName '${scimUser.userName}' already exists`,
        );
      }
    }

    if (email && email !== existing.email) {
      const emailExists = await this.prisma.user.findFirst({
        where: { realmId, email, NOT: { id: userId } },
      });
      if (emailExists) {
        throw new ConflictException(`Email '${email}' is already in use`);
      }
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        username: scimUser.userName,
        email: email || existing.email,
        firstName: scimUser.name?.givenName ?? existing.firstName,
        lastName: scimUser.name?.familyName ?? existing.lastName,
        enabled: scimUser.active ?? existing.enabled,
        federationLink: scimUser.externalId ?? existing.federationLink,
      },
      include: {
        userGroups: {
          include: { group: true },
        },
      },
    });

    await this.eventsService.recordAdminEvent({
      realmId,
      adminUserId: 'scim',
      operationType: 'UPDATE',
      resourceType: 'USER',
      resourcePath: `/scim/v2/Users/${userId}`,
      representation: { scimUser },
    });

    this.logger.log(`SCIM: Updated user ${userId} in realm ${realmId}`);

    return this.toScimUser(user);
  }

  /**
   * Patch a user (SCIM PATCH /Users/{id})
   * RFC 7644 Section 3.6
   */
  async patch(
    realmId: string,
    userId: string,
    operations: ScimPatchOperation[],
  ): Promise<ScimUser> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, realmId },
      include: {
        userGroups: {
          include: { group: true },
        },
      },
    });

    if (!user) {
      throw new NotFoundException(`User '${userId}' not found`);
    }

    // Apply PATCH operations
    const updateData: Record<string, unknown> = {};
    const patches: string[] = [];

    for (const op of operations) {
      switch (op.op) {
        case 'add':
        case 'replace':
          if (typeof op.value === 'object' && op.value !== null) {
            const patchData = this.applyPatchValue(
              op.value as Record<string, unknown>,
              patches,
            );
            Object.assign(updateData, patchData);
          }
          break;
        case 'remove':
          // Remove is handled by path
          this.logger.debug(
            `SCIM PATCH remove for ${op.path || 'whole resource'}`,
          );
          break;
      }
    }

    if (Object.keys(updateData).length > 0) {
      await this.prisma.user.update({
        where: { id: userId },
        data: updateData,
      });
    }

    // Log event
    await this.eventsService.recordAdminEvent({
      realmId,
      adminUserId: 'scim',
      operationType: 'PATCH',
      resourceType: 'USER',
      resourcePath: `/scim/v2/Users/${userId}`,
      representation: { operations },
    });

    this.logger.log(`SCIM: Patched user ${userId} in realm ${realmId}`);

    // Return updated user
    return this.findById(realmId, userId);
  }

  /**
   * Delete a user (SCIM DELETE /Users/{id})
   * RFC 7644 Section 3.2
   */
  async delete(realmId: string, userId: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, realmId },
    });

    if (!user) {
      throw new NotFoundException(`User '${userId}' not found`);
    }

    // Instead of hard delete, we disable the user (deprovisioning)
    // This follows SCIM deprovisioning semantics
    await this.prisma.user.update({
      where: { id: userId },
      data: { enabled: false },
    });

    await this.eventsService.recordAdminEvent({
      realmId,
      adminUserId: 'scim',
      operationType: 'DELETE',
      resourceType: 'USER',
      resourcePath: `/scim/v2/Users/${userId}`,
      representation: { userId },
    });

    this.logger.log(`SCIM: Deprovisioned user ${userId} in realm ${realmId}`);
  }

  /**
   * Search users using POST /Users with filter
   * RFC 7644 Section 3.2
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
  ): Promise<ScimListResponse<ScimUser>> {
    return this.findAll(realmId, {
      startIndex: request.startIndex,
      count: request.count,
      filter: request.filter,
      attributes: request.attributes,
      excludedAttributes: request.excludedAttributes,
    });
  }

  /**
   * Convert database user to SCIM User format
   */
  private toScimUser(user: DbUserWithGroups, attributes?: string[]): ScimUser {
    const scimUser: ScimUser = {
      schemas: ['urn:scim:schemas:core:1.0:User'],
      id: user.id,
      userName: user.username,
      name: {
        givenName: user.firstName ?? undefined,
        familyName: user.lastName ?? undefined,
        formatted: [user.firstName, user.lastName].filter(Boolean).join(' '),
      },
      displayName:
        user.displayName ||
        [user.firstName, user.lastName].filter(Boolean).join(' '),
      emails: user.email ? [{ value: user.email, primary: true }] : [],
      active: user.enabled,
      title: user.title ?? undefined,
      preferredLanguage: user.preferredLanguage ?? undefined,
      locale: user.locale ?? undefined,
      timezone: user.timezone ?? undefined,
      externalId: user.federationLink ?? undefined,
      meta: {
        resourceType: 'User',
        created: user.createdAt?.toISOString(),
        lastModified: user.updatedAt?.toISOString(),
        location: `/scim/v2/Users/${user.id}`,
      },
    };

    // Add groups if available
    if (user.userGroups && user.userGroups.length > 0) {
      scimUser.groups = user.userGroups.map((ug) => ({
        value: ug.group.id,
        display: ug.group.name,
      }));
    }

    // Filter attributes if specified
    if (attributes && attributes.length > 0) {
      return this.filterScimUserAttributes(scimUser, attributes);
    }

    return scimUser;
  }

  /**
   * Filter SCIM user to only include specified attributes
   */
  private filterScimUserAttributes(
    user: ScimUser,
    attributes: string[],
  ): ScimUser {
    const filtered: ScimUser = {
      schemas: user.schemas,
      id: user.id,
      userName: user.userName,
      meta: user.meta,
    };

    for (const attr of attributes) {
      const value = this.getNestedValue(user, attr);
      if (value !== undefined) {
        this.setNestedValue(filtered, attr, value);
      }
    }

    return filtered;
  }

  /**
   * Get nested value from object using dot notation
   */
  private getNestedValue(obj: unknown, path: string): unknown {
    return path
      .split('.')
      .reduce(
        (current, key) => (current as Record<string, unknown>)?.[key],
        obj,
      );
  }

  /**
   * Set nested value on object using dot notation
   */
  private setNestedValue(obj: unknown, path: string, value: unknown): void {
    // Reject prototype-polluting segments inline, immediately before every
    // indexed write, and create intermediate objects with a null prototype so
    // there is no Object.prototype to pollute even via a missed path
    // (CodeQL js/prototype-polluting-assignment). These segments are never valid
    // SCIM attribute names.
    const safeKey = (key: string): string => {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        throw new BadRequestException(`Invalid attribute path segment: ${key}`);
      }
      return key;
    };

    const keys = path.split('.');
    const lastKey = safeKey(keys.pop()!);
    const target = keys.reduce(
      (current, rawKey) => {
        const key = safeKey(rawKey);
        if (!current[key]) {
          current[key] = Object.create(null) as Record<string, unknown>;
        }
        return current[key] as Record<string, unknown>;
      },
      obj as Record<string, unknown>,
    );
    target[lastKey] = value;
  }

  /**
   * Apply PATCH operation value
   */
  private applyPatchValue(
    value: Record<string, unknown>,
    patches: string[],
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, val] of Object.entries(value)) {
      switch (key) {
        case 'userName':
          result['username'] = val;
          patches.push(`userName = ${String(val)}`);
          break;
        case 'name.givenName':
          result['firstName'] = val;
          break;
        case 'name.familyName':
          result['lastName'] = val;
          break;
        case 'displayName':
          result['displayName'] = val;
          break;
        case 'emails':
          if (Array.isArray(val) && val.length > 0) {
            const primaryEmail =
              (val as ScimEmail[]).find((e) => e.primary) ||
              (val[0] as ScimEmail);
            result['email'] = primaryEmail.value;
          }
          break;
        case 'active':
          result['enabled'] = val;
          break;
        case 'title':
          result['title'] = val;
          break;
        case 'preferredLanguage':
          result['preferredLanguage'] = val;
          break;
        case 'locale':
          result['locale'] = val;
          break;
        case 'timezone':
          result['timezone'] = val;
          break;
      }
    }

    return result;
  }

  /**
   * Return empty list response
   */
  private emptyListResponse(
    startIndex: number,
    _count: number,
  ): ScimListResponse<ScimUser> {
    return {
      schemas: ['urn:scim:schemas:core:1.0:ListResponse'],
      totalResults: 0,
      startIndex,
      itemsPerPage: 0,
      Resources: [],
    };
  }
}
