/**
 * SCIM Users Service
 * Implements RFC 7644 Section 3.2 - User Operations
 */

import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { EventsService } from '../events/events.service.js';
import { SessionsService } from '../sessions/sessions.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { PasswordVerificationService } from '../crypto/password-verification.service.js';
import { PasswordPolicyService } from '../password-policy/password-policy.service.js';
import { BruteForceService } from '../brute-force/brute-force.service.js';
import { ScimFilterParserService } from './filter-parser.service.js';
import { ScimException, scimBadRequest, scimConflict } from './scim-errors.js';
import {
  normalizePagination,
  projectResource,
  scimLocation,
  withoutPassword,
  type ScimProjection,
} from './scim-resource.js';
import {
  applyUserPatch,
  userStateFromResource,
  type ScimUserState,
} from './user-patch.js';
import {
  canonicalJson,
  compactProfile,
  enterpriseToScim,
  readProfile,
  type ScimProfile,
} from './user-profile.js';
import { SCIM_SCHEMAS } from './types/scim.types.js';
import type {
  ScimUser,
  ScimListResponse,
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
  scimExternalId?: string | null;
  scimProfile?: unknown;
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

/** The top-level attributes every User response carries. */
const ALWAYS_RETURNED = ['schemas', 'id', 'meta', 'userName'];
const USER_SCHEMA_URNS = [SCIM_SCHEMAS.USER, SCIM_SCHEMAS.ENTERPRISE_USER];

/** A password ready to store: checked against the realm policy, hashed. */
interface PreparedPassword {
  hash: string;
  historyCount: number;
}

@Injectable()
export class ScimUsersService {
  private readonly logger = new Logger(ScimUsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsService: EventsService,
    private readonly filterParser: ScimFilterParserService,
    private readonly sessions: SessionsService,
    private readonly crypto: CryptoService,
    private readonly passwords: PasswordVerificationService,
    private readonly passwordPolicy: PasswordPolicyService,
    private readonly bruteForce: BruteForceService,
  ) {}

  /**
   * Create a new user (SCIM POST /Users)
   * RFC 7644 Section 3.3
   */
  async create(realm: ScimRealmRef, scimUser: ScimUser): Promise<ScimUser> {
    const body = requireBody(scimUser);
    const username = body['userName'];
    if (typeof username !== 'string' || username.trim() === '') {
      throw scimBadRequest('invalidValue', '"userName" is required');
    }
    const next = userStateFromResource(body, { username, enabled: true });

    await this.assertUnique(realm.id, null, {
      username: next.username,
      email: next.email,
    });

    // Checked and hashed before anything is written: a password the
    // realm's policy refuses fails the whole create.
    const password =
      next.password === undefined
        ? undefined
        : await this.preparePassword(realm, null, next.password);

    const user = await this.prisma.user.create({
      data: {
        realmId: realm.id,
        username: next.username,
        email: next.email,
        firstName: next.firstName,
        lastName: next.lastName,
        enabled: next.enabled,
        scimExternalId: next.externalId ?? null,
        scimProfile: profileColumn(next.profile),
        ...(password
          ? { passwordHash: password.hash, passwordChangedAt: new Date() }
          : {}),
      },
    });

    if (password) {
      await this.passwordPolicy.recordHistory(
        user.id,
        realm.id,
        password.hash,
        password.historyCount,
      );
    }

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
    projection: ScimProjection | string[] = {},
  ): Promise<ScimUser> {
    const user = await this.prisma.user.findFirst({
      where: { id: requireId(userId), realmId: realm.id },
      include: WITH_GROUPS,
    });

    if (!user) {
      throw new NotFoundException(`User '${userId}' not found`);
    }

    return this.toScimUser(
      user,
      realm,
      Array.isArray(projection) ? { attributes: projection } : projection,
    );
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
            // id breaks ties, so pages never overlap or skip a user.
            orderBy: [{ username: 'asc' }, { id: 'asc' }],
          });

    return {
      schemas: [SCIM_SCHEMAS.LIST_RESPONSE],
      totalResults,
      startIndex,
      itemsPerPage: users.length,
      Resources: users.map((u) =>
        this.toScimUser(u, realm, {
          attributes: options.attributes,
          excludedAttributes: options.excludedAttributes,
        }),
      ),
    };
  }

  /**
   * Update a user (SCIM PUT /Users/{id})
   * RFC 7644 Section 3.5.1: the body replaces the user. A stored attribute
   * it leaves out is cleared, except `active` (kept, so a PUT that omits it
   * never disables the user) and `password` (write-only: kept unless sent).
   */
  async update(
    realm: ScimRealmRef,
    userId: string,
    scimUser: ScimUser,
    projection: ScimProjection = {},
  ): Promise<ScimUser> {
    const existing = await this.prisma.user.findFirst({
      where: { id: requireId(userId), realmId: realm.id },
    });

    if (!existing) {
      throw new NotFoundException(`User '${userId}' not found`);
    }

    const body = requireBody(scimUser);
    const username = body['userName'];
    if (typeof username !== 'string' || username.trim() === '') {
      throw scimBadRequest('invalidValue', '"userName" is required');
    }
    const next = userStateFromResource(body, {
      username,
      enabled: existing.enabled,
    });

    await this.write(realm, existing, next, 'put');

    await this.eventsService.recordAdminEvent({
      realmId: realm.id,
      adminUserId: 'scim',
      operationType: 'UPDATE',
      resourceType: 'USER',
      resourcePath: `/scim/v2/Users/${userId}`,
      representation: { scimUser: withoutPassword(scimUser) },
    });

    this.logger.log(`SCIM: Updated user ${userId} in realm ${realm.id}`);

    return this.findById(realm, existing.id, projection);
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
    projection: ScimProjection = {},
  ): Promise<ScimUser> {
    const user = await this.prisma.user.findFirst({
      where: { id: requireId(userId), realmId: realm.id },
    });

    if (!user) {
      throw new NotFoundException(`User '${userId}' not found`);
    }

    const next = applyUserPatch(stateOf(user), operations);
    await this.write(realm, user, next, 'patch');

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
    return this.findById(realm, userId, projection);
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
   * Writes `next` over `existing`: the changed columns and profile in one
   * update, then the consequences. A new password is checked against the
   * realm's policy and history and hashed before anything is written.
   */
  private async write(
    realm: ScimRealmRef,
    existing: DbUserWithGroups & {
      passwordHash?: string | null;
      passwordAlgorithm?: string | null;
      federationLink?: string | null;
    },
    next: ScimUserState,
    verb: 'put' | 'patch',
  ): Promise<void> {
    const current = stateOf(existing);
    const data: Prisma.UserUpdateInput = {};
    if (next.username !== current.username) data.username = next.username;
    if (next.email !== current.email) data.email = next.email;
    if (next.firstName !== current.firstName) data.firstName = next.firstName;
    if (next.lastName !== current.lastName) data.lastName = next.lastName;
    if (next.enabled !== current.enabled) data.enabled = next.enabled;
    if ((next.externalId ?? null) !== (current.externalId ?? null)) {
      data.scimExternalId = next.externalId ?? null;
    }
    const profile = compactProfile(next.profile ?? {});
    if (
      // Compared key-order-insensitively: PostgreSQL's JSONB returns keys
      // in its own order, so an unchanged profile must not read as changed.
      canonicalJson(profile) !==
      canonicalJson(compactProfile(current.profile ?? {}))
    ) {
      data.scimProfile = profile
        ? (profile as Prisma.InputJsonValue)
        : Prisma.DbNull;
    }

    if (data.username !== undefined || data.email !== undefined) {
      await this.assertUnique(
        realm.id,
        existing.id,
        { username: next.username, email: next.email },
        existing,
      );
    }

    const password =
      next.password === undefined
        ? undefined
        : await this.preparePassword(realm, existing, next.password, verb);
    if (password) {
      data.passwordHash = password.hash;
      data.passwordChangedAt = new Date();
    }

    if (Object.keys(data).length > 0) {
      await this.prisma.user.update({ where: { id: existing.id }, data });
    }

    // A deactivated user, or one whose password was set, is signed out
    // everywhere (as the admin API's reset-password and disable do).
    if ((current.enabled && !next.enabled) || password) {
      await this.endSessions(realm, existing.id);
    }
    if (password) {
      await this.bruteForce.resetFailures(realm.id, existing.id);
      // The replaced hash joins the history if it was not in it yet (an
      // imported password, say), as for the admin API's reset-password.
      await this.passwordPolicy.recordHistory(
        existing.id,
        realm.id,
        password.hash,
        password.historyCount,
        existing.passwordHash
          ? {
              passwordHash: existing.passwordHash,
              passwordAlgorithm: existing.passwordAlgorithm ?? null,
            }
          : null,
      );
    }
  }

  /**
   * A password set through SCIM, checked as the admin API checks one: the
   * realm's policy, then its history (`passwordHistoryCount`). A failure is
   * a 400 `invalidValue` naming the rule, never echoing the password.
   *
   * Returns undefined when it is the user's current password: Okta, with
   * password sync on, sends the password again on every update, and that
   * must neither fail the history check nor sign the user out.
   *
   * A user federated from LDAP (`federationLink`) signs in against the
   * directory; storing a local hash would silently move them to local
   * password sign-in. So a PATCH that sets their password is refused with
   * 400 `mutability`, before anything is written. In a PUT the password is
   * dropped instead and the rest applied: a PUT is the client's whole
   * representation of the user, and a client that syncs passwords (Okta)
   * includes it in every profile update, which would otherwise fail every
   * update of every federated user.
   */
  private async preparePassword(
    realmRef: ScimRealmRef,
    user: {
      id: string;
      passwordHash?: string | null;
      passwordAlgorithm?: string | null;
      federationLink?: string | null;
    } | null,
    password: string,
    verb: 'create' | 'put' | 'patch' = 'create',
  ): Promise<PreparedPassword | undefined> {
    const realm = await this.prisma.realm.findUnique({
      where: { id: realmRef.id },
    });
    if (!realm) throw new NotFoundException('Realm not found');

    if (user?.passwordHash) {
      const { valid } = await this.passwords.check(
        {
          passwordHash: user.passwordHash,
          passwordAlgorithm: user.passwordAlgorithm ?? null,
        },
        password,
      );
      if (valid) return undefined;
    }

    if (user?.federationLink) {
      if (verb === 'put') {
        this.logger.warn(
          `SCIM: ignored the password in a PUT for federated user ${user.id}; its password is managed by the user federation`,
        );
        return undefined;
      }
      throw new ScimException(
        400,
        'mutability',
        "The user's password is managed by the user federation (LDAP) and cannot be set through SCIM",
      );
    }

    const validation = this.passwordPolicy.validate(realm, password);
    if (!validation.valid) {
      throw scimBadRequest(
        'invalidValue',
        `The password does not meet the realm's policy: ${validation.errors.join('. ')}`,
      );
    }
    if (user && realm.passwordHistoryCount > 0) {
      const reused = await this.passwordPolicy.checkHistory(
        user.id,
        realm.id,
        password,
        realm.passwordHistoryCount,
      );
      if (reused) {
        throw scimBadRequest(
          'invalidValue',
          'The password was used recently; the realm does not allow reusing it',
        );
      }
    }
    return {
      hash: await this.crypto.hashPassword(password),
      historyCount: realm.passwordHistoryCount,
    };
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

  /**
   * 409 uniqueness when userName or email is taken by another user.
   * Compared case-insensitively, as the `userName eq` lookup clients make
   * before a create is: two users that differ only in case would make that
   * lookup return two results, which Entra ID and Okta treat as an error.
   */
  private async assertUnique(
    realmId: string,
    userId: string | null,
    next: { username: string; email: string | null },
    existing?: { username: string; email: string | null },
  ): Promise<void> {
    const notSelf = userId ? { NOT: { id: userId } } : {};
    if (!existing || next.username !== existing.username) {
      const taken = await this.prisma.user.findFirst({
        where: {
          realmId,
          username: { equals: next.username, mode: 'insensitive' },
          ...notSelf,
        },
        select: { id: true },
      });
      if (taken) {
        throw scimConflict(`User '${next.username}' already exists`);
      }
    }
    if (next.email && (!existing || next.email !== existing.email)) {
      const taken = await this.prisma.user.findFirst({
        where: {
          realmId,
          email: { equals: next.email, mode: 'insensitive' },
          ...notSelf,
        },
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
    projection: ScimProjection = {},
  ): ScimUser {
    const profile = readProfile(user.scimProfile);
    const formatted = [user.firstName, user.lastName].filter(Boolean).join(' ');
    const enterprise = enterpriseToScim(profile.enterprise);
    const scimUser: ScimUser = {
      schemas: enterprise
        ? [SCIM_SCHEMAS.USER, SCIM_SCHEMAS.ENTERPRISE_USER]
        : [SCIM_SCHEMAS.USER],
      id: user.id,
      ...(user.scimExternalId ? { externalId: user.scimExternalId } : {}),
      userName: user.username,
      name: {
        givenName: user.firstName ?? undefined,
        familyName: user.lastName ?? undefined,
        ...profile.name,
        formatted: profile.name?.formatted ?? (formatted || undefined),
      },
      displayName: profile.displayName ?? (formatted || undefined),
      nickName: profile.nickName,
      profileUrl: profile.profileUrl,
      title: profile.title,
      userType: profile.userType,
      preferredLanguage: profile.preferredLanguage,
      locale: profile.locale,
      timezone: profile.timezone,
      active: user.enabled,
      emails: user.email
        ? [{ value: user.email, type: 'work', primary: true }]
        : [],
      ...(profile.phoneNumbers
        ? {
            phoneNumbers:
              profile.phoneNumbers as unknown as ScimUser['phoneNumbers'],
          }
        : {}),
      ...(profile.addresses ? { addresses: profile.addresses } : {}),
      ...(enterprise ? { [SCIM_SCHEMAS.ENTERPRISE_USER]: enterprise } : {}),
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
        type: 'direct',
        $ref: scimLocation(realm, 'Groups', ug.group.id),
      }));
    }

    return projectResource(
      dropUndefined(scimUser),
      projection,
      USER_SCHEMA_URNS,
      ALWAYS_RETURNED,
    );
  }
}

/** The SCIM-writable state of a stored user. */
function stateOf(user: DbUserWithGroups): ScimUserState {
  return {
    username: user.username,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    enabled: user.enabled,
    externalId: user.scimExternalId ?? null,
    profile: readProfile(user.scimProfile),
  };
}

function profileColumn(
  profile: ScimProfile | undefined,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  const compact = compactProfile(profile ?? {});
  return compact ? (compact as Prisma.InputJsonValue) : Prisma.DbNull;
}

function requireBody(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw scimBadRequest('invalidSyntax', 'The request body must be an object');
  }
  return body as Record<string, unknown>;
}

/** Leaves out attributes with no value, as SCIM responses do. */
function dropUndefined<T extends object>(resource: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(resource)) {
    if (value === undefined) continue;
    out[key] =
      typeof value === 'object' && value !== null && !Array.isArray(value)
        ? dropUndefined(value as object)
        : value;
  }
  return out as T;
}

/** A missing id would make `findFirst` match any user of the realm. */
function requireId(id: string | undefined): string {
  if (typeof id !== 'string' || id === '') {
    throw new NotFoundException('A user id is required');
  }
  return id;
}
