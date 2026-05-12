import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface RealmExportOptions {
  includeUsers?: boolean;
  includeSecrets?: boolean;
}

@Injectable()
export class RealmExportService {
  constructor(private readonly prisma: PrismaService) {}

  async exportRealm(realmName: string, options: RealmExportOptions = {}) {
    const realm = await this.prisma.realm.findUnique({
      where: { name: realmName },
    });
    if (!realm) {
      throw new NotFoundException(`Realm '${realmName}' not found`);
    }

    const clients = await this.prisma.client.findMany({
      where: { realmId: realm.id },
    });

    const roles = await this.prisma.role.findMany({
      where: { realmId: realm.id },
    });

    const groups = await this.prisma.group.findMany({
      where: { realmId: realm.id },
    });

    const clientScopes = await this.prisma.clientScope.findMany({
      where: { realmId: realm.id },
      include: { protocolMappers: true },
    });

    const identityProviders = await this.prisma.identityProvider.findMany({
      where: { realmId: realm.id },
    });

    // Build client scope assignments
    const clientDefaultScopes = await this.prisma.clientDefaultScope.findMany({
      where: { client: { realmId: realm.id } },
    });
    const clientOptionalScopes = await this.prisma.clientOptionalScope.findMany(
      {
        where: { client: { realmId: realm.id } },
      },
    );

    // Map IDs to natural keys for portability
    const clientMap = new Map(clients.map((c) => [c.id, c.clientId]));
    const scopeMap = new Map(clientScopes.map((s) => [s.id, s.name]));

    const exportData: Record<string, unknown> = {
      version: 1,
      realm: {
        name: realm.name,
        displayName: realm.displayName,
        enabled: realm.enabled,
        accessTokenLifespan: realm.accessTokenLifespan,
        refreshTokenLifespan: realm.refreshTokenLifespan,
        offlineTokenLifespan: realm.offlineTokenLifespan,
        smtpHost: realm.smtpHost,
        smtpPort: realm.smtpPort,
        smtpUser: realm.smtpUser,
        smtpFrom: realm.smtpFrom,
        smtpSecure: realm.smtpSecure,
        passwordMinLength: realm.passwordMinLength,
        passwordRequireUppercase: realm.passwordRequireUppercase,
        passwordRequireLowercase: realm.passwordRequireLowercase,
        passwordRequireDigits: realm.passwordRequireDigits,
        passwordRequireSpecialChars: realm.passwordRequireSpecialChars,
        passwordHistoryCount: realm.passwordHistoryCount,
        passwordMaxAgeDays: realm.passwordMaxAgeDays,
        bruteForceEnabled: realm.bruteForceEnabled,
        maxLoginFailures: realm.maxLoginFailures,
        lockoutDuration: realm.lockoutDuration,
        failureResetTime: realm.failureResetTime,
        permanentLockoutAfter: realm.permanentLockoutAfter,
        mfaRequired: realm.mfaRequired,
        eventsEnabled: realm.eventsEnabled,
        eventsExpiration: realm.eventsExpiration,
        adminEventsEnabled: realm.adminEventsEnabled,
        theme: realm.theme,
      },
      clients: clients.map((c) => ({
        clientId: c.clientId,
        clientType: c.clientType,
        clientSecret: options.includeSecrets ? c.clientSecret : undefined,
        name: c.name,
        description: c.description,
        enabled: c.enabled,
        requireConsent: c.requireConsent,
        redirectUris: c.redirectUris,
        webOrigins: c.webOrigins,
        grantTypes: c.grantTypes,
        backchannelLogoutUri: c.backchannelLogoutUri,
        backchannelLogoutSessionRequired: c.backchannelLogoutSessionRequired,
      })),
      roles: roles.map((r) => ({
        name: r.name,
        description: r.description,
        clientId: r.clientId ? (clientMap.get(r.clientId) ?? null) : null,
      })),
      groups: groups.map((g) => ({
        name: g.name,
        description: g.description,
        parentName: g.parentId
          ? (groups.find((p) => p.id === g.parentId)?.name ?? null)
          : null,
      })),
      clientScopes: clientScopes.map((s) => ({
        name: s.name,
        description: s.description,
        protocol: s.protocol,
        builtIn: s.builtIn,
        protocolMappers: s.protocolMappers.map((m) => ({
          name: m.name,
          protocol: m.protocol,
          mapperType: m.mapperType,
          config: m.config,
        })),
      })),
      identityProviders: identityProviders.map((idp) => ({
        alias: idp.alias,
        displayName: idp.displayName,
        enabled: idp.enabled,
        providerType: idp.providerType,
        clientId: idp.clientId,
        clientSecret: options.includeSecrets ? idp.clientSecret : undefined,
        authorizationUrl: idp.authorizationUrl,
        tokenUrl: idp.tokenUrl,
        userinfoUrl: idp.userinfoUrl,
        jwksUrl: idp.jwksUrl,
        issuer: idp.issuer,
        defaultScopes: idp.defaultScopes,
        trustEmail: idp.trustEmail,
        linkOnly: idp.linkOnly,
        syncUserProfile: idp.syncUserProfile,
      })),
      clientScopeAssignments: clients.map((c) => ({
        clientId: c.clientId,
        defaultScopes: clientDefaultScopes
          .filter((ds) => ds.clientId === c.id)
          .map((ds) => scopeMap.get(ds.clientScopeId))
          .filter(Boolean),
        optionalScopes: clientOptionalScopes
          .filter((os) => os.clientId === c.id)
          .map((os) => scopeMap.get(os.clientScopeId))
          .filter(Boolean),
      })),
    };

    if (options.includeUsers) {
      const users = await this.prisma.user.findMany({
        where: { realmId: realm.id },
        include: {
          userRoles: { include: { role: true } },
          userGroups: { include: { group: true } },
        },
      });

      exportData['users'] = users.map((u) => ({
        username: u.username,
        email: u.email,
        emailVerified: u.emailVerified,
        firstName: u.firstName,
        lastName: u.lastName,
        enabled: u.enabled,
        roles: u.userRoles.map((ur) => ({
          name: ur.role.name,
          clientId: ur.role.clientId
            ? (clientMap.get(ur.role.clientId) ?? null)
            : null,
        })),
        groups: u.userGroups.map((ug) => ug.group.name),
      }));
    }

    return exportData;
  }
}
