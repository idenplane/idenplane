import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ZitadelExport, ZitadelUser } from './zitadel-types.js';
import { createEmptyReport, type MigrationReport } from './migration-report.js';

export interface ZitadelImportOptions {
  dryRun: boolean;
  targetRealm: string;
}

const INACTIVE_STATES = ['USER_STATE_INACTIVE', 'USER_STATE_LOCKED'];

@Injectable()
export class ZitadelImporterService {
  private readonly logger = new Logger(ZitadelImporterService.name);

  constructor(private readonly prisma: PrismaService) {}

  async importData(
    data: ZitadelExport,
    options: ZitadelImportOptions,
  ): Promise<MigrationReport> {
    const report = createEmptyReport('zitadel', options.dryRun);

    const realm = await this.prisma.realm.findUnique({
      where: { name: options.targetRealm },
    });
    if (!realm) {
      report.errors.push({
        entity: 'realm',
        name: options.targetRealm,
        error: `Realm '${options.targetRealm}' does not exist. Create it first.`,
      });
      report.completedAt = new Date();
      return report;
    }

    await this.importRoles(data, realm.id, report, options.dryRun);
    await this.importClients(data, realm.id, report, options.dryRun);
    await this.importUsers(data, realm.id, report, options.dryRun);
    await this.importIdps(data, realm.id, report, options.dryRun);

    report.completedAt = new Date();
    return report;
  }

  private async importRoles(
    data: ZitadelExport,
    realmId: string,
    report: MigrationReport,
    dryRun: boolean,
  ): Promise<void> {
    for (const project of data.projects ?? []) {
      for (const role of project.roles ?? []) {
        try {
          const existing = await this.prisma.role.findFirst({
            where: { realmId, name: role.key, clientId: null },
          });
          if (existing) {
            report.summary.roles.skipped++;
            continue;
          }
          if (!dryRun) {
            await this.prisma.role.create({
              data: {
                realmId,
                name: role.key,
                description: role.displayName,
              },
            });
          }
          report.summary.roles.created++;
        } catch (error: unknown) {
          report.summary.roles.failed++;
          report.errors.push({
            entity: 'role',
            name: role.key,
            error: (error as Error).message,
          });
        }
      }
    }
  }

  private async importClients(
    data: ZitadelExport,
    realmId: string,
    report: MigrationReport,
    dryRun: boolean,
  ): Promise<void> {
    for (const project of data.projects ?? []) {
      for (const app of project.apps ?? []) {
        if (!app.oidcConfig) {
          report.warnings.push({
            entity: 'client',
            message: `App '${app.name ?? app.appId}' has no oidcConfig (likely SAML) — SAML app import isn't supported yet, recreate it manually.`,
          });
          continue;
        }
        try {
          const existing = await this.prisma.client.findFirst({
            where: { realmId, clientId: app.oidcConfig.clientId ?? app.appId },
          });
          if (existing) {
            report.summary.clients.skipped++;
            continue;
          }
          if (!dryRun) {
            const isPublic =
              app.oidcConfig.authMethodType === 'OIDC_AUTH_METHOD_TYPE_NONE';
            await this.prisma.client.create({
              data: {
                realmId,
                clientId: app.oidcConfig.clientId ?? app.appId,
                name: app.name ?? app.appId,
                enabled: true,
                clientType: isPublic ? 'PUBLIC' : 'CONFIDENTIAL',
                clientSecret: app.oidcConfig.clientSecret ?? null,
                redirectUris: app.oidcConfig.redirectUris ?? [],
                webOrigins: [],
                grantTypes: this.mapZitadelGrantTypes(
                  app.oidcConfig.grantTypes ?? [],
                ),
              },
            });
          }
          report.summary.clients.created++;
        } catch (error: unknown) {
          report.summary.clients.failed++;
          report.errors.push({
            entity: 'client',
            name: app.name ?? app.appId,
            error: (error as Error).message,
          });
        }
      }
    }
  }

  private async importUsers(
    data: ZitadelExport,
    realmId: string,
    report: MigrationReport,
    dryRun: boolean,
  ): Promise<void> {
    for (const user of data.users ?? []) {
      if (user.machine) {
        report.warnings.push({
          entity: 'user',
          message: `Machine user '${user.machine.name ?? user.userId}' skipped — recreate it as a service account/NHI in Idenplane instead.`,
        });
        continue;
      }

      const username = user.username ?? user.human?.email?.email ?? user.userId;
      if (!username) {
        report.summary.users.failed++;
        report.errors.push({
          entity: 'user',
          name: 'unknown',
          error: 'No username, email, or userId',
        });
        continue;
      }

      try {
        const existing = await this.prisma.user.findFirst({
          where: { realmId, username },
        });
        if (existing) {
          report.summary.users.skipped++;
          continue;
        }
        if (!dryRun) {
          const { hash, algorithm } = this.extractZitadelPassword(user);
          await this.prisma.user.create({
            data: {
              realmId,
              username,
              email: user.human?.email?.email,
              firstName: user.human?.profile?.givenName,
              lastName: user.human?.profile?.familyName,
              enabled: !INACTIVE_STATES.includes(user.state ?? ''),
              emailVerified: user.human?.email?.isVerified ?? false,
              passwordHash: hash,
              passwordAlgorithm: algorithm,
            },
          });
        }
        report.summary.users.created++;
      } catch (error: unknown) {
        report.summary.users.failed++;
        report.errors.push({
          entity: 'user',
          name: username,
          error: (error as Error).message,
        });
      }
    }
  }

  private extractZitadelPassword(user: ZitadelUser): {
    hash: string | null;
    algorithm: string;
  } {
    const hashed = user.human?.hashedPassword;
    if (hashed?.hash && hashed.algorithm === 'bcrypt') {
      return { hash: hashed.hash, algorithm: 'bcrypt' };
    }
    return { hash: null, algorithm: 'argon2' };
  }

  private async importIdps(
    data: ZitadelExport,
    realmId: string,
    report: MigrationReport,
    dryRun: boolean,
  ): Promise<void> {
    for (const idp of data.idps ?? []) {
      if (!idp.oidcConfig) {
        report.warnings.push({
          entity: 'identity_provider',
          message: `IdP '${idp.name ?? idp.idpId}' (type ${idp.type ?? 'unknown'}) has no oidcConfig — only generic OIDC IdPs are supported for import today, recreate this one manually.`,
        });
        continue;
      }
      try {
        const alias = idp.name ?? idp.idpId;
        const existing = await this.prisma.identityProvider.findFirst({
          where: { realmId, alias },
        });
        if (existing) {
          report.summary.identityProviders.skipped++;
          continue;
        }
        if (!dryRun) {
          await this.prisma.identityProvider.create({
            data: {
              realmId,
              alias,
              displayName: alias,
              providerType: 'OIDC',
              enabled: true,
              trustEmail: false,
              clientId: idp.oidcConfig.clientId ?? '',
              clientSecret: idp.oidcConfig.clientSecret ?? '',
              authorizationUrl: idp.oidcConfig.authorizationEndpoint ?? '',
              tokenUrl: idp.oidcConfig.tokenEndpoint ?? '',
            },
          });
        }
        report.summary.identityProviders.created++;
      } catch (error: unknown) {
        report.summary.identityProviders.failed++;
        report.errors.push({
          entity: 'identity_provider',
          name: idp.name ?? idp.idpId,
          error: (error as Error).message,
        });
      }
    }
  }

  private mapZitadelGrantTypes(grantTypes: string[]): string[] {
    const map: Record<string, string> = {
      OIDC_GRANT_TYPE_AUTHORIZATION_CODE: 'authorization_code',
      OIDC_GRANT_TYPE_IMPLICIT: 'implicit',
      OIDC_GRANT_TYPE_REFRESH_TOKEN: 'refresh_token',
      OIDC_GRANT_TYPE_DEVICE_CODE:
        'urn:ietf:params:oauth:grant-type:device_code',
    };
    return grantTypes.map((g) => map[g] ?? g).filter(Boolean);
  }
}
