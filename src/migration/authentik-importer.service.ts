import { Injectable } from '@nestjs/common';
import type { CustomAttribute } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import type {
  AuthentikExport,
  AuthentikGroup,
  AuthentikOAuth2Provider,
  AuthentikOAuthSource,
  AuthentikUser,
} from './authentik-types.js';
import { createEmptyReport, type MigrationReport } from './migration-report.js';
import { authentikPassword } from './password-import.js';
import { idpSecrets } from '../identity-providers/idp-secrets.js';
import { unsupportedIdpTypeReason } from '../identity-providers/idp-provider-types.js';
import { idpCreateData, planIdpImport, reportIdpPlan } from './idp-import.js';
import {
  authentikNonPersonReason,
  authentikRedirectUris,
  authentikSourceAlias,
  issuerFromWellKnownUrl,
  normalizeEmail,
  unwrapAuthentikExport,
} from './authentik-export.js';
import { attributeValueProblem } from '../custom-attributes/custom-attributes.service.js';

export interface AuthentikImportOptions {
  dryRun: boolean;
  targetRealm: string;
}

const OIDC_SOURCE_TYPES = new Set(['openidconnect', 'oidc']);

interface GroupIndex {
  /** Idenplane group id by Authentik group pk and by group name. */
  byKey: Map<string, string>;
}

/** Group ids handed out in a dry run: distinct per group, never written. */
const dryRunGroupId = (name: string) => `dry-run-group:${name}`;

function hasEntries(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return (
    typeof value === 'object' && value !== null && Object.keys(value).length > 0
  );
}

@Injectable()
export class AuthentikImporterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async importData(
    input: AuthentikExport | Record<string, unknown>,
    options: AuthentikImportOptions,
  ): Promise<MigrationReport> {
    const report = createEmptyReport('authentik', options.dryRun);
    const data = unwrapAuthentikExport(input as Record<string, unknown>);

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

    const groups = await this.importGroups(
      data.groups,
      realm.id,
      report,
      options.dryRun,
    );
    await this.importClients(data.providers, realm.id, report, options.dryRun);
    await this.importUsers(
      data.users,
      realm.id,
      groups,
      report,
      options.dryRun,
    );
    await this.importSources(
      data.sources,
      realm.id,
      report,
      options.dryRun,
      data.users.length > 0,
    );

    report.completedAt = new Date();
    return report;
  }

  // ─── Groups ────────────────────────────────────────────────────────────

  /**
   * Groups, parents before children. A group whose name already exists in
   * the realm is reused as is (its parent is not changed). A parent that
   * is not in the export leaves the group at the top level, with a warning.
   */
  private async importGroups(
    groups: AuthentikGroup[],
    realmId: string,
    report: MigrationReport,
    dryRun: boolean,
  ): Promise<GroupIndex> {
    const index: GroupIndex = { byKey: new Map() };
    const byPk = new Map<string, AuthentikGroup>();
    for (const g of groups) {
      if (g.pk !== undefined && g.pk !== null) byPk.set(String(g.pk), g);
    }

    for (const group of this.parentsFirst(groups, byPk)) {
      if (typeof group.name !== 'string' || !group.name) {
        report.summary.groups.failed++;
        report.errors.push({
          entity: 'group',
          name: String(group.pk ?? 'unknown'),
          error: 'Group has no name',
        });
        continue;
      }
      this.warnGroupExtras(group, report);
      try {
        const existing = await this.prisma.group.findFirst({
          where: { realmId, name: group.name },
        });
        let id: string;
        if (existing) {
          report.summary.groups.skipped++;
          id = existing.id;
        } else {
          const parentPk =
            group.parent !== undefined && group.parent !== null
              ? String(group.parent)
              : null;
          let parentId: string | null = null;
          if (parentPk !== null) {
            const parent = byPk.get(parentPk);
            parentId = parent
              ? (index.byKey.get(`pk:${parentPk}`) ?? null)
              : null;
            if (!parentId) {
              report.warnings.push({
                entity: 'group',
                message: `Group '${group.name}': its parent group ${parent ? `'${parent.name}' failed to import` : `(pk ${parentPk}) is not in the export`}, so it was imported as a top-level group.`,
              });
            }
          }
          if (dryRun) {
            id = dryRunGroupId(group.name);
          } else {
            const created = await this.prisma.group.create({
              data: {
                realmId,
                name: group.name,
                ...(parentId ? { parentId } : {}),
              },
            });
            id = created.id;
          }
          report.summary.groups.created++;
        }
        index.byKey.set(`name:${group.name}`, id);
        if (group.pk !== undefined && group.pk !== null) {
          index.byKey.set(`pk:${String(group.pk)}`, id);
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
    return index;
  }

  /** Depth-first order so every parent comes before its children; cycles are broken. */
  private parentsFirst(
    groups: AuthentikGroup[],
    byPk: Map<string, AuthentikGroup>,
  ): AuthentikGroup[] {
    const ordered: AuthentikGroup[] = [];
    const state = new Map<AuthentikGroup, 'visiting' | 'done'>();
    const visit = (g: AuthentikGroup) => {
      if (state.get(g)) return;
      state.set(g, 'visiting');
      const parent =
        g.parent !== undefined && g.parent !== null
          ? byPk.get(String(g.parent))
          : undefined;
      if (parent && parent !== g) visit(parent);
      state.set(g, 'done');
      ordered.push(g);
    };
    groups.forEach(visit);
    return ordered;
  }

  private warnGroupExtras(group: AuthentikGroup, report: MigrationReport) {
    const dropped: string[] = [];
    if (group.is_superuser === true) {
      dropped.push(
        'is_superuser (Authentik admin rights; grant Idenplane admin access separately)',
      );
    }
    if (hasEntries(group.roles)) {
      dropped.push(
        `${(group.roles ?? []).length} RBAC role(s) (recreate them as Idenplane roles and assign them to the group)`,
      );
    }
    if (hasEntries(group.attributes)) {
      dropped.push(
        `attributes ${Object.keys(group.attributes ?? {})
          .map((k) => `'${k}'`)
          .join(', ')}`,
      );
    }
    if (dropped.length) {
      report.warnings.push({
        entity: 'group',
        message: `Group '${group.name}': not imported: ${dropped.join('; ')}.`,
      });
    }
  }

  // ─── Clients ───────────────────────────────────────────────────────────

  private async importClients(
    providers: AuthentikOAuth2Provider[],
    realmId: string,
    report: MigrationReport,
    dryRun: boolean,
  ): Promise<void> {
    for (const provider of providers) {
      const label = provider.name || provider.client_id || 'unknown';
      try {
        if (typeof provider.client_id !== 'string' || !provider.client_id) {
          throw new Error('Provider has no client_id');
        }
        const existing = await this.prisma.client.findFirst({
          where: { realmId, clientId: provider.client_id },
        });
        if (existing) {
          report.summary.clients.skipped++;
          continue;
        }

        const redirects = authentikRedirectUris(provider.redirect_uris);
        for (const s of redirects.skipped) {
          report.warnings.push({
            entity: 'client',
            message: `Client '${label}': redirect URI '${s.url}' was not imported: ${s.reason}. Add the exact callback URLs to the client.`,
          });
        }

        const isPublic = provider.client_type === 'public';
        const secret =
          typeof provider.client_secret === 'string' &&
          provider.client_secret !== ''
            ? provider.client_secret
            : null;
        const enabled = isPublic || secret !== null;
        if (!enabled) {
          report.warnings.push({
            entity: 'client',
            message: `Client '${label}' is confidential but has no client secret in the export; it was imported disabled. Regenerate its secret and enable it.`,
          });
        }

        if (!dryRun) {
          await this.prisma.client.create({
            data: {
              realmId,
              clientId: provider.client_id,
              name: provider.name,
              enabled,
              clientType: isPublic ? 'PUBLIC' : 'CONFIDENTIAL',
              clientSecret:
                !isPublic && secret
                  ? await this.crypto.hashSecret(secret)
                  : null,
              redirectUris: redirects.uris,
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
          name: label,
          error: (error as Error).message,
        });
      }
    }
  }

  // ─── Users ─────────────────────────────────────────────────────────────

  private async importUsers(
    users: AuthentikUser[],
    realmId: string,
    groups: GroupIndex,
    report: MigrationReport,
    dryRun: boolean,
  ): Promise<void> {
    if (users.length === 0) return;

    const customAttributes = await this.prisma.customAttribute.findMany({
      where: { realmId },
    });
    const attributeByName = new Map(customAttributes.map((a) => [a.name, a]));
    /** E-mail addresses given to users earlier in this import, to the username. */
    const emailsInImport = new Map<string, string>();

    for (const user of users) {
      const username =
        typeof user.username === 'string' ? user.username : 'unknown';
      const nonPerson = authentikNonPersonReason(user);
      if (nonPerson) {
        report.summary.users.skipped++;
        report.warnings.push({
          entity: 'user',
          message: `User '${username}' was not imported: ${nonPerson}.`,
        });
        continue;
      }

      let userId: string;
      let isNew: boolean;
      try {
        if (!user.username) throw new Error('User has no username');
        const existing = await this.prisma.user.findFirst({
          where: { realmId, username: user.username },
        });
        if (existing) {
          report.summary.users.skipped++;
          userId = existing.id;
          isNew = false;
        } else {
          userId = await this.createUser(
            user,
            realmId,
            report,
            dryRun,
            emailsInImport,
            attributeByName,
          );
          report.summary.users.created++;
          isNew = true;
        }
      } catch (error: unknown) {
        report.summary.users.failed++;
        report.errors.push({
          entity: 'user',
          name: username,
          error: (error as Error).message,
        });
        continue;
      }

      await this.addMemberships(user, userId, isNew, groups, report, dryRun);
    }

    report.warnings.push({
      entity: 'user',
      message:
        'MFA devices (TOTP, WebAuthn, static codes, Duo, SMS) are not in the Authentik API export and were not imported; users who had one must enrol again.',
    });
  }

  /** Creates one user (or, in a dry run, checks it) and returns its id. */
  private async createUser(
    user: AuthentikUser,
    realmId: string,
    report: MigrationReport,
    dryRun: boolean,
    emailsInImport: Map<string, string>,
    attributeByName: Map<string, CustomAttribute>,
  ): Promise<string> {
    const { hash, algorithm, warning } = authentikPassword(user.password);
    if (warning) {
      report.warnings.push({
        entity: 'user',
        message: `User '${user.username}': ${warning}`,
      });
    }

    const email = await this.uniqueEmail(user, realmId, report, emailsInImport);

    const [firstName, ...rest] = (user.name ?? '').split(' ').filter(Boolean);
    const lastName = rest.join(' ') || undefined;

    const attributes = this.importableAttributes(user, attributeByName, report);

    let userId = `dry-run-user:${user.username}`;
    if (!dryRun) {
      const created = await this.prisma.user.create({
        data: {
          realmId,
          username: user.username,
          email,
          firstName,
          lastName,
          enabled: user.is_active ?? true,
          emailVerified: false,
          passwordHash: hash,
          passwordAlgorithm: algorithm,
          ...(attributes.length ? { attributes: { create: attributes } } : {}),
        },
      });
      userId = created.id;
    }
    if (email) emailsInImport.set(email, user.username);
    return userId;
  }

  /**
   * The e-mail address to store for a new user: null for none (Authentik's
   * `""`), and null with a warning when another user (in the realm, or
   * earlier in this import) already has it, since an address belongs to
   * one user per realm. Checked the same way in a dry run.
   */
  private async uniqueEmail(
    user: AuthentikUser,
    realmId: string,
    report: MigrationReport,
    emailsInImport: Map<string, string>,
  ): Promise<string | null> {
    const email = normalizeEmail(user.email);
    if (!email) return null;
    let holder = emailsInImport.get(email);
    if (!holder) {
      const other = await this.prisma.user.findFirst({
        where: { realmId, email },
        select: { username: true },
      });
      holder = other?.username;
    }
    if (!holder) return email;
    report.warnings.push({
      entity: 'user',
      message: `User '${user.username}': e-mail address ${email} already belongs to user '${holder}'; imported without an e-mail address. Resolve the duplicate and set it.`,
    });
    return null;
  }

  /**
   * Authentik attributes that match a custom attribute defined in the
   * realm, with a scalar value the attribute accepts. Every other
   * attribute is named in one warning.
   */
  private importableAttributes(
    user: AuthentikUser,
    attributeByName: Map<string, CustomAttribute>,
    report: MigrationReport,
  ): { attributeId: string; value: string }[] {
    const attrs = user.attributes;
    if (!attrs || typeof attrs !== 'object') return [];
    const imported: { attributeId: string; value: string }[] = [];
    const dropped: string[] = [];
    for (const [name, raw] of Object.entries(attrs)) {
      const definition = attributeByName.get(name);
      const scalar =
        typeof raw === 'string' ||
        typeof raw === 'number' ||
        typeof raw === 'boolean';
      if (!definition) {
        dropped.push(
          `'${name}' (no custom attribute of that name in the realm)`,
        );
        continue;
      }
      if (!scalar) {
        dropped.push(`'${name}' (not a single value)`);
        continue;
      }
      const value = String(raw);
      const problem = attributeValueProblem(
        definition.type,
        value,
        definition.displayName,
        Array.isArray(definition.options)
          ? (definition.options as string[])
          : null,
      );
      if (problem) {
        dropped.push(`'${name}' (${problem})`);
        continue;
      }
      imported.push({ attributeId: definition.id, value });
    }
    if (dropped.length) {
      report.warnings.push({
        entity: 'user',
        message: `User '${user.username}': attributes not imported: ${dropped.join(', ')}.`,
      });
    }
    return imported;
  }

  /**
   * Adds the user's group memberships from the export, for new users and
   * users that already exist alike. Only adds: a membership the user has
   * in Idenplane and not in Authentik is kept. A failure here is reported
   * on its own and does not count the user as failed.
   */
  private async addMemberships(
    user: AuthentikUser,
    userId: string,
    isNew: boolean,
    groups: GroupIndex,
    report: MigrationReport,
    dryRun: boolean,
  ): Promise<void> {
    const groupIds = new Set<string>();
    for (const ref of user.groups ?? []) {
      const key = String(ref);
      const groupId =
        groups.byKey.get(`pk:${key}`) ?? groups.byKey.get(`name:${key}`);
      if (!groupId) {
        report.warnings.push({
          entity: 'user',
          message: `User '${user.username}' references group '${key}', which was not in the export — skipped that membership.`,
        });
        continue;
      }
      groupIds.add(groupId);
    }
    if (groupIds.size === 0) return;

    try {
      let toAdd = [...groupIds];
      if (!isNew) {
        const current = await this.prisma.userGroup.findMany({
          where: { userId, groupId: { in: toAdd } },
          select: { groupId: true },
        });
        const have = new Set(current.map((m) => m.groupId));
        toAdd = toAdd.filter((id) => !have.has(id));
      }
      if (toAdd.length === 0) return;
      if (!dryRun) {
        await this.prisma.userGroup.createMany({
          data: toAdd.map((groupId) => ({ userId, groupId })),
          skipDuplicates: true,
        });
      }
      if (!isNew) {
        report.warnings.push({
          entity: 'user',
          message: `User '${user.username}' already existed and was not changed, except: ${dryRun ? 'would add' : 'added'} ${toAdd.length} group membership(s) from the export (existing memberships are kept).`,
        });
      }
    } catch (error: unknown) {
      report.errors.push({
        entity: 'group_membership',
        name: user.username,
        error: `Group memberships not added: ${(error as Error).message}`,
      });
    }
  }

  // ─── Identity providers ────────────────────────────────────────────────

  private async importSources(
    sources: AuthentikOAuthSource[],
    realmId: string,
    report: MigrationReport,
    dryRun: boolean,
    hasUsers: boolean,
  ): Promise<void> {
    let imported = 0;
    for (const source of sources) {
      const label =
        source.name || source.slug || String(source.pk ?? 'unknown');
      if (!OIDC_SOURCE_TYPES.has((source.provider_type ?? '').toLowerCase())) {
        report.summary.identityProviders.skipped++;
        report.warnings.push({
          entity: 'identity_provider',
          message: `Identity provider '${label}' was not imported: ${
            /saml/i.test(source.provider_type ?? '')
              ? unsupportedIdpTypeReason(source.provider_type)
              : `source type ${source.provider_type ?? 'unknown'} is not a generic OIDC source; only OIDC sources can be imported, recreate this one manually.`
          }`,
        });
        continue;
      }
      const alias = authentikSourceAlias(source);
      if (!alias) {
        report.summary.identityProviders.skipped++;
        report.warnings.push({
          entity: 'identity_provider',
          message: `Identity provider '${label}' was not imported: neither its slug nor its name gives an alias of lowercase letters, digits and hyphens.`,
        });
        continue;
      }
      const plan = planIdpImport({
        alias,
        providerType: 'oidc',
        fields: {
          clientId: source.consumer_key,
          clientSecret: source.consumer_secret,
          authorizationUrl: source.authorization_url,
          tokenUrl: source.access_token_url,
          userinfoUrl: source.profile_url,
          jwksUrl: source.oidc_jwks_url,
          issuer: issuerFromWellKnownUrl(source.oidc_well_known_url),
        },
      });
      if (!reportIdpPlan(report, alias, plan)) continue;
      try {
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
              displayName: source.name || alias,
              trustEmail: false,
              ...idpCreateData(plan, (secret) =>
                idpSecrets.forCreate(this.crypto, secret),
              ),
            },
          });
        }
        report.summary.identityProviders.created++;
        imported++;
      } catch (error: unknown) {
        report.summary.identityProviders.failed++;
        report.errors.push({
          entity: 'identity_provider',
          name: alias,
          error: (error as Error).message,
        });
      }
    }
    if (imported > 0 && hasUsers) {
      report.warnings.push({
        entity: 'identity_provider',
        message:
          "Links between users and their source accounts are not in the Authentik API export and were not imported. With trustEmail off (the default for imported providers), a migrated user's first sign-in through a provider creates a second account; turn trustEmail on for providers whose verified e-mail addresses you trust.",
      });
    }
  }
}
