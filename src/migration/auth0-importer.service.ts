import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import type { Auth0Export } from './auth0-types.js';
import { createEmptyReport, type MigrationReport } from './migration-report.js';
import { auth0Password } from './password-import.js';
import { idpSecrets } from '../identity-providers/idp-secrets.js';
import { idpCreateData, planIdpImport, reportIdpPlan } from './idp-import.js';

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
        message: `${data.organizations.length} Auth0 organizations found. Use Idenplane's Organization module to recreate them.`,
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
            ? await this.crypto.hashSecret(client.client_secret)
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
      } catch (error: unknown) {
        report.summary.clients.failed++;
        report.errors.push({
          entity: 'client',
          name: client.client_id,
          error: (error as Error).message,
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
        const { hash, algorithm, warning } = auth0Password(user);
        if (warning) {
          report.warnings.push({
            entity: 'user',
            message: `User '${username}': ${warning}`,
          });
        }
        if (!dryRun) {
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
      const opts: Record<string, unknown> = conn.options ?? {};
      const str = (key: string) =>
        typeof opts[key] === 'string' ? opts[key] : undefined;
      const mapped = this.mapAuth0Strategy(conn.strategy);
      const plan = planIdpImport({
        alias: conn.name,
        providerType: mapped?.providerType ?? conn.strategy,
        wellKnown: mapped?.wellKnown,
        fields: {
          clientId: str('client_id'),
          clientSecret: str('client_secret'),
          // OIDC connections name them like OIDC discovery; custom OAuth2
          // connections use authorizationURL / tokenURL.
          authorizationUrl:
            str('authorization_endpoint') ?? str('authorizationURL'),
          tokenUrl: str('token_endpoint') ?? str('tokenURL'),
          userinfoUrl: str('userinfo_endpoint'),
          jwksUrl: str('jwks_uri'),
          issuer: str('issuer'),
          defaultScopes: str('scope'),
        },
      });
      if (!reportIdpPlan(report, conn.name, plan)) continue;
      try {
        const existing = await this.prisma.identityProvider.findFirst({
          where: { realmId, alias: conn.name },
        });
        if (existing) {
          report.summary.identityProviders.skipped++;
          continue;
        }
        if (!dryRun) {
          await this.prisma.identityProvider.create({
            data: {
              realmId,
              alias: conn.name,
              displayName: conn.name,
              trustEmail: false,
              ...idpCreateData(plan, (secret) =>
                idpSecrets.forCreate(this.crypto, secret),
              ),
            },
          });
        }
        report.summary.identityProviders.created++;
      } catch (error: unknown) {
        report.summary.identityProviders.failed++;
        report.errors.push({
          entity: 'identity_provider',
          name: conn.name,
          error: (error as Error).message,
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

  /**
   * The Idenplane provider type of an Auth0 connection strategy, with the
   * well-known endpoints of social connections whose options carry no URLs.
   * Null for a strategy Idenplane cannot broker: SAML and WS-Federation
   * (`samlp`, `adfs`, `waad`, ...), passwordless and directory connections,
   * and social connections whose endpoints it does not know.
   */
  private mapAuth0Strategy(strategy: string): {
    providerType: string;
    wellKnown?: 'google' | 'github' | 'microsoft';
  } | null {
    switch (strategy) {
      case 'oidc':
        return { providerType: 'oidc' };
      case 'oauth2':
        return { providerType: 'oauth2' };
      case 'google-oauth2':
        return { providerType: 'oidc', wellKnown: 'google' };
      case 'windowslive':
        return { providerType: 'oidc', wellKnown: 'microsoft' };
      case 'github':
        return { providerType: 'oauth2', wellKnown: 'github' };
      default:
        return null;
    }
  }
}
