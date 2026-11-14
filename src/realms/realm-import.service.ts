import {
  Injectable,
  BadRequestException,
  ConflictException,
  HttpException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { JwkService } from '../crypto/jwk.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { CacheService } from '../cache/cache.service.js';
import { CorsOriginService } from '../cors/cors-origin.service.js';
import { seedDefaultScopesIn } from '../scopes/scope-seed.service.js';
import {
  EXPORT_MODELS,
  type ModelExportSpec,
} from './export/realm-export.fields.js';
import {
  createData,
  isRecord,
  type FieldProblem,
} from './export/field-codec.js';
import {
  validateV2Import,
  type RoleRef,
  type ValidatedImport,
} from './export/realm-import.validator.js';
import { importV1, v1Clients } from './export/realm-import.v1.js';
import {
  encryptEmailProviderConfig,
  encryptSmsProviderConfig,
} from './realm-secrets.util.js';
import { MASTER_REALM } from './realm.constants.js';
import { signingKeySecrets } from '../crypto/signing-key-secrets.js';
import { idpSecrets } from '../identity-providers/idp-secrets.js';
import { federationSecrets } from '../user-federation/federation-secrets.js';
import { STREAM_HEADERS_SHAPE } from '../events/audit-stream-secrets.js';
import { SSO_CONFIG_SHAPE } from '../organizations/sso-connection-secrets.js';
import { sealSecretJson } from '../crypto/stored-secrets.js';

export interface ImportOptions {
  overwrite?: boolean;
}

type Item = Record<string, unknown>;
type Tx = Prisma.TransactionClient;

const spec = EXPORT_MODELS as Record<string, ModelExportSpec>;

/**
 * An import runs in one transaction. Large realms (many users) take a while,
 * so the interactive transaction gets far more than Prisma's 5s default.
 */
const TRANSACTION_TIMEOUT_MS = 10 * 60_000;
const TRANSACTION_MAX_WAIT_MS = 30_000;

/** At most this many problems are spelled out in the 400 message. */
const PROBLEMS_IN_MESSAGE = 5;

function invalid(problems: FieldProblem[]): BadRequestException {
  const shown = problems
    .slice(0, PROBLEMS_IN_MESSAGE)
    .map((p) => `${p.path}: ${p.message}`)
    .join('; ');
  const more =
    problems.length > PROBLEMS_IN_MESSAGE
      ? ` (and ${problems.length - PROBLEMS_IN_MESSAGE} more)`
      : '';
  return new BadRequestException({
    message: `Invalid realm import: ${shown}${more}`,
    error: 'Bad Request',
    errors: problems,
  });
}

/** The array under `key` (validation already checked its shape). */
function items(holder: Item, key: string): Item[] {
  const value = holder[key];
  return Array.isArray(value) ? (value as Item[]) : [];
}

const roleKey = (r: RoleRef) => `${r.clientId ?? ''}\u0000${r.name}`;

/** Which format a payload's `version` names. */
function formatOf(version: unknown): 1 | 2 | undefined {
  if (version === 2 || version === '2' || version === '2.0') return 2;
  if (version === 1) return 1;
  if (
    typeof version === 'string' &&
    (version === '1' || version.startsWith('1.'))
  ) {
    return 1;
  }
  return undefined;
}

@Injectable()
export class RealmImportService {
  private readonly logger = new Logger(RealmImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwkService: JwkService,
    private readonly crypto: CryptoService,
    private readonly cache: CacheService,
    private readonly corsOrigins: CorsOriginService,
  ) {}

  /**
   * An export made with includeSecrets carries each client's stored hash, so
   * a hash is kept as it is (the client's secret keeps working). Anything
   * else is a plaintext secret written by hand, and is hashed like any other.
   */
  private async importedClientSecret(value?: unknown) {
    if (typeof value !== 'string' || !value) return null;
    return this.crypto.isSecretHash(value)
      ? value
      : this.crypto.hashSecret(value);
  }

  async importRealm(
    payload: Record<string, unknown>,
    options: ImportOptions = {},
  ) {
    if (!isRecord(payload) || !payload['version'] || !payload['realm']) {
      throw new BadRequestException(
        'Invalid import format: missing version or realm',
      );
    }
    const format = formatOf(payload['version']);
    if (!format) {
      throw new BadRequestException(
        `Unsupported export version ${JSON.stringify(payload['version'])}; this server reads versions 1 and 2`,
      );
    }
    const realmData = payload['realm'];
    if (!isRecord(realmData) || !realmData['name']) {
      throw new BadRequestException(
        'Invalid import format: realm name is required',
      );
    }
    if (typeof realmData['name'] !== 'string') {
      throw invalid([{ path: 'realm.name', message: 'must be a string' }]);
    }
    const realmName = realmData['name'];

    const existing = await this.prisma.realm.findUnique({
      where: { name: realmName },
      select: { id: true },
    });
    if (existing && !options.overwrite) {
      throw new ConflictException(
        `Realm '${realmName}' already exists. Use overwrite option to replace it.`,
      );
    }
    if (existing && realmName === MASTER_REALM) {
      throw new BadRequestException(
        'The master realm holds the administrators and cannot be replaced by an import.',
      );
    }

    return format === 1
      ? this.importV1(payload, realmName, options)
      : this.importV2(payload, realmName, options);
  }

  // ─── Transaction ───────────────────────────────────────────────────────

  /**
   * Run `write` in one transaction. With overwrite, the old realm is deleted
   * inside it, so a failed import leaves the old realm as it was.
   */
  private async inTransaction<T>(
    realmName: string,
    options: ImportOptions,
    write: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    let replacedId: string | undefined;
    let result: T;
    try {
      result = await this.prisma.$transaction(
        async (tx) => {
          const existing = await tx.realm.findUnique({
            where: { name: realmName },
            select: { id: true },
          });
          if (existing) {
            if (!options.overwrite) {
              throw new ConflictException(
                `Realm '${realmName}' already exists. Use overwrite option to replace it.`,
              );
            }
            // Realm-admin assignments are instance access control, not realm
            // data: they survive the replacement instead of cascading away.
            const admins = await tx.adminRealmAssignment.findMany({
              where: { realmId: existing.id },
              select: { userId: true, createdBy: true },
            });
            await tx.realm.delete({ where: { id: existing.id } });
            replacedId = existing.id;
            const out = await write(tx);
            if (admins.length > 0) {
              const replacement = await tx.realm.findUnique({
                where: { name: realmName },
                select: { id: true },
              });
              if (replacement) {
                await tx.adminRealmAssignment.createMany({
                  data: admins.map((a) => ({
                    userId: a.userId,
                    realmId: replacement.id,
                    createdBy: a.createdBy,
                  })),
                  skipDuplicates: true,
                });
              }
            }
            return out;
          }
          return write(tx);
        },
        { timeout: TRANSACTION_TIMEOUT_MS, maxWait: TRANSACTION_MAX_WAIT_MS },
      );
    } catch (err) {
      throw this.importError(err);
    }

    // The old realm's cached rows (by name and id) must not outlive it, and
    // the new clients' origins must reach the CORS allow-list.
    await Promise.all([
      replacedId
        ? this.cache.invalidateRealmCache(replacedId, realmName)
        : undefined,
      this.cache.invalidateCorsOrigins(),
    ]).catch((err: unknown) =>
      this.logger.warn(
        `Realm '${realmName}' imported, but a cache could not be invalidated: ${String(err)}`,
      ),
    );
    this.corsOrigins.invalidateLocalCache();
    return result;
  }

  /** What the client sees when the transaction failed. */
  private importError(err: unknown): unknown {
    if (err instanceof HttpException) return err;
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') {
        const target = (err.meta as { target?: unknown } | undefined)?.target;
        return new ConflictException(
          `Import failed on a duplicate value${target ? ` (${JSON.stringify(target)})` : ''}; nothing was imported`,
        );
      }
      this.logger.warn(`Realm import failed: ${err.code} ${err.message}`);
      return new BadRequestException(
        `Import failed (${err.code}); nothing was imported`,
      );
    }
    if (err instanceof Prisma.PrismaClientValidationError) {
      this.logger.warn(`Realm import failed: ${err.message}`);
      return new BadRequestException(
        'Import failed: the data does not fit the schema; nothing was imported',
      );
    }
    return err;
  }

  // ─── Version 1 ─────────────────────────────────────────────────────────

  private async importV1(
    payload: Item,
    realmName: string,
    options: ImportOptions,
  ) {
    // Version 1 maps fields as it always did; only its shape is checked.
    const problems: FieldProblem[] = [];
    for (const key of [
      'clientScopes',
      'roles',
      'clients',
      'groups',
      'identityProviders',
      'clientScopeAssignments',
      'users',
    ]) {
      const value = payload[key];
      if (value === undefined || value === null) continue;
      if (!Array.isArray(value)) {
        problems.push({ path: key, message: 'must be an array' });
        continue;
      }
      value.forEach((item, i) => {
        if (!isRecord(item)) {
          problems.push({ path: `${key}[${i}]`, message: 'must be an object' });
        }
      });
    }
    if (problems.length) throw invalid(problems);

    // Slow work (key generation, Argon2) before the transaction opens.
    const keyPair = await this.jwkService.generateRsaKeyPair();
    const secrets = new Map<string, string | null>();
    for (const c of v1Clients(payload)) {
      secrets.set(c.clientId, await this.importedClientSecret(c.clientSecret));
    }

    return this.inTransaction(realmName, options, (tx) =>
      importV1(
        tx,
        payload,
        signingKeySecrets.sealPair(this.crypto, keyPair),
        secrets,
        (value) => this.crypto.encryptSecret(value),
      ),
    );
  }

  // ─── Version 2 ─────────────────────────────────────────────────────────

  private async importV2(
    payload: Item,
    realmName: string,
    options: ImportOptions,
  ) {
    const checked = validateV2Import(payload);
    if (checked.problems.length) throw invalid(checked.problems);

    const keyPair = await this.jwkService.generateRsaKeyPair();
    const clientSecrets = new Map<string, string | null>();
    for (const c of items(payload, 'clients')) {
      clientSecrets.set(
        c['clientId'] as string,
        await this.importedClientSecret(c['clientSecret']),
      );
    }

    const summary = await this.inTransaction(realmName, options, (tx) =>
      this.writeV2(tx, payload, checked, keyPair, clientSecrets),
    );
    return { realmName, version: 2, ...summary };
  }

  /** Encrypt a secret of kind `encrypted` for this instance. */
  private sealed(value: unknown): string | null {
    return typeof value === 'string' && value
      ? this.crypto.encryptSecret(value)
      : null;
  }

  private async writeV2(
    tx: Tx,
    payload: Item,
    checked: ValidatedImport,
    keyPair: { kid: string; publicKeyPem: string; privateKeyPem: string },
    clientSecrets: Map<string, string | null>,
  ) {
    const warnings = [...checked.warnings];
    const secretsIncluded = payload['secretsIncluded'] === true;
    const realmItem = payload['realm'] as Item;

    // ── Realm ──
    const realmData = createData(spec['Realm'], realmItem);
    for (const name of Object.keys(spec['Realm'].secrets ?? {})) {
      if (realmItem[name] !== undefined) {
        realmData[name] = this.sealed(realmItem[name]);
      }
    }
    if (isRecord(realmItem['emailProviderConfig'])) {
      realmData['emailProviderConfig'] = encryptEmailProviderConfig(
        this.crypto,
        realmItem['emailProviderConfig'],
      );
    }
    if (isRecord(realmItem['smsProviderConfig'])) {
      realmData['smsProviderConfig'] = encryptSmsProviderConfig(
        this.crypto,
        realmItem['smsProviderConfig'],
        undefined,
      );
    }
    if (!secretsIncluded) {
      warnings.push(
        'The export has no secrets: re-enter the SMTP password, CAPTCHA secret keys and email/SMS provider credentials if the realm uses them',
      );
    }
    const realm = await tx.realm.create({
      data: {
        ...(realmData as Prisma.RealmCreateInput),
        signingKeys: {
          create: signingKeySecrets.createData(this.crypto, keyPair),
        },
      },
      select: { id: true, name: true },
    });
    const realmId = realm.id;
    const many = <T>(model: string, list: Item[], extra?: (i: Item) => Item) =>
      list.map(
        (i) =>
          ({
            ...createData(spec[model], i),
            ...(extra ? extra(i) : {}),
            realmId,
          }) as T,
      );

    // ── Flows, then the realm's binding ──
    const flowId = new Map<string, string>();
    for (const f of items(payload, 'authenticationFlows')) {
      const flow = await tx.authenticationFlow.create({
        data: {
          ...createData(spec['AuthenticationFlow'], f),
          realmId,
        } as Prisma.AuthenticationFlowUncheckedCreateInput,
        select: { id: true },
      });
      flowId.set(f['name'] as string, flow.id);
    }
    const browserFlow = realmItem['browserFlow'];
    if (typeof browserFlow === 'string') {
      await tx.realm.update({
        where: { id: realmId },
        data: { browserFlowId: flowId.get(browserFlow) },
      });
    }

    // ── Client scopes ──
    const scopeId = new Map<string, string>();
    const scopes = items(payload, 'clientScopes');
    for (const s of scopes) {
      const scope = await tx.clientScope.create({
        data: {
          ...createData(spec['ClientScope'], s),
          realmId,
          protocolMappers: {
            create: items(s, 'protocolMappers').map(
              (m) =>
                createData(
                  spec['ProtocolMapper'],
                  m,
                ) as Prisma.ProtocolMapperCreateWithoutClientScopeInput,
            ),
          },
        } as Prisma.ClientScopeUncheckedCreateInput,
        select: { id: true },
      });
      scopeId.set(s['name'] as string, scope.id);
    }
    if (scopes.length === 0) await seedDefaultScopesIn(tx, realmId);

    // ── Service-account users, then clients ──
    const clients = items(payload, 'clients');
    const serviceAccountId = new Map<string, string>(); // clientId → user id
    for (const c of clients) {
      const sa = c['serviceAccount'];
      if (!isRecord(sa)) continue;
      const user = await tx.user.create({
        data: {
          realmId,
          username: sa['username'] as string,
          enabled: (sa['enabled'] as boolean | undefined) ?? true,
        },
        select: { id: true },
      });
      serviceAccountId.set(c['clientId'] as string, user.id);
    }

    const clientId = new Map<string, string>(); // OAuth client_id → row id
    for (const [i, c] of clients.entries()) {
      const key = c['clientId'] as string;
      const data = createData(spec['Client'], c);
      if (Array.isArray(data['webOrigins'])) {
        data['webOrigins'] = (data['webOrigins'] as string[]).filter(
          (o) => o !== '*',
        );
      }
      const secret = clientSecrets.get(key) ?? null;
      const method = c['tokenEndpointAuthMethod'];
      const usesSecret =
        (c['clientType'] ?? 'CONFIDENTIAL') === 'CONFIDENTIAL' &&
        (method === undefined ||
          method === null ||
          (typeof method === 'string' && method.startsWith('client_secret_')));
      if (!secret && usesSecret && !secretsIncluded) {
        warnings.push(
          `clients[${i}] '${key}': no client secret in the export; regenerate it before the client can authenticate`,
        );
      }
      const authFlow = c['authFlow'];
      const row = await tx.client.create({
        data: {
          ...data,
          realmId,
          clientSecret: secret,
          authFlowId:
            typeof authFlow === 'string' ? flowId.get(authFlow) : null,
          serviceAccountUserId: serviceAccountId.get(key) ?? null,
        } as Prisma.ClientUncheckedCreateInput,
        select: { id: true },
      });
      clientId.set(key, row.id);

      const scopeRows = (list: string) =>
        (c[list] as string[] | undefined)?.map((name) => ({
          clientId: row.id,
          clientScopeId: scopeId.get(name)!,
        })) ?? [];
      await tx.clientDefaultScope.createMany({
        data: scopeRows('defaultScopes'),
      });
      await tx.clientOptionalScope.createMany({
        data: scopeRows('optionalScopes'),
      });

      const certificates = items(c, 'tlsCertificates').map((_, j) => {
        const cert = checked.certificates.get(
          `clients[${i}].tlsCertificates[${j}]`,
        )!;
        return {
          clientId: row.id,
          realmId,
          x5tS256: cert.x5tS256,
          certificatePem: cert.pem,
          subject: cert.subject,
          notBefore: cert.notBefore,
          notAfter: cert.notAfter,
        };
      });
      if (certificates.length) {
        await tx.clientTlsCertificate.createMany({ data: certificates });
      }
    }

    // ── Roles and groups ──
    const roleId = new Map<string, string>();
    for (const r of items(payload, 'roles')) {
      const ref: RoleRef = {
        name: r['name'] as string,
        clientId: (r['clientId'] as string | null | undefined) ?? null,
      };
      const role = await tx.role.create({
        data: {
          ...createData(spec['Role'], r),
          realmId,
          clientId: ref.clientId ? clientId.get(ref.clientId) : null,
        } as Prisma.RoleUncheckedCreateInput,
        select: { id: true },
      });
      roleId.set(roleKey(ref), role.id);
    }
    const roleIdOf = (refs: unknown) =>
      items({ refs }, 'refs').map((r) =>
        roleId.get(
          roleKey({
            name: r['name'] as string,
            clientId: (r['clientId'] as string | null | undefined) ?? null,
          }),
        )!,
      );

    const groups = items(payload, 'groups');
    const groupByName = new Map(groups.map((g) => [g['name'] as string, g]));
    const groupId = new Map<string, string>();
    for (const name of checked.groupOrder) {
      const g = groupByName.get(name)!;
      const parent = g['parentName'];
      const group = await tx.group.create({
        data: {
          ...createData(spec['Group'], g),
          realmId,
          parentId: typeof parent === 'string' ? groupId.get(parent) : null,
        } as Prisma.GroupUncheckedCreateInput,
        select: { id: true },
      });
      groupId.set(name, group.id);
    }
    const groupRoles = groups.flatMap((g) =>
      roleIdOf(g['roles']).map((id) => ({
        groupId: groupId.get(g['name'] as string)!,
        roleId: id,
      })),
    );
    if (groupRoles.length) await tx.groupRole.createMany({ data: groupRoles });

    // ── Service-account mappings ──
    for (const c of clients) {
      const sa = c['serviceAccount'];
      const userId = serviceAccountId.get(c['clientId'] as string);
      if (!isRecord(sa) || !userId) continue;
      const userRoles = roleIdOf(sa['roles']).map((id) => ({
        userId,
        roleId: id,
      }));
      if (userRoles.length) await tx.userRole.createMany({ data: userRoles });
      const userGroups = ((sa['groups'] as string[] | undefined) ?? []).map(
        (name) => ({ userId, groupId: groupId.get(name)! }),
      );
      if (userGroups.length)
        await tx.userGroup.createMany({ data: userGroups });
    }

    // ── Identity providers and federation ──
    const idps = items(payload, 'identityProviders');
    await tx.identityProvider.createMany({
      data: many<Prisma.IdentityProviderCreateManyInput>(
        'IdentityProvider',
        idps,
        (idp) => {
          if (typeof idp['clientSecret'] === 'string') {
            return {
              clientSecret: idpSecrets.forCreate(
                this.crypto,
                idp['clientSecret'],
              ),
            };
          }
          warnings.push(
            `identity provider '${idp['alias'] as string}': no client secret in the export; imported disabled`,
          );
          return { clientSecret: '', enabled: false };
        },
      ),
    });

    await tx.samlServiceProvider.createMany({
      data: many<Prisma.SamlServiceProviderCreateManyInput>(
        'SamlServiceProvider',
        items(payload, 'samlServiceProviders'),
      ),
    });

    for (const f of items(payload, 'userFederations')) {
      const secret = f['bindCredential'];
      const hasSecret = typeof secret === 'string';
      if (!hasSecret) {
        warnings.push(
          `user federation '${f['name'] as string}': no bind credential in the export; imported disabled`,
        );
      }
      await tx.userFederation.create({
        data: {
          ...createData(spec['UserFederation'], f),
          ...(hasSecret
            ? {
                bindCredential: federationSecrets.forCreate(
                  this.crypto,
                  secret,
                ),
              }
            : { bindCredential: '', enabled: false }),
          realmId,
          mappers: {
            create: items(f, 'mappers').map(
              (m) =>
                createData(
                  spec['UserFederationMapper'],
                  m,
                ) as Prisma.UserFederationMapperCreateWithoutFederationInput,
            ),
          },
        } as Prisma.UserFederationUncheckedCreateInput,
      });
    }

    // ── Certificate trust ──
    const anchors = items(payload, 'tlsTrustAnchors').map((_, i) => {
      const cert = checked.certificates.get(`tlsTrustAnchors[${i}]`)!;
      return {
        realmId,
        certificatePem: cert.pem,
        subject: cert.subject,
        x5tS256: cert.x5tS256,
        notAfter: cert.notAfter,
      };
    });
    if (anchors.length) {
      await tx.realmTlsTrustAnchor.createMany({ data: anchors });
    }
    if (checked.denyList.length) {
      await tx.tlsRevokedCertificate.createMany({
        data: checked.denyList.map((entry) => ({ ...entry, realmId })),
      });
    }

    // ── Plain configuration ──
    await tx.customAttribute.createMany({
      data: many<Prisma.CustomAttributeCreateManyInput>(
        'CustomAttribute',
        items(payload, 'customAttributes'),
      ),
    });
    await tx.registrationField.createMany({
      data: many<Prisma.RegistrationFieldCreateManyInput>(
        'RegistrationField',
        items(payload, 'registrationFields'),
      ),
    });
    await tx.webhook.createMany({
      data: many<Prisma.WebhookCreateManyInput>(
        'Webhook',
        items(payload, 'webhooks'),
        (w) => {
          if (typeof w['secret'] === 'string') {
            return { secret: this.crypto.encrypt(w['secret']) };
          }
          warnings.push(
            `webhook ${w['url'] as string}: no signing secret in the export; imported disabled with a new random secret`,
          );
          return {
            secret: this.crypto.encrypt(this.crypto.generateSecret()),
            enabled: false,
          };
        },
      ),
    });
    await tx.auditLogStream.createMany({
      data: many<Prisma.AuditLogStreamCreateManyInput>(
        'AuditLogStream',
        items(payload, 'auditLogStreams'),
        (s) => {
          if (s['httpHeaders'] !== undefined) {
            return {
              httpHeaders:
                s['httpHeaders'] === null
                  ? Prisma.DbNull
                  : sealSecretJson(
                      this.crypto,
                      s['httpHeaders'],
                      STREAM_HEADERS_SHAPE,
                    ),
            };
          }
          if (!secretsIncluded && s['streamType'] === 'http') {
            warnings.push(
              `audit log stream '${s['name'] as string}': HTTP headers are not in the export; re-enter them if the destination needs them`,
            );
          }
          return {};
        },
      ),
    });
    await tx.policy.createMany({
      data: many<Prisma.PolicyCreateManyInput>(
        'Policy',
        items(payload, 'policies'),
      ),
    });
    await tx.continuousRiskPolicy.createMany({
      data: many<Prisma.ContinuousRiskPolicyCreateManyInput>(
        'ContinuousRiskPolicy',
        items(payload, 'continuousRiskPolicies'),
      ),
    });
    for (const c of items(payload, 'consentCategories')) {
      await tx.consentCategory.create({
        data: {
          ...createData(spec['ConsentCategory'], c),
          realmId,
          policies: {
            create: items(c, 'policies').map(
              (p) =>
                createData(
                  spec['ConsentPolicy'],
                  p,
                ) as Prisma.ConsentPolicyCreateWithoutCategoryInput,
            ),
          },
        } as Prisma.ConsentCategoryUncheckedCreateInput,
      });
    }
    await tx.theme.createMany({
      data: many<Prisma.ThemeCreateManyInput>(
        'Theme',
        items(payload, 'themes'),
      ),
    });
    await tx.scimAttributeMapping.createMany({
      data: many<Prisma.ScimAttributeMappingCreateManyInput>(
        'ScimAttributeMapping',
        items(payload, 'scimAttributeMappings'),
      ),
    });
    await tx.serviceAccount.createMany({
      data: many<Prisma.ServiceAccountCreateManyInput>(
        'ServiceAccount',
        items(payload, 'serviceAccounts'),
      ),
    });
    await tx.nhiCredentialPolicy.createMany({
      data: many<Prisma.NhiCredentialPolicyCreateManyInput>(
        'NhiCredentialPolicy',
        items(payload, 'nhiCredentialPolicies'),
      ),
    });
    await tx.proxyApplication.createMany({
      data: many<Prisma.ProxyApplicationCreateManyInput>(
        'ProxyApplication',
        items(payload, 'proxyApplications'),
        (p) => ({ clientId: clientId.get(p['client'] as string) }),
      ),
    });

    // ── Users ──
    const users = items(payload, 'users');
    const userId = new Map<string, string>();
    if (users.length) {
      await tx.user.createMany({
        data: many<Prisma.UserCreateManyInput>('User', users),
      });
      const rows = await tx.user.findMany({
        where: {
          realmId,
          username: { in: users.map((u) => u['username'] as string) },
        },
        select: { id: true, username: true },
      });
      for (const r of rows) userId.set(r.username, r.id);

      const attributeRows = await tx.customAttribute.findMany({
        where: { realmId },
        select: { id: true, name: true },
      });
      const attributeId = new Map(attributeRows.map((a) => [a.name, a.id]));

      const userRoles: Array<{ userId: string; roleId: string }> = [];
      const userGroups: Array<{ userId: string; groupId: string }> = [];
      const userAttributes: Array<{
        userId: string;
        attributeId: string;
        value: string;
      }> = [];
      for (const u of users) {
        const id = userId.get(u['username'] as string)!;
        for (const r of roleIdOf(u['roles'])) {
          userRoles.push({ userId: id, roleId: r });
        }
        for (const g of (u['groups'] as string[] | undefined) ?? []) {
          userGroups.push({ userId: id, groupId: groupId.get(g)! });
        }
        const attributes = u['attributes'];
        if (isRecord(attributes)) {
          for (const [name, value] of Object.entries(attributes)) {
            userAttributes.push({
              userId: id,
              attributeId: attributeId.get(name)!,
              value: value as string,
            });
          }
        }
      }
      if (userRoles.length) await tx.userRole.createMany({ data: userRoles });
      if (userGroups.length) {
        await tx.userGroup.createMany({ data: userGroups });
      }
      if (userAttributes.length) {
        await tx.userAttribute.createMany({ data: userAttributes });
      }
    }

    // ── Organizations (members are users) ──
    for (const o of items(payload, 'organizations')) {
      const org = await tx.organization.create({
        data: {
          ...createData(spec['Organization'], o),
          realmId,
          ssoConnections: {
            create: items(o, 'ssoConnections').map((s) => {
              const data = createData(spec['OrganizationSsoConnection'], s);
              if (s['config'] !== undefined) {
                return {
                  ...data,
                  config: sealSecretJson(
                    this.crypto,
                    s['config'],
                    SSO_CONFIG_SHAPE,
                  ),
                };
              }
              warnings.push(
                `organization '${o['slug'] as string}' SSO connection '${s['name'] as string}': no configuration in the export; imported disabled`,
              );
              return { ...data, config: {}, enabled: false };
            }) as Prisma.OrganizationSsoConnectionCreateWithoutOrganizationInput[],
          },
        } as Prisma.OrganizationUncheckedCreateInput,
        select: { id: true },
      });
      const members = items(o, 'members').map((m) => ({
        ...createData(spec['OrganizationMember'], m),
        organizationId: org.id,
        userId: userId.get(m['username'] as string)!,
      }));
      if (members.length) {
        await tx.organizationMember.createMany({
          data: members,
        });
      }
    }

    const count = (key: string) => items(payload, key).length;
    return {
      clientsImported: clients.length,
      rolesImported: count('roles'),
      groupsImported: groups.length,
      scopesImported: scopes.length,
      idpsImported: idps.length,
      usersImported: users.length,
      flowsImported: count('authenticationFlows'),
      warnings,
    };
  }
}
