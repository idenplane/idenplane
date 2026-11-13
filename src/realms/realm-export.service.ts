import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import {
  EXPORT_MODELS,
  type ModelExportSpec,
  type SecretSpec,
} from './export/realm-export.fields.js';
import { pickFields } from './export/field-codec.js';
import { exportProviderConfig } from './realm-secrets.util.js';

export interface RealmExportOptions {
  includeUsers?: boolean;
  includeSecrets?: boolean;
}

/** The current export format. Imports also accept version 1. */
export const REALM_EXPORT_VERSION = 2;

const spec = EXPORT_MODELS as Record<string, ModelExportSpec>;

type Row = Record<string, unknown>;

interface RoleKey {
  name: string;
  clientId: string | null;
}

/** Deterministic order, so two exports of the same realm compare equal. */
function byKey<T>(key: (item: T) => string) {
  return (a: T, b: T) => {
    const ka = key(a);
    const kb = key(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  };
}
const byJson = byKey<unknown>((item) => JSON.stringify(item));
const roleOrder = byKey<RoleKey>((r) => `${r.clientId ?? ''}\u0000${r.name}`);

@Injectable()
export class RealmExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /** A secret as the export carries it (see SecretKind). */
  private exportSecret(secret: SecretSpec, value: unknown): unknown {
    if (typeof value !== 'string') return value;
    switch (secret.kind) {
      case 'encrypted':
        return this.crypto.decryptSecret(value);
      case 'encrypted-strict':
        // Ciphertext this instance cannot decrypt is useless anywhere: left
        // out, so the import treats the secret as missing.
        try {
          return this.crypto.decrypt(value);
        } catch {
          return undefined;
        }
      default:
        return value;
    }
  }

  /** The allow-listed columns of a row, secrets only when asked for. */
  private pick(model: string, row: Row, includeSecrets: boolean): Row {
    const s = spec[model];
    const out = pickFields(s, row);
    for (const [name, kind] of Object.entries(s.jsonWithSecrets ?? {})) {
      out[name] = exportProviderConfig(
        this.crypto,
        kind,
        row[name],
        includeSecrets,
      );
    }
    if (includeSecrets) {
      for (const [name, secret] of Object.entries(s.secrets ?? {})) {
        const value = this.exportSecret(secret, row[name]);
        if (value !== undefined) out[name] = value;
      }
    }
    return out;
  }

  async exportRealm(realmName: string, options: RealmExportOptions = {}) {
    const includeSecrets = options.includeSecrets === true;
    const includeUsers = options.includeUsers === true;

    const realm = await this.prisma.realm.findUnique({
      where: { name: realmName },
    });
    if (!realm) {
      throw new NotFoundException(`Realm '${realmName}' not found`);
    }
    const realmId = realm.id;
    const where = { realmId };

    const [
      flows,
      scopes,
      allClients,
      roles,
      groups,
      groupRoles,
      idps,
      samlSps,
      federations,
      anchors,
      revoked,
      clientCertificates,
      defaultScopes,
      optionalScopes,
      customAttributes,
      registrationFields,
      organizations,
      webhooks,
      auditStreams,
      policies,
      riskPolicies,
      consentCategories,
      themes,
      scimMappings,
      serviceAccounts,
      nhiPolicies,
      proxyApps,
    ] = await Promise.all([
      this.prisma.authenticationFlow.findMany({ where }),
      this.prisma.clientScope.findMany({
        where,
        include: { protocolMappers: true },
      }),
      this.prisma.client.findMany({ where }),
      this.prisma.role.findMany({ where }),
      this.prisma.group.findMany({ where }),
      this.prisma.groupRole.findMany({ where: { group: { realmId } } }),
      this.prisma.identityProvider.findMany({ where }),
      this.prisma.samlServiceProvider.findMany({ where }),
      this.prisma.userFederation.findMany({
        where,
        include: { mappers: true },
      }),
      this.prisma.realmTlsTrustAnchor.findMany({ where }),
      this.prisma.tlsRevokedCertificate.findMany({ where }),
      this.prisma.clientTlsCertificate.findMany({ where }),
      this.prisma.clientDefaultScope.findMany({
        where: { client: { realmId } },
      }),
      this.prisma.clientOptionalScope.findMany({
        where: { client: { realmId } },
      }),
      this.prisma.customAttribute.findMany({ where }),
      this.prisma.registrationField.findMany({ where }),
      this.prisma.organization.findMany({
        where,
        include: { ssoConnections: true, members: true },
      }),
      this.prisma.webhook.findMany({ where }),
      this.prisma.auditLogStream.findMany({ where }),
      this.prisma.policy.findMany({ where }),
      this.prisma.continuousRiskPolicy.findMany({ where }),
      this.prisma.consentCategory.findMany({
        where,
        include: { policies: true },
      }),
      this.prisma.theme.findMany({ where }),
      this.prisma.scimAttributeMapping.findMany({ where }),
      this.prisma.serviceAccount.findMany({ where }),
      this.prisma.nhiCredentialPolicy.findMany({ where }),
      this.prisma.proxyApplication.findMany({ where }),
    ]);

    // Clients of NHI identities belong to the identity, which is not
    // exported (it is useless without its credentials). They, their roles
    // and anything naming them are left out and listed under "omitted".
    const omitted: Array<{ type: string; key: string; reason: string }> = [];
    const nhiClientIds = new Set<string>();
    for (const c of allClients) {
      if (c.nhiIdentityId) {
        nhiClientIds.add(c.id);
        omitted.push({
          type: 'client',
          key: c.clientId,
          reason:
            'OAuth client of an NHI identity; NHI identities and their credentials are not exported',
        });
      }
    }
    const clients = allClients.filter((c) => !nhiClientIds.has(c.id));

    const clientKey = new Map(allClients.map((c) => [c.id, c.clientId]));
    const scopeName = new Map(scopes.map((s) => [s.id, s.name]));
    const flowName = new Map(flows.map((f) => [f.id, f.name]));
    const groupName = new Map(groups.map((g) => [g.id, g.name]));
    const roleById = new Map(roles.map((r) => [r.id, r]));
    const exportedRole = (roleId: string): RoleKey | undefined => {
      const role = roleById.get(roleId);
      if (!role || (role.clientId && nhiClientIds.has(role.clientId))) {
        return undefined;
      }
      return {
        name: role.name,
        clientId: role.clientId ? (clientKey.get(role.clientId) ?? null) : null,
      };
    };
    const roleList = (roleIds: string[]): RoleKey[] =>
      roleIds
        .map(exportedRole)
        .filter((r): r is RoleKey => !!r)
        .sort(roleOrder);

    // Service-account users travel with their client, with their mappings.
    const serviceAccountIds = clients
      .map((c) => c.serviceAccountUserId)
      .filter((id): id is string => !!id);
    const serviceAccountUsers = serviceAccountIds.length
      ? await this.prisma.user.findMany({
          where: { realmId, id: { in: serviceAccountIds } },
          include: { userRoles: true, userGroups: true },
        })
      : [];
    const serviceAccountById = new Map(
      serviceAccountUsers.map((u) => [u.id, u]),
    );

    const out: Record<string, unknown> = {
      version: REALM_EXPORT_VERSION,
      secretsIncluded: includeSecrets,
      usersIncluded: includeUsers,
    };

    out['realm'] = {
      ...this.pick('Realm', realm, includeSecrets),
      browserFlow: realm.browserFlowId
        ? (flowName.get(realm.browserFlowId) ?? null)
        : null,
    };

    out['authenticationFlows'] = flows
      .map((f) => this.pick('AuthenticationFlow', f, includeSecrets))
      .sort(byKey((f) => f['name'] as string));

    out['clientScopes'] = scopes
      .map((s): Row => ({
        ...this.pick('ClientScope', s, includeSecrets),
        protocolMappers: s.protocolMappers
          .map((m) => this.pick('ProtocolMapper', m, includeSecrets))
          .sort(byKey((m) => m['name'] as string)),
      }))
      .sort(byKey((s) => s['name'] as string));

    out['clients'] = clients
      .map((c): Row => {
        const sa = c.serviceAccountUserId
          ? serviceAccountById.get(c.serviceAccountUserId)
          : undefined;
        return {
          ...this.pick('Client', c, includeSecrets),
          authFlow: c.authFlowId ? (flowName.get(c.authFlowId) ?? null) : null,
          defaultScopes: defaultScopes
            .filter((d) => d.clientId === c.id)
            .map((d) => scopeName.get(d.clientScopeId))
            .filter((n): n is string => !!n)
            .sort(),
          optionalScopes: optionalScopes
            .filter((o) => o.clientId === c.id)
            .map((o) => scopeName.get(o.clientScopeId))
            .filter((n): n is string => !!n)
            .sort(),
          serviceAccount: sa
            ? {
                username: sa.username,
                enabled: sa.enabled,
                roles: roleList(sa.userRoles.map((ur) => ur.roleId)),
                groups: sa.userGroups
                  .map((ug) => groupName.get(ug.groupId))
                  .filter((n): n is string => !!n)
                  .sort(),
              }
            : null,
          tlsCertificates: clientCertificates
            .filter((t) => t.clientId === c.id)
            .map((t) => this.pick('ClientTlsCertificate', t, includeSecrets))
            .sort(byJson),
        };
      })
      .sort(byKey((c) => c['clientId'] as string));

    out['roles'] = roles
      .filter((r) => !(r.clientId && nhiClientIds.has(r.clientId)))
      .map((r): Row => ({
        ...this.pick('Role', r, includeSecrets),
        clientId: r.clientId ? (clientKey.get(r.clientId) ?? null) : null,
      }))
      .sort((a, b) =>
        roleOrder(
          { name: a['name'] as string, clientId: a['clientId'] as string },
          { name: b['name'] as string, clientId: b['clientId'] as string },
        ),
      );

    out['groups'] = groups
      .map((g): Row => ({
        ...this.pick('Group', g, includeSecrets),
        parentName: g.parentId ? (groupName.get(g.parentId) ?? null) : null,
        roles: roleList(
          groupRoles.filter((gr) => gr.groupId === g.id).map((gr) => gr.roleId),
        ),
      }))
      .sort(byKey((g) => g['name'] as string));

    out['identityProviders'] = idps
      .map((i) => this.pick('IdentityProvider', i, includeSecrets))
      .sort(byKey((i) => i['alias'] as string));

    out['samlServiceProviders'] = samlSps
      .map((s) => this.pick('SamlServiceProvider', s, includeSecrets))
      .sort(byKey((s) => s['entityId'] as string));

    out['userFederations'] = federations
      .map((f): Row => ({
        ...this.pick('UserFederation', f, includeSecrets),
        mappers: f.mappers
          .map((m) => this.pick('UserFederationMapper', m, includeSecrets))
          .sort(byKey((m) => m['name'] as string)),
      }))
      .sort(byKey((f) => f['name'] as string));

    out['tlsTrustAnchors'] = anchors
      .map((a) => this.pick('RealmTlsTrustAnchor', a, includeSecrets))
      .sort(byJson);

    out['tlsRevokedCertificates'] = revoked
      .map((r) => this.pick('TlsRevokedCertificate', r, includeSecrets))
      .sort(byJson);

    out['customAttributes'] = customAttributes
      .map((a) => this.pick('CustomAttribute', a, includeSecrets))
      .sort(byKey((a) => a['name'] as string));

    out['registrationFields'] = registrationFields
      .map((f) => this.pick('RegistrationField', f, includeSecrets))
      .sort(byKey((f) => f['name'] as string));

    // Organization members are users: exported only with them.
    let usernameById = new Map<string, string>();
    if (includeUsers) {
      const memberIds = organizations.flatMap((o) =>
        o.members.map((m) => m.userId),
      );
      if (memberIds.length) {
        const members = await this.prisma.user.findMany({
          where: { realmId, id: { in: memberIds } },
          select: { id: true, username: true },
        });
        usernameById = new Map(members.map((u) => [u.id, u.username]));
      }
    }
    out['organizations'] = organizations
      .map((o) => {
        const org: Row = {
          ...this.pick('Organization', o, includeSecrets),
          ssoConnections: o.ssoConnections
            .map((s) =>
              this.pick('OrganizationSsoConnection', s, includeSecrets),
            )
            .sort(byKey((s) => JSON.stringify({ ...s, config: undefined }))),
        };
        if (includeUsers) {
          org['members'] = o.members
            .filter((m) => usernameById.has(m.userId))
            .map((m) => ({
              username: usernameById.get(m.userId),
              ...this.pick('OrganizationMember', m, includeSecrets),
            }))
            .sort(byKey((m) => m['username'] as string));
        }
        return org;
      })
      .sort(byKey((o) => o['slug'] as string));

    // No natural key: ordered by their non-secret content.
    const withoutSecrets = (model: string) => (row: Row) => {
      const copy = { ...row };
      for (const name of Object.keys(spec[model].secrets ?? {})) {
        delete copy[name];
      }
      return JSON.stringify(copy);
    };
    out['webhooks'] = webhooks
      .map((w) => this.pick('Webhook', w, includeSecrets))
      .sort(byKey(withoutSecrets('Webhook')));
    out['auditLogStreams'] = auditStreams
      .map((a) => this.pick('AuditLogStream', a, includeSecrets))
      .sort(byKey(withoutSecrets('AuditLogStream')));
    out['policies'] = policies
      .map((p) => this.pick('Policy', p, includeSecrets))
      .sort(byJson);
    out['continuousRiskPolicies'] = riskPolicies
      .map((p) => this.pick('ContinuousRiskPolicy', p, includeSecrets))
      .sort(byJson);

    out['consentCategories'] = consentCategories
      .map((c): Row => ({
        ...this.pick('ConsentCategory', c, includeSecrets),
        policies: c.policies
          .map((p) => this.pick('ConsentPolicy', p, includeSecrets))
          .sort(byJson),
      }))
      .sort(byKey((c) => c['key'] as string));

    out['themes'] = themes
      .map((t) => this.pick('Theme', t, includeSecrets))
      .sort(byKey((t) => t['name'] as string));

    out['scimAttributeMappings'] = scimMappings
      .map((m) => this.pick('ScimAttributeMapping', m, includeSecrets))
      .sort(
        byKey(
          (m) =>
            `${m['resourceType'] as string}\u0000${m['scimAttribute'] as string}`,
        ),
      );

    out['serviceAccounts'] = serviceAccounts
      .map((s) => this.pick('ServiceAccount', s, includeSecrets))
      .sort(byKey((s) => s['name'] as string));

    out['nhiCredentialPolicies'] = nhiPolicies
      .map((p) => this.pick('NhiCredentialPolicy', p, includeSecrets))
      .sort(byKey((p) => p['name'] as string));

    out['proxyApplications'] = proxyApps
      .filter((p) => !nhiClientIds.has(p.clientId))
      .map((p): Row => ({
        ...this.pick('ProxyApplication', p, includeSecrets),
        client: clientKey.get(p.clientId) ?? null,
      }))
      .sort(byKey((p) => p['slug'] as string));

    if (includeUsers) {
      const saIds = new Set(serviceAccountIds);
      const [users, attributeValues] = await Promise.all([
        this.prisma.user.findMany({
          where: { realmId, id: { notIn: [...saIds] } },
          include: { userRoles: true, userGroups: true },
        }),
        this.prisma.userAttribute.findMany({
          where: { user: { realmId } },
        }),
      ]);
      // A service-account user of an NHI client (none today) or of a client
      // that no longer exists is an ordinary user here.
      const attributeName = new Map(
        customAttributes.map((a) => [a.id, a.name]),
      );
      out['users'] = users
        .map((u): Row => {
          const attributes: Record<string, string> = {};
          for (const v of attributeValues
            .filter((a) => a.userId === u.id)
            .sort(byKey((a) => attributeName.get(a.attributeId) ?? ''))) {
            const name = attributeName.get(v.attributeId);
            if (name) attributes[name] = v.value;
          }
          return {
            ...this.pick('User', u, includeSecrets),
            roles: roleList(u.userRoles.map((ur) => ur.roleId)),
            groups: u.userGroups
              .map((ug) => groupName.get(ug.groupId))
              .filter((n): n is string => !!n)
              .sort(),
            attributes,
          };
        })
        .sort(byKey((u) => u['username'] as string));
    }

    out['omitted'] = omitted.sort(byKey((o) => `${o.type}\u0000${o.key}`));
    return out;
  }
}
