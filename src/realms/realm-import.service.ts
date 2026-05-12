import {
  Injectable,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { Prisma, type ClientType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { JwkService } from '../crypto/jwk.service.js';
import { ScopeSeedService } from '../scopes/scope-seed.service.js';

/** Shape of each item in the clientScopes / roles / clients / groups / idps /
 *  clientScopeAssignments / users arrays inside the import payload. */
interface ImportedScope {
  name: string;
  description?: string;
  protocol?: string;
  builtIn?: boolean;
  protocolMappers?: Array<{
    name: string;
    protocol?: string;
    mapperType: string;
    config?: Record<string, unknown>;
  }>;
}

interface ImportedRole {
  name: string;
  description?: string;
  clientId?: string;
}

interface ImportedClient {
  clientId: string;
  clientType?: ClientType;
  clientSecret?: string;
  name?: string;
  description?: string;
  enabled?: boolean;
  requireConsent?: boolean;
  redirectUris?: string[];
  webOrigins?: string[];
  grantTypes?: string[];
  backchannelLogoutUri?: string;
  backchannelLogoutSessionRequired?: boolean;
}

interface ImportedGroup {
  name: string;
  description?: string;
  parentName?: string;
}

interface ImportedIdp {
  alias: string;
  displayName?: string;
  enabled?: boolean;
  providerType?: string;
  clientId: string;
  clientSecret?: string;
  authorizationUrl: string;
  tokenUrl: string;
  userinfoUrl?: string;
  jwksUrl?: string;
  issuer?: string;
  defaultScopes?: string;
  trustEmail?: boolean;
  linkOnly?: boolean;
  syncUserProfile?: boolean;
}

interface ImportedScopeAssignment {
  clientId: string;
  defaultScopes?: string[];
  optionalScopes?: string[];
}

interface ImportedUser {
  username: string;
  email?: string;
  emailVerified?: boolean;
  firstName?: string;
  lastName?: string;
  enabled?: boolean;
  roles?: Array<{ name: string; clientId?: string }>;
  groups?: string[];
}

export interface ImportOptions {
  overwrite?: boolean;
}

@Injectable()
export class RealmImportService {
  private readonly logger = new Logger(RealmImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwkService: JwkService,
    private readonly scopeSeedService: ScopeSeedService,
  ) {}

  async importRealm(
    payload: Record<string, unknown>,
    options: ImportOptions = {},
  ) {
    if (!payload['version'] || !payload['realm']) {
      throw new BadRequestException(
        'Invalid import format: missing version or realm',
      );
    }

    const realmData = payload['realm'] as Record<string, unknown>;
    const realmName = realmData['name'] as string;
    if (!realmName) {
      throw new BadRequestException(
        'Invalid import format: realm name is required',
      );
    }

    const existing = await this.prisma.realm.findUnique({
      where: { name: realmName },
    });
    if (existing && !options.overwrite) {
      throw new ConflictException(
        `Realm '${realmName}' already exists. Use overwrite option to replace it.`,
      );
    }

    // If overwriting, delete existing realm first (cascade deletes children)
    if (existing && options.overwrite) {
      await this.prisma.realm.delete({ where: { name: realmName } });
    }

    // 1. Create realm
    const keyPair = await this.jwkService.generateRsaKeyPair();

    const realm = await this.prisma.realm.create({
      data: {
        name: realmName,
        displayName: (realmData['displayName'] as string) ?? null,
        enabled: (realmData['enabled'] as boolean) ?? true,
        accessTokenLifespan:
          (realmData['accessTokenLifespan'] as number) ?? 300,
        refreshTokenLifespan:
          (realmData['refreshTokenLifespan'] as number) ?? 1800,
        offlineTokenLifespan:
          (realmData['offlineTokenLifespan'] as number) ?? 2592000,
        smtpHost: (realmData['smtpHost'] as string) ?? null,
        smtpPort: (realmData['smtpPort'] as number) ?? 587,
        smtpUser: (realmData['smtpUser'] as string) ?? null,
        smtpFrom: (realmData['smtpFrom'] as string) ?? null,
        smtpSecure: (realmData['smtpSecure'] as boolean) ?? false,
        passwordMinLength: (realmData['passwordMinLength'] as number) ?? 8,
        passwordRequireUppercase:
          (realmData['passwordRequireUppercase'] as boolean) ?? false,
        passwordRequireLowercase:
          (realmData['passwordRequireLowercase'] as boolean) ?? false,
        passwordRequireDigits:
          (realmData['passwordRequireDigits'] as boolean) ?? false,
        passwordRequireSpecialChars:
          (realmData['passwordRequireSpecialChars'] as boolean) ?? false,
        passwordHistoryCount:
          (realmData['passwordHistoryCount'] as number) ?? 0,
        passwordMaxAgeDays: (realmData['passwordMaxAgeDays'] as number) ?? 0,
        bruteForceEnabled: (realmData['bruteForceEnabled'] as boolean) ?? false,
        maxLoginFailures: (realmData['maxLoginFailures'] as number) ?? 5,
        lockoutDuration: (realmData['lockoutDuration'] as number) ?? 900,
        failureResetTime: (realmData['failureResetTime'] as number) ?? 600,
        permanentLockoutAfter:
          (realmData['permanentLockoutAfter'] as number) ?? 0,
        mfaRequired: (realmData['mfaRequired'] as boolean) ?? false,
        eventsEnabled: (realmData['eventsEnabled'] as boolean) ?? false,
        eventsExpiration: (realmData['eventsExpiration'] as number) ?? 604800,
        adminEventsEnabled:
          (realmData['adminEventsEnabled'] as boolean) ?? false,
        theme: (realmData['theme'] as Prisma.InputJsonValue) ?? {},
        signingKeys: {
          create: {
            kid: keyPair.kid,
            algorithm: 'RS256',
            publicKey: keyPair.publicKeyPem,
            privateKey: keyPair.privateKeyPem,
          },
        },
      },
    });

    // 2. Create client scopes
    const scopeIdMap = new Map<string, string>(); // name → id
    const scopes = (payload['clientScopes'] ?? []) as ImportedScope[];
    for (const s of scopes) {
      const scope = await this.prisma.clientScope.create({
        data: {
          realmId: realm.id,
          name: s.name,
          description: s.description ?? null,
          protocol: s.protocol ?? 'openid-connect',
          builtIn: s.builtIn ?? false,
        },
      });
      scopeIdMap.set(s.name, scope.id);

      // Create protocol mappers
      if (Array.isArray(s.protocolMappers)) {
        for (const m of s.protocolMappers) {
          await this.prisma.protocolMapper.create({
            data: {
              clientScopeId: scope.id,
              name: m.name,
              protocol: m.protocol ?? 'openid-connect',
              mapperType: m.mapperType,
              config: (m.config ?? {}) as Prisma.InputJsonValue,
            },
          });
        }
      }
    }

    // If no scopes were imported, seed defaults
    if (scopes.length === 0) {
      await this.scopeSeedService.seedDefaultScopes(realm.id);
    }

    // 3. Create roles
    const clientIdMap = new Map<string, string>(); // clientId string → db id
    const roles = (payload['roles'] ?? []) as ImportedRole[];

    // First create clients (needed for client roles)
    const clients = (payload['clients'] ?? []) as ImportedClient[];
    for (const c of clients) {
      const client = await this.prisma.client.create({
        data: {
          realmId: realm.id,
          clientId: c.clientId,
          clientType: c.clientType ?? 'CONFIDENTIAL',
          clientSecret: c.clientSecret ?? null,
          name: c.name ?? null,
          description: c.description ?? null,
          enabled: c.enabled ?? true,
          requireConsent: c.requireConsent ?? false,
          redirectUris: c.redirectUris ?? [],
          webOrigins: (c.webOrigins ?? []).filter((o: string) => {
            if (o === '*') {
              this.logger.warn(
                `Imported client '${c.clientId}' has a wildcard webOrigin "*" — ` +
                  'it has been stripped during import. ' +
                  'Update the client to use explicit origins.',
              );
              return false;
            }
            return true;
          }),
          grantTypes: c.grantTypes ?? ['authorization_code'],
          backchannelLogoutUri: c.backchannelLogoutUri ?? null,
          backchannelLogoutSessionRequired:
            c.backchannelLogoutSessionRequired ?? true,
        },
      });
      clientIdMap.set(c.clientId, client.id);
    }

    // Now create roles
    const roleIdMap = new Map<string, string>(); // "roleName|clientId" → db id
    for (const r of roles) {
      const dbClientId = r.clientId
        ? (clientIdMap.get(r.clientId) ?? null)
        : null;
      const role = await this.prisma.role.create({
        data: {
          realmId: realm.id,
          clientId: dbClientId,
          name: r.name,
          description: r.description ?? null,
        },
      });
      roleIdMap.set(`${r.name}|${r.clientId ?? ''}`, role.id);
    }

    // 4. Create groups
    const groupIdMap = new Map<string, string>(); // name → id
    const groups = (payload['groups'] ?? []) as ImportedGroup[];
    // First pass: create groups without parents
    for (const g of groups) {
      if (!g.parentName) {
        const group = await this.prisma.group.create({
          data: {
            realmId: realm.id,
            name: g.name,
            description: g.description ?? null,
          },
        });
        groupIdMap.set(g.name, group.id);
      }
    }
    // Second pass: create groups with parents
    for (const g of groups) {
      if (g.parentName) {
        const parentId = groupIdMap.get(g.parentName) ?? null;
        const group = await this.prisma.group.create({
          data: {
            realmId: realm.id,
            name: g.name,
            description: g.description ?? null,
            parentId,
          },
        });
        groupIdMap.set(g.name, group.id);
      }
    }

    // 5. Create identity providers
    const idps = (payload['identityProviders'] ?? []) as ImportedIdp[];
    for (const idp of idps) {
      await this.prisma.identityProvider.create({
        data: {
          realmId: realm.id,
          alias: idp.alias,
          displayName: idp.displayName ?? null,
          enabled: idp.enabled ?? true,
          providerType: idp.providerType ?? 'oidc',
          clientId: idp.clientId,
          clientSecret: idp.clientSecret ?? '',
          authorizationUrl: idp.authorizationUrl,
          tokenUrl: idp.tokenUrl,
          userinfoUrl: idp.userinfoUrl ?? null,
          jwksUrl: idp.jwksUrl ?? null,
          issuer: idp.issuer ?? null,
          defaultScopes: idp.defaultScopes ?? 'openid email profile',
          trustEmail: idp.trustEmail ?? false,
          linkOnly: idp.linkOnly ?? false,
          syncUserProfile: idp.syncUserProfile ?? true,
        },
      });
    }

    // 6. Client scope assignments
    const assignments = (payload['clientScopeAssignments'] ??
      []) as ImportedScopeAssignment[];
    for (const a of assignments) {
      const dbClientId = clientIdMap.get(a.clientId);
      if (!dbClientId) continue;

      for (const scopeName of a.defaultScopes ?? []) {
        const scopeId = scopeIdMap.get(scopeName);
        if (scopeId) {
          await this.prisma.clientDefaultScope.create({
            data: { clientId: dbClientId, clientScopeId: scopeId },
          });
        }
      }

      for (const scopeName of a.optionalScopes ?? []) {
        const scopeId = scopeIdMap.get(scopeName);
        if (scopeId) {
          await this.prisma.clientOptionalScope.create({
            data: { clientId: dbClientId, clientScopeId: scopeId },
          });
        }
      }
    }

    // 7. Import users (if present)
    const users = (payload['users'] ?? []) as ImportedUser[];
    for (const u of users) {
      const user = await this.prisma.user.create({
        data: {
          realmId: realm.id,
          username: u.username,
          email: u.email ?? null,
          emailVerified: u.emailVerified ?? false,
          firstName: u.firstName ?? null,
          lastName: u.lastName ?? null,
          enabled: u.enabled ?? true,
        },
      });

      // Assign roles
      if (Array.isArray(u.roles)) {
        for (const r of u.roles) {
          const roleKey = `${r.name}|${r.clientId ?? ''}`;
          const roleId = roleIdMap.get(roleKey);
          if (roleId) {
            await this.prisma.userRole.create({
              data: { userId: user.id, roleId },
            });
          }
        }
      }

      // Assign groups
      if (Array.isArray(u.groups)) {
        for (const gName of u.groups) {
          const groupId = groupIdMap.get(gName);
          if (groupId) {
            await this.prisma.userGroup.create({
              data: { userId: user.id, groupId },
            });
          }
        }
      }
    }

    return {
      realmName: realm.name,
      clientsImported: clients.length,
      rolesImported: roles.length,
      groupsImported: groups.length,
      scopesImported: scopes.length,
      idpsImported: idps.length,
      usersImported: users.length,
    };
  }
}
