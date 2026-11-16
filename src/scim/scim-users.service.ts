/**
 * SCIM Users Service
 * Implements RFC 7644 Section 3.2 - User Operations
 */

import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { EventsService } from '../events/events.service.js';
import { SessionsService } from '../sessions/sessions.service.js';
import { ScimFilterParserService } from './filter-parser.service.js';
import { coerceScimBoolean } from './patch-request.js';
import { scimBadRequest, scimConflict } from './scim-errors.js';
import {
  normalizePagination,
  scimLocation,
  withoutPassword,
} from './scim-resource.js';
import { applyUserPatch, type ScimUserState } from './user-patch.js';
import { SCIM_SCHEMAS } from './types/scim.types.js';
import type {
  ScimUser,
  ScimListResponse,
  ScimEmail,
  ScimRealmRef,
  NormalizedScimPatchOperation,
} from './types/scim.types.js';

/**
 * Database user with included relations for SCIM conversion
 */
interface DbUserWithGroups {
  id: string;
  username: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  userGroups?: Array<{
    group: {
      id: string;
      name: string;
    };
  }>;
}

const WITH_GROUPS = {
  userGroups: {
    include: { group: true },
  },
} as const;

@Injectable()
export class ScimUsersService {
  private readonly logger = new Logger(ScimUsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsService: EventsService,
    private readonly filterParser: ScimFilterParserService,
    private readonly sessions: SessionsService,
  ) {}

  /**
   * Create a new user (SCIM POST /Users)
   * RFC 7644 Section 3.3
   */
  async create(realm: ScimRealmRef, scimUser: ScimUser): Promise<ScimUser> {
    const body = (scimUser ?? {}) as Partial<ScimUser>;
    const username = body.userName;
    if (typeof username !== 'string' || username.trim() === '') {
      throw scimBadRequest('invalidValue', '"userName" is required');
    }
    const email = primaryEmail(body.emails);
    const enabled =
      body.active === undefined || body.active === null
        ? true
        : coerceScimBoolean(body.active, 'active');

    await this.assertUnique(realm.id, null, { username, email });

    const user = await this.prisma.user.create({
      data: {
        realmId: realm.id,
        username,
        email,
        firstName: optionalText(body.name?.givenName),
        lastName: optionalText(body.name?.familyName),
        enabled,
      },
    });

    // Log SCIM provisioning event
    await this.eventsService.recordAdminEvent({
      realmId: realm.id,
      adminUserId: 'scim',
      operationType: 'CREATE',
      resourceType: 'USER',
      resourcePath: `/scim/v2/Users/${user.id}`,
      representation: { scimUser: withoutPassword(scimUser) },
    });

    this.logger.log(`SCIM: Created user ${user.id} in realm ${realm.id}`);

    return this.toScimUser(user, realm);
  }

  /**
   * Get a user by ID (SCIM GET /Users/{id})
   * RFC 7644 Section 3.4.1
   */
  async findById(
    realm: ScimRealmRef,
    userId: string,
    attributes?: string[],
  ): Promise<ScimUser> {
    const user = await this.prisma.user.findFirst({
      where: { id: requireId(userId), realmId: realm.id },
      include: WITH_GROUPS,
    });

    if (!user) {
      throw new NotFoundException(`User '${userId}' not found`);
    }

    return this.toScimUser(user, realm, attributes);
  }

  /**
   * Get all users with pagination and filtering (SCIM GET /Users)
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
  ): Promise<ScimListResponse<ScimUser>> {
    const { startIndex, count } = normalizePagination(
      options.startIndex,
      options.count,
    );

    // An unsupported or malformed filter is a 400 invalidFilter
    // (RFC 7644 §3.4.2.2), never an empty list: a client that reads "no
    // match" would go on to create a duplicate.
    const where: Record<string, unknown> = options.filter
      ? this.filterParser.toPrismaWhereUser(options.filter, realm.id)
      : { realmId: realm.id };

    const totalResults = await this.prisma.user.count({ where });

    const users =
      count === 0
        ? []
        : await this.prisma.user.findMany({
            where,
            include: WITH_GROUPS,
            skip: startIndex - 1,
            take: count,
            orderBy: { username: 'asc' },
          });

    return {
      schemas: [SCIM_SCHEMAS.LIST_RESPONSE],
      totalResults,
      startIndex,
      itemsPerPage: users.length,
      Resources: users.map((u) =>
        this.toScimUser(u, realm, options.attributes),
      ),
    };
  }

  /**
   * Update a user (SCIM PUT /Users/{id})
   * RFC 7644 Section 3.5.1
   */
  async update(
    realm: ScimRealmRef,
    userId: string,
    scimUser: ScimUser,
  ): Promise<ScimUser> {
    const existing = await this.prisma.user.findFirst({
      where: { id: requireId(userId), realmId: realm.id },
    });

    if (!existing) {
      throw new NotFoundException(`User '${userId}' not found`);
    }

    const body = (scimUser ?? {}) as Partial<ScimUser>;
    if (typeof body.userName !== 'string' || body.userName.trim() === '') {
      throw scimBadRequest('invalidValue', '"userName" is required');
    }
    const email = primaryEmail(body.emails) ?? existing.email;
    const enabled =
      body.active === undefined || body.active === null
        ? existing.enabled
        : coerceScimBoolean(body.active, 'active');

    await this.assertUnique(
      realm.id,
      userId,
      {
        username: body.userName,
        email,
      },
      existing,
    );

    const user = await this.prisma.user.update({
      where: { id: existing.id },
      data: {
        username: body.userName,
        email,
        firstName:
          body.name?.givenName !== undefined
            ? optionalText(body.name.givenName)
            : existing.firstName,
        lastName:
          body.name?.familyName !== undefined
            ? optionalText(body.name.familyName)
            : existing.lastName,
        enabled,
      },
      include: WITH_GROUPS,
    });

    if (existing.enabled && !enabled) {
      await this.endSessions(realm, existing.id);
    }

    await this.eventsService.recordAdminEvent({
      realmId: realm.id,
      adminUserId: 'scim',
      operationType: 'UPDATE',
      resourceType: 'USER',
      resourcePath: `/scim/v2/Users/${userId}`,
      representation: { scimUser: withoutPassword(scimUser) },
    });

    this.logger.log(`SCIM: Updated user ${userId} in realm ${realm.id}`);

    return this.toScimUser(user, realm);
  }

  /**
   * Patch a user (SCIM PATCH /Users/{id})
   * RFC 7644 Section 3.5.2. Every operation is validated before anything
   * is written, so a request applies in full or not at all.
   */
  async patch(
    realm: ScimRealmRef,
    userId: string,
    operations: NormalizedScimPatchOperation[],
  ): Promise<ScimUser> {
    const user = await this.prisma.user.findFirst({
      where: { id: requireId(userId), realmId: realm.id },
    });

    if (!user) {
      throw new NotFoundException(`User '${userId}' not found`);
    }

    const current: ScimUserState = {
      username: user.username,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      enabled: user.enabled,
    };
    const next = applyUserPatch(current, operations);

    const data: Partial<ScimUserState> = {};
    for (const key of Object.keys(next) as Array<keyof ScimUserState>) {
      if (next[key] !== current[key]) {
        (data as Record<string, unknown>)[key] = next[key];
      }
    }

    if (Object.keys(data).length > 0) {
      await this.assertUnique(
        realm.id,
        user.id,
        { username: next.username, email: next.email },
        user,
      );
      await this.prisma.user.update({
        where: { id: user.id },
        data,
      });
    }

    if (current.enabled && !next.enabled) {
      await this.endSessions(realm, user.id);
    }

    // Log event
    await this.eventsService.recordAdminEvent({
      realmId: realm.id,
      adminUserId: 'scim',
      operationType: 'PATCH',
      resourceType: 'USER',
      resourcePath: `/scim/v2/Users/${userId}`,
      representation: { operations: withoutPassword(operations) },
    });

    this.logger.log(`SCIM: Patched user ${userId} in realm ${realm.id}`);

    // Return updated user
    return this.findById(realm, userId);
  }

  /**
   * Delete a user (SCIM DELETE /Users/{id})
   * RFC 7644 Section 3.6
   */
  async delete(realm: ScimRealmRef, userId: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: requireId(userId), realmId: realm.id },
    });

    if (!user) {
      throw new NotFoundException(`User '${userId}' not found`);
    }

    // Instead of hard delete, we disable the user (deprovisioning)
    // This follows SCIM deprovisioning semantics
    await this.prisma.user.update({
      where: { id: user.id },
      data: { enabled: false },
    });
    await this.endSessions(realm, user.id);

    await this.eventsService.recordAdminEvent({
      realmId: realm.id,
      adminUserId: 'scim',
      operationType: 'DELETE',
      resourceType: 'USER',
      resourcePath: `/scim/v2/Users/${userId}`,
      representation: { userId },
    });

    this.logger.log(`SCIM: Deprovisioned user ${userId} in realm ${realm.id}`);
  }

  /**
   * Search users using POST /Users/.search
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
  ): Promise<ScimListResponse<ScimUser>> {
    return this.findAll(realm, {
      startIndex: request.startIndex,
      count: request.count,
      filter: request.filter,
      attributes: request.attributes,
      excludedAttributes: request.excludedAttributes,
    });
  }

  /**
   * A deactivated or deprovisioned user is signed out everywhere: every
   * session ends and its refresh tokens are revoked, through the same code
   * as the admin API's "sign out all sessions". Access tokens already
   * issued stop passing introspection and userinfo because the user is
   * disabled.
   */
  private async endSessions(realm: ScimRealmRef, userId: string) {
    await this.sessions.revokeAllUserSessions(realm, userId);
  }

  /** 409 uniqueness when userName or email is taken by another user. */
  private async assertUnique(
    realmId: string,
    userId: string | null,
    next: { username: string; email: string | null },
    existing?: { username: string; email: string | null },
  ): Promise<void> {
    const notSelf = userId ? { NOT: { id: userId } } : {};
    if (!existing || next.username !== existing.username) {
      const taken = await this.prisma.user.findFirst({
        where: { realmId, username: next.username, ...notSelf },
        select: { id: true },
      });
      if (taken) {
        throw scimConflict(`User '${next.username}' already exists`);
      }
    }
    if (next.email && (!existing || next.email !== existing.email)) {
      const taken = await this.prisma.user.findFirst({
        where: { realmId, email: next.email, ...notSelf },
        select: { id: true },
      });
      if (taken) {
        throw scimConflict(`Email '${next.email}' is already in use`);
      }
    }
  }

  /**
   * Convert database user to SCIM User format
   */
  private toScimUser(
    user: DbUserWithGroups,
    realm: ScimRealmRef,
    attributes?: string[],
  ): ScimUser {
    const formatted = [user.firstName, user.lastName].filter(Boolean).join(' ');
    const scimUser: ScimUser = {
      schemas: [SCIM_SCHEMAS.USER],
      id: user.id,
      userName: user.username,
      name: {
        givenName: user.firstName ?? undefined,
        familyName: user.lastName ?? undefined,
        formatted: formatted || undefined,
      },
      displayName: formatted || undefined,
      emails: user.email
        ? [{ value: user.email, type: 'work', primary: true }]
        : [],
      active: user.enabled,
      meta: {
        resourceType: 'User',
        created: user.createdAt?.toISOString(),
        lastModified: user.updatedAt?.toISOString(),
        location: scimLocation(realm, 'Users', user.id),
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
      const value = this.getNestedValue(user, attr.trim());
      if (value !== undefined) {
        this.setNestedValue(filtered, attr.trim(), value);
      }
    }

    return filtered;
  }

  /**
   * Get nested value from object using dot notation
   */
  private getNestedValue(obj: unknown, path: string): unknown {
    return path.split('.').reduce((current, key) => {
      if (typeof current !== 'object' || current === null) return undefined;
      return Object.hasOwn(current, key)
        ? (current as Record<string, unknown>)[key]
        : undefined;
    }, obj);
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
        throw scimBadRequest(
          'invalidValue',
          `Invalid attribute path segment: ${key}`,
        );
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
}

/** The primary email of a SCIM `emails` list, or the first one. */
function primaryEmail(emails: unknown): string | null {
  if (emails === undefined || emails === null) return null;
  if (!Array.isArray(emails)) {
    throw scimBadRequest('invalidValue', '"emails" must be an array');
  }
  const list = emails as ScimEmail[];
  const chosen =
    list.find((e) => {
      const primary = (e as { primary?: unknown })?.primary;
      return primary === true || String(primary).toLowerCase() === 'true';
    }) ?? list[0];
  if (chosen === undefined) return null;
  const value = (chosen as { value?: unknown })?.value;
  if (value !== undefined && value !== null && typeof value !== 'string') {
    throw scimBadRequest('invalidValue', 'An email "value" must be a string');
  }
  return optionalText(value);
}

function optionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.trim() === '' ? null : value;
}

/** A missing id would make `findFirst` match any user of the realm. */
function requireId(id: string | undefined): string {
  if (typeof id !== 'string' || id === '') {
    throw new NotFoundException('A user id is required');
  }
  return id;
}
