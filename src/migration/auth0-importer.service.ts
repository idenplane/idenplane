import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import type { Auth0Export, Auth0User, Auth0Client } from './auth0-types.js';
import { createEmptyReport, type MigrationReport } from './migration-report.js';

export interface Auth0ImportOptions {
  dryRun: boolean;
  targetRealm: string;
}

@Injectable()
export class Auth0ImporterService {
  private readonly logger = new Logger(Auth0ImporterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async importData(
    data: Auth0Export,
    options: Auth0ImportOptions,
  ): Promise<MigrationReport> {
    const report = createEmptyReport('auth0', options.dryRun);

    // Verify realm exists
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

    // 1. Import roles
    await this.importRoles(data, realm.id, report, options.dryRun);

    // 2. Import clients
    await this.importClients(data, realm.id, report, options.dryRun);

    // 3. Import users
    await this.importUsers(data, realm.id, report, options.dryRun);

    // 4. Import connections as identity providers
    await this.importConnections(data, realm.id, report, options.dryRun);

    // 5. Warn about non-migratable features
    if (data.organizations?.length) {
      report.warnings.push({
        entity: 'organizations',
        message: `${data.organizations.length} Auth0 organizations found. Use AuthMe's Organization module to recreate them.`,
      });
    }

    report.completedAt = new Date();
    return report;
  }

  private async importRoles(
    data: Auth0Export,
    realmId: string,
    report: MigrationReport,
    dryRun: boolean,
  ): Promise<void> {
    for (const role of data.roles ?? []) {
      try {
        const existing = await this.prisma.role.findFirst({
          where: { realmId, name: role.name, clientId: null },
        });
        if (existing) {
          report.summary.roles.skipped++;
          continue;
        }
        if (!dryRun) {
          await this.prisma.role.create({
            data: { realmId, name: role.name, description: role.description },
          });
        }
        report.summary.roles.created++;
      } catch (error: any) {
        report.summary.roles.failed++;
        report.errors.push({
          entity: 'role',
          name: role.name,
          error: error.message,
        });
      }
    }
  }

  private async importClients(
    data: Auth0Export,
    realmId: string,
    report: MigrationReport,
    dryRun: boolean,
  ): Promise<void> {
    for (const client of data.clients ?? []) {
      try {
        const existing = await this.prisma.client.findFirst({
          where: { realmId, clientId: client.client_id },
        });
        if (existing) {
          report.summary.clients.skipped++;
          continue;
        }
        if (!dryRun) {
          const isPublic = client.token_endpoint_auth_method === 'none';
          const grantTypes = this.mapAuth0GrantTypes(client.grant_types ?? []);
          const secretHash = client.client_secret
            ? await this.crypto.hashPassword(client.client_secret)
            : null;

          await this.prisma.client.create({
            data: {
              realmId,
              clientId: client.client_id,
              name: client.name,
              enabled: true,
              clientType: isPublic ? 'PUBLIC' : 'CONFIDENTIAL',
              clientSecret: secretHash,
              redirectUris: client.callbacks ?? [],
              webOrigins: (client.allowed_origins ?? []).filter((o: string) => {
                if (o === '*') {
                  this.logger.warn(
                    `Auth0 client '${client.client_id}' has a wildcard webOrigin "*" — ` +
                      'it has been stripped during import. ' +
                      'Update the client to use explicit origins.',
                  );
                  return false;
                }
                return true;
              }),
              grantTypes,
            },
          });
        }
        report.summary.clients.created++;
      } catch (error: any) {
        report.summary.clients.failed++;
        report.errors.push({
          entity: 'client',
          name: client.client_id,
          error: error.message,
        });
      }
    }
  }

  private async importUsers(
    data: Auth0Export,
    realmId: string,
    report: MigrationReport,
    dryRun: boolean,
  ): Promise<void> {
    for (const user of data.users ?? []) {
      const username = user.username ?? user.email ?? user.user_id;
      if (!username) {
        report.summary.users.failed++;
        report.errors.push({
          entity: 'user',
          name: 'unknown',
          error: 'No username, email, or user_id',
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
          const { hash, algorithm } = this.extractAuth0Password(user);
          await this.prisma.user.create({
            data: {
              realmId,
              username,
              email: user.email,
              firstName: user.given_name,
              lastName: user.family_name,
              enabled: !(user.blocked ?? false),
              emailVerified: user.email_verified ?? false,
              passwordHash: hash,
              passwordAlgorithm: algorithm,
            },
          });
        }
        report.summary.users.created++;
      } catch (error: any) {
        report.summary.users.failed++;
        report.errors.push({
          entity: 'user',
          name: username,
          error: error.message,
        });
      }
    }
  }

  private extractAuth0Password(user: Auth0User): {
    hash: string | null;
    algorithm: string;
  } {
    // Auth0 exports bcrypt hashes in password_hash field
    if (user.password_hash) {
      return { hash: user.password_hash, algorithm: 'bcrypt' };
    }
    // Custom password hash format
    if (user.custom_password_hash) {
      const cph = user.custom_password_hash;
      if (cph.algorithm === 'bcrypt') {
        return { hash: cph.hash.value, algorithm: 'bcrypt' };
      }
    }
    return { hash: null, algorithm: 'argon2' };
  }

  private async importConnections(
    data: Auth0Export,
    realmId: string,
    report: MigrationReport,
    dryRun: boolean,
  ): Promise<void> {
    for (const conn of data.connections ?? []) {
      // Only import social/enterprise connections as IdPs
      if (conn.strategy === 'auth0') {
        report.warnings.push({
          entity: 'connection',
          message: `Database connection '${conn.name}' skipped — Auth0 DB connections don't map to identity providers`,
        });
        continue;
      }
      try {
        const existing = await this.prisma.identityProvider.findFirst({
          where: { realmId, alias: conn.name },
        });
        if (existing) {
          report.summary.identityProviders.skipped++;
          continue;
        }
        if (!dryRun) {
          const providerType = this.mapAuth0Strategy(conn.strategy);
          const opts = conn.options as Record<string, string> | undefined;
          await this.prisma.identityProvider.create({
            data: {
              realmId,
              alias: conn.name,
              displayName: conn.name,
              providerType,
              enabled: true,
              trustEmail: false,
              clientId: opts?.client_id ?? '',
              clientSecret: opts?.client_secret ?? '',
              authorizationUrl: opts?.authorization_endpoint ?? '',
              tokenUrl: opts?.token_endpoint ?? '',
            },
          });
        }
        report.summary.identityProviders.created++;
      } catch (error: any) {
        report.summary.identityProviders.failed++;
        report.errors.push({
          entity: 'identity_provider',
          name: conn.name,
          error: error.message,
        });
      }
    }
  }

  private mapAuth0GrantTypes(grantTypes: string[]): string[] {
    const map: Record<string, string> = {
      authorization_code: 'authorization_code',
      client_credentials: 'client_credentials',
      password: 'password',
      refresh_token: 'refresh_token',
      'urn:ietf:params:oauth:grant-type:device_code':
        'urn:ietf:params:oauth:grant-type:device_code',
    };
    return grantTypes.map((g) => map[g] ?? g).filter(Boolean);
  }

  private mapAuth0Strategy(strategy: string): string {
    const oidcStrategies = [
      'google-oauth2',
      'github',
      'facebook',
      'microsoft',
      'apple',
      'linkedin',
      'twitter',
    ];
    if (oidcStrategies.includes(strategy) || strategy.startsWith('oauth2'))
      return 'OIDC';
    if (strategy === 'samlp' || strategy === 'adfs') return 'SAML';
    return 'OIDC';
  }
}
