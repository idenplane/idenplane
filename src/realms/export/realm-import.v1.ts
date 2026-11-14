import { Logger } from '@nestjs/common';
import { Prisma, type ClientType } from '@prisma/client';
import { seedDefaultScopesIn } from '../../scopes/scope-seed.service.js';

/**
 * Import of a version 1 realm export: the mapping the import has always
 * used, field for field. Unresolved references are skipped and missing
 * values take the same defaults as before. Only the surroundings changed:
 * it runs inside the caller's transaction, and client secrets are hashed
 * by the caller before the transaction opens.
 */

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

export interface ImportedV1Client {
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

export interface V1SigningKey {
  kid: string;
  publicKeyPem: string;
  privateKeyPem: string;
}

const logger = new Logger('RealmImportV1');

/** The array under `key`, or [] (version 1 never checked further). */
function section<T>(payload: Record<string, unknown>, key: string): T[] {
  const value = payload[key];
  return Array.isArray(value) ? (value as T[]) : [];
}

export function v1Clients(
  payload: Record<string, unknown>,
): ImportedV1Client[] {
  return section<ImportedV1Client>(payload, 'clients');
}

export async function importV1(
  tx: Prisma.TransactionClient,
  payload: Record<string, unknown>,
  /** The new realm's key pair, private key already encrypted at rest. */
  keyPair: V1SigningKey,
  /** clientId → stored secret (already hashed), from the caller. */
  clientSecrets: Map<string, string | null>,
  /** Encrypts a secret at rest (CryptoService.encryptSecret). */
  encryptSecret: (value: string) => string,
) {
  const realmData = payload['realm'] as Record<string, unknown>;
  const realmName = realmData['name'] as string;

  // 1. Create realm
  const realm = await tx.realm.create({
    data: {
      name: realmName,
      displayName: (realmData['displayName'] as string) ?? null,
      enabled: (realmData['enabled'] as boolean) ?? true,
      accessTokenLifespan: (realmData['accessTokenLifespan'] as number) ?? 300,
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
      passwordHistoryCount: (realmData['passwordHistoryCount'] as number) ?? 0,
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
      adminEventsEnabled: (realmData['adminEventsEnabled'] as boolean) ?? false,
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
  const scopes = section<ImportedScope>(payload, 'clientScopes');
  for (const s of scopes) {
    const scope = await tx.clientScope.create({
      data: {
        realmId: realm.id,
        name: s.name,
        description: s.description ?? null,
        protocol: s.protocol ?? 'openid-connect',
        builtIn: s.builtIn ?? false,
      },
    });
    scopeIdMap.set(s.name, scope.id);

    if (Array.isArray(s.protocolMappers)) {
      for (const m of s.protocolMappers) {
        await tx.protocolMapper.create({
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
    await seedDefaultScopesIn(tx, realm.id);
  }

  // 3. Clients first (client roles need them), then roles
  const clientIdMap = new Map<string, string>(); // clientId string → db id
  const roles = section<ImportedRole>(payload, 'roles');
  const clients = v1Clients(payload);
  for (const c of clients) {
    const client = await tx.client.create({
      data: {
        realmId: realm.id,
        clientId: c.clientId,
        clientType: c.clientType ?? 'CONFIDENTIAL',
        clientSecret: clientSecrets.get(c.clientId) ?? null,
        name: c.name ?? null,
        description: c.description ?? null,
        enabled: c.enabled ?? true,
        requireConsent: c.requireConsent ?? false,
        redirectUris: c.redirectUris ?? [],
        webOrigins: (c.webOrigins ?? []).filter((o: string) => {
          if (o === '*') {
            logger.warn(
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

  const roleIdMap = new Map<string, string>(); // "roleName|clientId" → db id
  for (const r of roles) {
    const dbClientId = r.clientId
      ? (clientIdMap.get(r.clientId) ?? null)
      : null;
    const role = await tx.role.create({
      data: {
        realmId: realm.id,
        clientId: dbClientId,
        name: r.name,
        description: r.description ?? null,
      },
    });
    roleIdMap.set(`${r.name}|${r.clientId ?? ''}`, role.id);
  }

  // 4. Create groups: first without parents, then with parents
  const groupIdMap = new Map<string, string>(); // name → id
  const groups = section<ImportedGroup>(payload, 'groups');
  for (const g of groups) {
    if (!g.parentName) {
      const group = await tx.group.create({
        data: {
          realmId: realm.id,
          name: g.name,
          description: g.description ?? null,
        },
      });
      groupIdMap.set(g.name, group.id);
    }
  }
  for (const g of groups) {
    if (g.parentName) {
      const parentId = groupIdMap.get(g.parentName) ?? null;
      const group = await tx.group.create({
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
  const idps = section<ImportedIdp>(payload, 'identityProviders');
  for (const idp of idps) {
    await tx.identityProvider.create({
      data: {
        realmId: realm.id,
        alias: idp.alias,
        displayName: idp.displayName ?? null,
        enabled: idp.enabled ?? true,
        providerType: idp.providerType ?? 'oidc',
        clientId: idp.clientId,
        clientSecret: encryptSecret(idp.clientSecret ?? ''),
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
  const assignments = section<ImportedScopeAssignment>(
    payload,
    'clientScopeAssignments',
  );
  for (const a of assignments) {
    const dbClientId = clientIdMap.get(a.clientId);
    if (!dbClientId) continue;

    for (const scopeName of a.defaultScopes ?? []) {
      const scopeId = scopeIdMap.get(scopeName);
      if (scopeId) {
        await tx.clientDefaultScope.create({
          data: { clientId: dbClientId, clientScopeId: scopeId },
        });
      }
    }

    for (const scopeName of a.optionalScopes ?? []) {
      const scopeId = scopeIdMap.get(scopeName);
      if (scopeId) {
        await tx.clientOptionalScope.create({
          data: { clientId: dbClientId, clientScopeId: scopeId },
        });
      }
    }
  }

  // 7. Import users (if present)
  const users = section<ImportedUser>(payload, 'users');
  for (const u of users) {
    const user = await tx.user.create({
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

    if (Array.isArray(u.roles)) {
      for (const r of u.roles) {
        const roleId = roleIdMap.get(`${r.name}|${r.clientId ?? ''}`);
        if (roleId) {
          await tx.userRole.create({ data: { userId: user.id, roleId } });
        }
      }
    }

    if (Array.isArray(u.groups)) {
      for (const gName of u.groups) {
        const groupId = groupIdMap.get(gName);
        if (groupId) {
          await tx.userGroup.create({ data: { userId: user.id, groupId } });
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
