import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthentikExport, AuthentikUser } from './authentik-types.js';
import { createEmptyReport, type MigrationReport } from './migration-report.js';

export interface AuthentikImportOptions {
  dryRun: boolean;
  targetRealm: string;
}

const OIDC_SOURCE_TYPES = new Set(['openidconnect', 'oidc']);

@Injectable()
export class AuthentikImporterService {
  private readonly logger = new Logger(AuthentikImporterService.name);

  constructor(private readonly prisma: PrismaService) {}

  async importData(
    data: AuthentikExport,
    options: AuthentikImportOptions,
  ): Promise<MigrationReport> {
    const report = createEmptyReport('authentik', options.dryRun);

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

    const groupIdsByName = await this.importGroups(
      data,
      realm.id,
      report,
      options.dryRun,
    );
    await this.importClients(data, realm.id, report, options.dryRun);
    await this.importUsers(
      data,
      realm.id,
      groupIdsByName,
      report,
      options.dryRun,
    );
    await this.importSources(data, realm.id, report, options.dryRun);

    report.completedAt = new Date();
    return report;
  }

  private async importGroups(
    data: AuthentikExport,
    realmId: string,
    report: MigrationReport,
    dryRun: boolean,
  ): Promise<Map<string, string>> {
    const idsByName = new Map<string, string>();
    for (const group of data.groups ?? []) {
      try {
        const existing = await this.prisma.group.findFirst({
          where: { realmId, name: group.name, parentId: null },
        });
        if (existing) {
          report.summary.groups.skipped++;
          idsByName.set(group.name, existing.id);
          continue;
        }
        if (dryRun) {
          idsByName.set(group.name, 'dry-run-group-id');
        } else {
          const created = await this.prisma.group.create({
            data: { realmId, name: group.name },
          });
          idsByName.set(group.name, created.id);
        }
        report.summary.groups.created++;
      } catch (error: unknown) {
        report.summary.groups.failed++;
        report.errors.push({
          entity: 'group',
          name: group.name,
          error: (error as Error).message,
        });
      }
    }
    return idsByName;
  }

  private async importClients(
    data: AuthentikExport,
    realmId: string,
    report: MigrationReport,
    dryRun: boolean,
  ): Promise<void> {
    for (const provider of data.providers ?? []) {
      try {
        const existing = await this.prisma.client.findFirst({
          where: { realmId, clientId: provider.client_id },
        });
        if (existing) {
          report.summary.clients.skipped++;
          continue;
        }
        if (!dryRun) {
          await this.prisma.client.create({
            data: {
              realmId,
              clientId: provider.client_id,
              name: provider.name,
              enabled: true,
              clientType:
                provider.client_type === 'public' ? 'PUBLIC' : 'CONFIDENTIAL',
              clientSecret: provider.client_secret ?? null,
              redirectUris: provider.redirect_uris ?? [],
              webOrigins: [],
              grantTypes: ['authorization_code', 'refresh_token'],
            },
          });
        }
        report.summary.clients.created++;
      } catch (error: unknown) {
        report.summary.clients.failed++;
        report.errors.push({
          entity: 'client',
          name: provider.name,
          error: (error as Error).message,
        });
      }
    }
  }

  private async importUsers(
    data: AuthentikExport,
    realmId: string,
    groupIdsByName: Map<string, string>,
    report: MigrationReport,
    dryRun: boolean,
  ): Promise<void> {
    for (const user of data.users ?? []) {
      try {
        const existing = await this.prisma.user.findFirst({
          where: { realmId, username: user.username },
        });
        if (existing) {
          report.summary.users.skipped++;
          continue;
        }

        const { hash, algorithm } = this.extractAuthentikPassword(user);
        const [firstName, ...rest] = (user.name ?? '')
          .split(' ')
          .filter(Boolean);
        const lastName = rest.join(' ') || undefined;

        let userId = 'dry-run-user-id';
        if (!dryRun) {
          const created = await this.prisma.user.create({
            data: {
              realmId,
              username: user.username,
              email: user.email,
              firstName,
              lastName,
              enabled: user.is_active ?? true,
              emailVerified: false,
              passwordHash: hash,
              passwordAlgorithm: algorithm,
            },
          });
          userId = created.id;
        }
        report.summary.users.created++;

        for (const groupName of user.groups ?? []) {
          const groupId = groupIdsByName.get(groupName);
          if (!groupId) {
            report.warnings.push({
              entity: 'user',
              message: `User '${user.username}' references group '${groupName}', which was not in the export — skipped that membership.`,
            });
            continue;
          }
          if (!dryRun) {
            await this.prisma.userGroup.create({
              data: { userId, groupId },
            });
          }
        }
      } catch (error: unknown) {
        report.summary.users.failed++;
        report.errors.push({
          entity: 'user',
          name: user.username,
          error: (error as Error).message,
        });
      }
    }
  }

  /**
   * Authentik stores passwords in Django's hasher format. Only the two most
   * common hashers are translated into a form Idenplane's login fallback
   * (PasswordMigrationService) can verify directly — anything else (e.g.
   * bcrypt via a custom hasher) is dropped with no password, same policy
   * the other importers use for hashes they can't carry over.
   */
  private extractAuthentikPassword(user: AuthentikUser): {
    hash: string | null;
    algorithm: string;
  } {
    const raw = user.password;
    if (!raw) return { hash: null, algorithm: 'argon2' };

    // Django's ArgonPasswordHasher: "argon2" + the standard PHC-encoded
    // string (which itself starts with "$argon2id$..."). Strip the literal
    // "argon2" prefix to recover the PHC string Idenplane's own argon2
    // verifier expects.
    if (raw.startsWith('argon2$argon2')) {
      return { hash: raw.slice('argon2'.length), algorithm: 'argon2' };
    }

    // Django's PBKDF2PasswordHasher: "pbkdf2_sha256$<iterations>$<salt>$<hash>",
    // where <salt> is a plain string and <hash> is already base64. Idenplane's
    // pbkdf2-sha256 verifier expects "<iterations>$<base64 salt>$<base64 hash>"
    // (both base64) — re-encode the salt to match.
    if (raw.startsWith('pbkdf2_sha256$')) {
      const parts = raw.split('$');
      if (parts.length === 4) {
        const [, iterations, saltPlain, hashB64] = parts;
        const saltBase64 = Buffer.from(saltPlain, 'utf8').toString('base64');
        return {
          hash: `${iterations}$${saltBase64}$${hashB64}`,
          algorithm: 'pbkdf2-sha256',
        };
      }
    }

    return { hash: null, algorithm: 'argon2' };
  }

  private async importSources(
    data: AuthentikExport,
    realmId: string,
    report: MigrationReport,
    dryRun: boolean,
  ): Promise<void> {
    for (const source of data.sources ?? []) {
      if (!OIDC_SOURCE_TYPES.has((source.provider_type ?? '').toLowerCase())) {
        report.warnings.push({
          entity: 'identity_provider',
          message: `Source '${source.name}' (type ${source.provider_type ?? 'unknown'}) is not a generic OIDC source — only OIDC sources are supported for import today, recreate this one manually.`,
        });
        continue;
      }
      try {
        const existing = await this.prisma.identityProvider.findFirst({
          where: { realmId, alias: source.name },
        });
        if (existing) {
          report.summary.identityProviders.skipped++;
          continue;
        }
        if (!dryRun) {
          await this.prisma.identityProvider.create({
            data: {
              realmId,
              alias: source.name,
              displayName: source.name,
              providerType: 'OIDC',
              enabled: true,
              trustEmail: false,
              clientId: source.consumer_key ?? '',
              clientSecret: source.consumer_secret ?? '',
              authorizationUrl: source.authorization_url ?? '',
              tokenUrl: source.access_token_url ?? '',
            },
          });
        }
        report.summary.identityProviders.created++;
      } catch (error: unknown) {
        report.summary.identityProviders.failed++;
        report.errors.push({
          entity: 'identity_provider',
          name: source.name,
          error: (error as Error).message,
        });
      }
    }
  }
}
