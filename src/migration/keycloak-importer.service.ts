import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import type {
  KeycloakRealmExport,
  KeycloakUser,
  KeycloakClient,
  KeycloakGroup,
} from './keycloak-types.js';
import { createEmptyReport, type MigrationReport } from './migration-report.js';
import type { Prisma } from '@prisma/client';

type PrismaTx = Prisma.TransactionClient;

export interface KeycloakImportOptions {
  dryRun: boolean;
  targetRealm?: string;
}

@Injectable()
export class KeycloakImporterService {
  private readonly logger = new Logger(KeycloakImporterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async importRealm(
    data: KeycloakRealmExport,
    options: KeycloakImportOptions,
  ): Promise<MigrationReport> {
    const report = createEmptyReport('keycloak', options.dryRun);
    // data.realm must be a string (the Keycloak export JSON "realm" field).
    // Guard against callers that pass a raw JSON object where a string is
    // expected — e.g. if the entire realm config object is accidentally used
    // instead of just its "realm" (name) property.
    const exportRealmName =
      typeof data.realm === 'string'
        ? data.realm
        : (((data.realm as unknown as Record<string, unknown>)['realm'] as
            | string
            | undefined) ?? String(data.realm));
    const realmName = options.targetRealm ?? exportRealmName;

    if (options.dryRun) {
      // Dry-run: simulate without writing — no transaction needed.
      const realmId = await this.importRealmEntity(
        data,
        realmName,
        report,
        true,
      );
      if (!realmId) {
        report.completedAt = new Date();
        return report;
      }
      await this.importRoles(data, realmId, report, true);
      await this.importGroups(data.groups ?? [], realmId, null, report, true);
      await this.importClientScopes(data, realmId, report, true);
      await this.importClients(data, realmId, report, true);
      await this.importUsers(data, realmId, report, true);
      await this.importIdentityProviders(data, realmId, report, true);
    } else {
      // Real import: wrap every write in a single transaction so that any
      // failure causes a full rollback, preventing partial/corrupt data.
      try {
        await this.prisma.$transaction(async (tx) => {
          const realmId = await this.importRealmEntity(
            data,
            realmName,
            report,
            false,
            tx,
          );
          if (!realmId) {
            // A fatal realm-level error was already recorded; abort the transaction.
            throw new Error(
              `Failed to create realm '${realmName}' — rolling back`,
            );
          }

          await this.importRoles(data, realmId, report, false, tx);
          await this.importGroups(
            data.groups ?? [],
            realmId,
            null,
            report,
            false,
            tx,
          );
          await this.importClientScopes(data, realmId, report, false, tx);
          await this.importClients(data, realmId, report, false, tx);
          await this.importUsers(data, realmId, report, false, tx);
          await this.importIdentityProviders(data, realmId, report, false, tx);
        });
      } catch (error: unknown) {
        const err = error as Error;
        // If the error was injected by us to trigger a rollback it is already
        // recorded in report.errors.  For any other unexpected error, add it.
        const alreadyRecorded = report.errors.some(
          (e) => e.error === err.message,
        );
        if (!alreadyRecorded) {
          report.errors.push({
            entity: 'realm',
            name: realmName,
            error: err.message,
          });
        }
      }
    }

    report.completedAt = new Date();
    return report;
  }

  private async importRealmEntity(
    data: KeycloakRealmExport,
    realmName: string,
    report: MigrationReport,
    dryRun: boolean,
    tx?: PrismaTx,
  ): Promise<string | null> {
    const db = tx ?? this.prisma;
    try {
      const existing = await db.realm.findUnique({
        where: { name: realmName },
      });
      if (existing) {
        report.summary.realms.skipped++;
        report.warnings.push({
          entity: 'realm',
          message: `Realm '${realmName}' already exists, using existing`,
        });
        return existing.id;
      }

      if (dryRun) {
        report.summary.realms.created++;
        return 'dry-run-realm-id';
      }

      const realm = await db.realm.create({
        data: {
          name: realmName,
          displayName: data.displayName,
          enabled: data.enabled ?? true,
          registrationAllowed: data.registrationAllowed ?? false,
          accessTokenLifespan: data.accessTokenLifespan ?? 300,
          refreshTokenLifespan: data.ssoSessionMaxLifespan ?? 1800,
          ...(data.smtpServer?.host && {
            smtpHost: data.smtpServer.host,
            smtpPort: parseInt(data.smtpServer.port ?? '587', 10),
            smtpFrom: data.smtpServer.from,
            smtpUser: data.smtpServer.user,
            smtpPassword: data.smtpServer.password,
            smtpSsl: data.smtpServer.ssl === 'true',
          }),
          ...(data.bruteForceProtected && {
            bruteForceEnabled: true,
            maxLoginFailures: data.failureFactor ?? 5,
          }),
        },
      });

      report.summary.realms.created++;
      return realm.id;
    } catch (error: unknown) {
      report.summary.realms.failed++;
      report.errors.push({
        entity: 'realm',
        name: realmName,
        error: (error as Error).message,
      });
      return null;
    }
  }

  private async importRoles(
    data: KeycloakRealmExport,
    realmId: string,
    report: MigrationReport,
    dryRun: boolean,
    tx?: PrismaTx,
  ): Promise<void> {
    const db = tx ?? this.prisma;
    for (const role of data.roles?.realm ?? []) {
      const sourceRealmName =
        typeof data.realm === 'string'
          ? data.realm
          : (((data.realm as unknown as Record<string, unknown>)['realm'] as
              | string
              | undefined) ?? String(data.realm));
      if (
        [
          'offline_access',
          'uma_authorization',
          'default-roles-' + sourceRealmName,
        ].includes(role.name)
      ) {
        continue; // Skip Keycloak built-in roles
      }
      try {
        const existing = await db.role.findFirst({
          where: { realmId, name: role.name, clientId: null },
        });
        if (existing) {
          report.summary.roles.skipped++;
          continue;
        }
        if (!dryRun) {
          await db.role.create({
            data: { realmId, name: role.name, description: role.description },
          });
        }
        report.summary.roles.created++;
      } catch (error: unknown) {
        report.summary.roles.failed++;
        report.errors.push({
          entity: 'role',
          name: role.name,
          error: (error as Error).message,
        });
      }
    }
  }

  private async importGroups(
    groups: KeycloakGroup[],
    realmId: string,
    parentId: string | null,
    report: MigrationReport,
    dryRun: boolean,
    tx?: PrismaTx,
  ): Promise<void> {
    const db = tx ?? this.prisma;
    for (const group of groups) {
      try {
        const existing = await db.group.findFirst({
          where: { realmId, name: group.name, parentId },
        });
        if (existing) {
          report.summary.groups.skipped++;
          if (group.subGroups?.length) {
            await this.importGroups(
              group.subGroups,
              realmId,
              existing.id,
              report,
              dryRun,
              tx,
            );
          }
          continue;
        }
        let groupId = 'dry-run-group-id';
        if (!dryRun) {
          const created = await db.group.create({
            data: { realmId, name: group.name, parentId },
          });
          groupId = created.id;
        }
        report.summary.groups.created++;
        if (group.subGroups?.length) {
          await this.importGroups(
            group.subGroups,
            realmId,
            dryRun ? null : groupId,
            report,
            dryRun,
            tx,
          );
        }
      } catch (error: unknown) {
        report.summary.groups.failed++;
        report.errors.push({
          entity: 'group',
          name: group.name,
          error: (error as Error).message,
        });
      }
    }
  }

  private async importClientScopes(
    data: KeycloakRealmExport,
    realmId: string,
    report: MigrationReport,
    dryRun: boolean,
    tx?: PrismaTx,
  ): Promise<void> {
    const db = tx ?? this.prisma;
    for (const scope of data.clientScopes ?? []) {
      try {
        const existing = await db.clientScope.findFirst({
          where: { realmId, name: scope.name },
        });
        if (existing) {
          report.summary.scopes.skipped++;
          continue;
        }
        if (!dryRun) {
          await db.clientScope.create({
            data: {
              realmId,
              name: scope.name,
              description: scope.description,
              protocol: scope.protocol ?? 'openid-connect',
            },
          });
        }
        report.summary.scopes.created++;
      } catch (error: unknown) {
        report.summary.scopes.failed++;
        report.errors.push({
          entity: 'scope',
          name: scope.name,
          error: (error as Error).message,
        });
      }
    }
  }

  private async importClients(
    data: KeycloakRealmExport,
    realmId: string,
    report: MigrationReport,
    dryRun: boolean,
    tx?: PrismaTx,
  ): Promise<void> {
    const db = tx ?? this.prisma;
    for (const client of data.clients ?? []) {
      if (this.isKeycloakBuiltinClient(client.clientId)) continue;
      try {
        const existing = await db.client.findFirst({
          where: { realmId, clientId: client.clientId },
        });
        if (existing) {
          report.summary.clients.skipped++;
          continue;
        }
        if (!dryRun) {
          const grantTypes = this.mapKeycloakGrantTypes(client);
          const secretHash = client.secret
            ? await this.crypto.hashPassword(client.secret)
            : null;
          await db.client.create({
            data: {
              realmId,
              clientId: client.clientId,
              name: client.name,
              enabled: client.enabled ?? true,
              clientType: client.publicClient ? 'PUBLIC' : 'CONFIDENTIAL',
              clientSecret: secretHash,
              redirectUris: client.redirectUris ?? [],
              webOrigins: (client.webOrigins ?? []).filter((o: string) => {
                if (o === '*') {
                  this.logger.warn(
                    `Keycloak client '${client.clientId}' has a wildcard webOrigin "*" — ` +
                      'it has been stripped during import. ' +
                      'Update the client to use explicit origins.',
                  );
                  return false;
                }
                return true;
              }),
              grantTypes,
              requireConsent: client.consentRequired ?? false,
            },
          });
        }
        report.summary.clients.created++;
      } catch (error: unknown) {
        report.summary.clients.failed++;
        report.errors.push({
          entity: 'client',
          name: client.clientId,
          error: (error as Error).message,
        });
      }
    }
  }

  private async importUsers(
    data: KeycloakRealmExport,
    realmId: string,
    report: MigrationReport,
    dryRun: boolean,
    tx?: PrismaTx,
  ): Promise<void> {
    const db = tx ?? this.prisma;
    for (const user of data.users ?? []) {
      try {
        const existing = await db.user.findFirst({
          where: { realmId, username: user.username },
        });
        if (existing) {
          report.summary.users.skipped++;
          continue;
        }

        const {
          hash: rawHash,
          algorithm,
          needsHashing,
        } = this.extractKeycloakPassword(user);
        const hash =
          needsHashing && rawHash
            ? await this.crypto.hashPassword(rawHash)
            : rawHash;

        if (!dryRun) {
          const created = await db.user.create({
            data: {
              realmId,
              username: user.username,
              email: user.email,
              firstName: user.firstName,
              lastName: user.lastName,
              enabled: user.enabled ?? true,
              emailVerified: user.emailVerified ?? false,
              passwordHash: hash,
              passwordAlgorithm: algorithm,
            },
          });

          // Assign realm roles
          if (user.realmRoles?.length) {
            for (const roleName of user.realmRoles) {
              const role = await db.role.findFirst({
                where: { realmId, name: roleName, clientId: null },
              });
              if (role) {
                await db.userRole
                  .create({
                    data: { userId: created.id, roleId: role.id },
                  })
                  .catch(() => {}); // Ignore duplicate
              }
            }
          }
        }
        report.summary.users.created++;
      } catch (error: unknown) {
        report.summary.users.failed++;
        const errRecord = error as { message?: string };
        report.errors.push({
          entity: 'user',
          name: user.username,
          error: errRecord.message ?? String(error),
        });
      }
    }
  }

  private extractKeycloakPassword(user: KeycloakUser): {
    hash: string | null;
    algorithm: string;
    needsHashing?: boolean;
  } {
    const passwordCred = user.credentials?.find((c) => c.type === 'password');
    if (!passwordCred) return { hash: null, algorithm: 'argon2' };

    if (passwordCred.hashedSaltedValue && passwordCred.salt) {
      // PBKDF2 format: iterations$salt$hash
      const iterations = passwordCred.hashIterations ?? 27500;
      const hash = `${iterations}$${passwordCred.salt}$${passwordCred.hashedSaltedValue}`;
      return { hash, algorithm: 'pbkdf2-sha256' };
    }

    if (passwordCred.value) {
      // Plain text password (rare) — hash it with Argon2
      return {
        hash: passwordCred.value,
        algorithm: 'argon2',
        needsHashing: true,
      };
    }

    return { hash: null, algorithm: 'argon2' };
  }

  private async importIdentityProviders(
    data: KeycloakRealmExport,
    realmId: string,
    report: MigrationReport,
    dryRun: boolean,
    tx?: PrismaTx,
  ): Promise<void> {
    const db = tx ?? this.prisma;
    for (const idp of data.identityProviders ?? []) {
      try {
        const existing = await db.identityProvider.findFirst({
          where: { realmId, alias: idp.alias },
        });
        if (existing) {
          report.summary.identityProviders.skipped++;
          continue;
        }
        if (!dryRun) {
          const providerType = this.mapKeycloakProviderType(idp.providerId);
          await db.identityProvider.create({
            data: {
              realmId,
              alias: idp.alias,
              displayName: idp.displayName ?? idp.alias,
              providerType,
              enabled: idp.enabled ?? true,
              trustEmail: idp.trustEmail ?? false,
              clientId: idp.config?.clientId ?? '',
              clientSecret: idp.config?.clientSecret ?? '',
              authorizationUrl: idp.config?.authorizationUrl ?? '',
              tokenUrl: idp.config?.tokenUrl ?? '',
              userinfoUrl: idp.config?.userInfoUrl,
              issuer: idp.config?.issuer,
            },
          });
        }
        report.summary.identityProviders.created++;
      } catch (error: unknown) {
        report.summary.identityProviders.failed++;
        report.errors.push({
          entity: 'identity_provider',
          name: idp.alias,
          error: (error as Error).message,
        });
      }
    }
  }

  private mapKeycloakGrantTypes(client: KeycloakClient): string[] {
    const grants: string[] = [];
    if (client.standardFlowEnabled !== false) grants.push('authorization_code');
    if (client.directAccessGrantsEnabled) grants.push('password');
    if (client.serviceAccountsEnabled) grants.push('client_credentials');
    grants.push('refresh_token');
    return grants;
  }

  private mapKeycloakProviderType(providerId: string): string {
    const map: Record<string, string> = {
      oidc: 'OIDC',
      'keycloak-oidc': 'OIDC',
      google: 'OIDC',
      github: 'OIDC',
      facebook: 'OIDC',
      microsoft: 'OIDC',
      saml: 'SAML',
    };
    return map[providerId] ?? 'OIDC';
  }

  private isKeycloakBuiltinClient(clientId: string): boolean {
    return [
      'account',
      'account-console',
      'admin-cli',
      'broker',
      'realm-management',
      'security-admin-console',
    ].includes(clientId);
  }
}
