import { isDeepStrictEqual } from 'node:util';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createTestApp, TEST_ADMIN_API_KEY, type TestContext } from './setup';
import { readPrismaSchema } from './helpers/prisma-schema';
import {
  EXPORT_MODELS,
  type ModelExportSpec,
} from '../src/realms/export/realm-export.fields';
import {
  enumValues,
  parseFieldType,
} from '../src/realms/export/field-codec';
import { CryptoService } from '../src/crypto/crypto.service';
import { chain, issue } from '../src/client-auth/__mocks__/test-pki';
import {
  parseSingleCertificatePem,
  summarizeCertificate,
} from '../src/client-auth/certificate-pem';
import {
  canonicalDn,
  parseRfc4514,
} from '../src/client-auth/distinguished-name';

/**
 * Realm export format 2, end to end: a realm with every exported setting at
 * a non-default value round-trips exactly; bad files leave nothing behind;
 * version 1 files still import; secrets travel only when asked for.
 */

const SOURCE = 'e2e-rx-source';
const COPY = 'e2e-rx-copy';
const FAIL = 'e2e-rx-fail';
const NO_SECRETS = 'e2e-rx-nosecrets';
const V1 = 'e2e-rx-v1';
const ALL = [SOURCE, COPY, FAIL, NO_SECRETS, V1];

const spec = EXPORT_MODELS as Record<string, ModelExportSpec>;
const schema = readPrismaSchema();

type Row = Record<string, any>;

// ─── Values generated from the allow-list ───────────────────────────────

/** The value a column has when nothing is set, as the export shows it. */
function schemaDefault(model: string, field: string): unknown {
  const f = schema.models.get(model)!.fields.find((x) => x.name === field)!;
  if (f.defaultText === undefined) {
    if (f.list) return [];
    return f.optional ? null : undefined;
  }
  const text = f.defaultText;
  if (text === 'true' || text === 'false') return text === 'true';
  if (text !== '' && !Number.isNaN(Number(text))) return Number(text);
  if (text.startsWith('"')) {
    const str = JSON.parse(text) as string;
    return f.type === 'Json' ? JSON.parse(str) : str;
  }
  if (text.startsWith('[')) return JSON.parse(text);
  return text; // enum value
}

/** A non-default value for every allow-listed column of `model`. */
function generated(model: string, n = 0): Row {
  const out: Row = {};
  for (const [field, type] of Object.entries(spec[model].fields)) {
    const t = parseFieldType(type);
    const def = schemaDefault(model, field);
    const tag = `${model}.${field}.${n}`;
    let value: unknown;
    switch (t.base) {
      case 'String':
        value = t.list ? [`${tag}.a`, `${tag}.b`] : tag;
        break;
      case 'Int':
        value = (typeof def === 'number' ? def : 0) + 7 + n;
        break;
      case 'Float':
        value = 0.73;
        break;
      case 'Boolean':
        value = !(def ?? false);
        break;
      case 'DateTime':
        value = new Date(Date.UTC(2031, 0, 2 + n, 3, 4, 5));
        break;
      case 'Json':
        value = { generated: tag, nested: { n } };
        break;
      default:
        value = enumValues(t.base)!.find((v) => v !== def);
    }
    out[field] = value;
  }
  return out;
}

/** Rows of each exported model, read back from an export file. */
const ROWS_OF: Record<string, (e: Row) => Row[]> = {
  Realm: (e) => [e.realm],
  AuthenticationFlow: (e) => e.authenticationFlows,
  ClientScope: (e) => e.clientScopes,
  ProtocolMapper: (e) => e.clientScopes.flatMap((s: Row) => s.protocolMappers),
  Client: (e) => e.clients,
  ClientTlsCertificate: (e) =>
    e.clients.flatMap((c: Row) => c.tlsCertificates),
  RealmTlsTrustAnchor: (e) => e.tlsTrustAnchors,
  TlsRevokedCertificate: (e) => e.tlsRevokedCertificates,
  Role: (e) => e.roles,
  Group: (e) => e.groups,
  IdentityProvider: (e) => e.identityProviders,
  SamlServiceProvider: (e) => e.samlServiceProviders,
  UserFederation: (e) => e.userFederations,
  UserFederationMapper: (e) => e.userFederations.flatMap((f: Row) => f.mappers),
  Webhook: (e) => e.webhooks,
  AuditLogStream: (e) => e.auditLogStreams,
  Policy: (e) => e.policies,
  CustomAttribute: (e) => e.customAttributes,
  ContinuousRiskPolicy: (e) => e.continuousRiskPolicies,
  Organization: (e) => e.organizations,
  OrganizationSsoConnection: (e) =>
    e.organizations.flatMap((o: Row) => o.ssoConnections),
  OrganizationMember: (e) =>
    e.organizations.flatMap((o: Row) => o.members ?? []),
  ServiceAccount: (e) => e.serviceAccounts,
  ScimAttributeMapping: (e) => e.scimAttributeMappings,
  RegistrationField: (e) => e.registrationFields,
  NhiCredentialPolicy: (e) => e.nhiCredentialPolicies,
  ConsentCategory: (e) => e.consentCategories,
  ConsentPolicy: (e) => e.consentCategories.flatMap((c: Row) => c.policies),
  Theme: (e) => e.themes,
  ProxyApplication: (e) => e.proxyApplications,
  User: (e) => e.users ?? [],
  UserAttribute: (e) =>
    (e.users ?? []).flatMap((u: Row) =>
      Object.values(u.attributes).map((value) => ({ value })),
    ),
};

const PASSWORD_FLOW = [{ id: 'pw', type: 'password', required: true, order: 1 }];
const PASSWORD_TOTP_FLOW = [
  { id: 'pw', type: 'password', required: true, order: 1 },
  { id: 'otp', type: 'totp', required: true, order: 2 },
];

/** Normalised PEM, as the admin API stores it. */
const stored = (pem: string) =>
  summarizeCertificate(parseSingleCertificatePem(pem));

describe('Realm export/import, format 2 (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;
  let crypto: CryptoService;
  let clientSecretHash: string;
  let exportWithSecrets: Row;

  const admin = () => request(app.getHttpServer());
  const exportOf = async (name: string, query = '') =>
    (
      await admin()
        .get(`/admin/realms/${name}/export${query}`)
        .set('x-admin-api-key', TEST_ADMIN_API_KEY)
        .expect(200)
    ).body as Row;
  const importFile = (payload: unknown, overwrite = false) =>
    admin()
      .post(`/admin/realms/import${overwrite ? '?overwrite=true' : ''}`)
      .set('x-admin-api-key', TEST_ADMIN_API_KEY)
      .send(payload as object);
  const renamed = (e: Row, name: string): Row => ({
    ...structuredClone(e),
    realm: { ...structuredClone(e.realm), name },
  });
  const dropAll = async () => {
    for (const name of ALL) {
      await ctx.prisma.realm.delete({ where: { name } }).catch(() => {});
    }
  };

  /** Build SOURCE with every exported setting at a non-default value. */
  async function buildSource() {
    const p = ctx.prisma;
    const enc = (v: string) => crypto.encryptSecret(v);

    const realm = await p.realm.create({
      data: {
        ...(generated('Realm') as Prisma.RealmCreateInput),
        name: SOURCE,
        emailProvider: 'resend',
        emailProviderConfig: { resend: { apiKey: enc('resend-key') } },
        smsProvider: 'twilio',
        smsProviderConfig: {
          twilioAccountSid: 'AC123',
          twilioAuthToken: enc('twilio-token'),
        },
        captchaProvider: 'hcaptcha',
        defaultLocale: 'de',
        supportedLocales: ['en', 'de'],
        smtpPassword: enc('smtp-pass'),
        recaptchaSecretKey: enc('recaptcha-secret'),
        hcaptchaSecretKey: enc('hcaptcha-secret'),
        signingKeys: {
          create: {
            kid: 'source-kid',
            publicKey: 'not-used',
            privateKey: 'not-used',
          },
        },
      },
    });
    const realmId = realm.id;

    const realmFlow = await p.authenticationFlow.create({
      data: {
        ...(generated('AuthenticationFlow', 0) as any),
        name: 'realm-flow',
        steps: PASSWORD_FLOW,
        realmId,
      },
    });
    const clientFlow = await p.authenticationFlow.create({
      data: {
        ...(generated('AuthenticationFlow', 1) as any),
        name: 'client-flow',
        steps: PASSWORD_TOTP_FLOW,
        realmId,
      },
    });
    await p.realm.update({
      where: { id: realmId },
      data: { browserFlowId: realmFlow.id },
    });

    const scope = await p.clientScope.create({
      data: {
        ...(generated('ClientScope') as any),
        name: 'scope-a',
        realmId,
        protocolMappers: { create: [generated('ProtocolMapper') as any] },
      },
    });
    const optionalScope = await p.clientScope.create({
      data: { name: 'scope-b', realmId },
    });

    // One client per tls_client_auth rule (exactly one may be set), one
    // self-signed, one secret-based with a service account, one public.
    const sa = await p.user.create({
      data: { realmId, username: 'service-account-svc', enabled: false },
    });
    const clientRows: Row[] = [
      {
        clientId: 'pki-dn',
        tokenEndpointAuthMethod: 'tls_client_auth',
        tlsClientAuthSubjectDn: 'CN=svc,O=Acme',
      },
      {
        clientId: 'pki-dns',
        tokenEndpointAuthMethod: 'tls_client_auth',
        tlsClientAuthSanDns: 'svc.example.com',
      },
      {
        clientId: 'pki-uri',
        tokenEndpointAuthMethod: 'tls_client_auth',
        tlsClientAuthSanUri: 'spiffe://example.org/svc',
      },
      {
        clientId: 'pki-ip',
        tokenEndpointAuthMethod: 'tls_client_auth',
        tlsClientAuthSanIp: '10.0.0.7',
      },
      {
        clientId: 'pki-email',
        tokenEndpointAuthMethod: 'tls_client_auth',
        tlsClientAuthSanEmail: 'svc@example.com',
      },
      {
        clientId: 'self-signed',
        tokenEndpointAuthMethod: 'self_signed_tls_client_auth',
      },
      {
        clientId: 'svc',
        tokenEndpointAuthMethod: 'client_secret_post',
        clientSecret: clientSecretHash,
        serviceAccountUserId: sa.id,
        authFlowId: clientFlow.id,
      },
      { clientId: 'spa', clientType: 'PUBLIC', tokenEndpointAuthMethod: 'none' },
    ];
    const clients = new Map<string, string>();
    for (const [i, c] of clientRows.entries()) {
      const g = generated('Client', i);
      for (const rule of [
        'tlsClientAuthSubjectDn',
        'tlsClientAuthSanDns',
        'tlsClientAuthSanUri',
        'tlsClientAuthSanIp',
        'tlsClientAuthSanEmail',
      ]) {
        g[rule] = null;
      }
      const row = await p.client.create({
        data: {
          ...g,
          clientType: 'CONFIDENTIAL',
          ...c,
          realmId,
        } as Prisma.ClientUncheckedCreateInput,
      });
      clients.set(c.clientId, row.id);
      await p.clientDefaultScope.create({
        data: { clientId: row.id, clientScopeId: scope.id },
      });
      await p.clientOptionalScope.create({
        data: { clientId: row.id, clientScopeId: optionalScope.id },
      });
    }
    for (const cn of ['pinned-1', 'pinned-2']) {
      const cert = stored((await issue({ cn })).pem);
      await p.clientTlsCertificate.create({
        data: {
          clientId: clients.get('self-signed')!,
          realmId,
          x5tS256: cert.x5tS256,
          certificatePem: cert.pem,
          subject: cert.subject,
          notBefore: cert.notBefore,
          notAfter: cert.notAfter,
        },
      });
    }

    const realmRole = await p.role.create({
      data: { ...(generated('Role', 0) as any), realmId },
    });
    const clientRole = await p.role.create({
      data: {
        ...(generated('Role', 1) as any),
        realmId,
        clientId: clients.get('svc'),
      },
    });
    const parent = await p.group.create({
      data: { ...(generated('Group', 0) as any), realmId },
    });
    const child = await p.group.create({
      data: { ...(generated('Group', 1) as any), realmId, parentId: parent.id },
    });
    await p.groupRole.createMany({
      data: [
        { groupId: child.id, roleId: realmRole.id },
        { groupId: child.id, roleId: clientRole.id },
      ],
    });
    await p.userRole.create({ data: { userId: sa.id, roleId: clientRole.id } });
    await p.userGroup.create({ data: { userId: sa.id, groupId: parent.id } });

    await p.identityProvider.create({
      data: {
        ...(generated('IdentityProvider') as any),
        clientSecret: 'idp-secret',
        realmId,
      },
    });
    await p.samlServiceProvider.create({
      data: { ...(generated('SamlServiceProvider') as any), realmId },
    });
    await p.userFederation.create({
      data: {
        ...(generated('UserFederation') as any),
        bindCredential: 'bind-secret',
        realmId,
        mappers: { create: [generated('UserFederationMapper') as any] },
      },
    });

    const pki = await chain({ cn: 'leaf' });
    const anchor = stored(pki.root.pem);
    await p.realmTlsTrustAnchor.create({
      data: {
        realmId,
        certificatePem: anchor.pem,
        subject: anchor.subject,
        x5tS256: anchor.x5tS256,
        notAfter: anchor.notAfter,
      },
    });
    await p.tlsRevokedCertificate.createMany({
      data: [
        {
          realmId,
          x5tS256: stored(pki.leaf.pem).x5tS256,
          reason: 'TlsRevokedCertificate.reason.0',
        },
        {
          realmId,
          issuerDn: canonicalDn(parseRfc4514('CN=Bad CA,O=Acme')),
          serialNumber: 'abc123',
          reason: 'key compromise',
        },
      ],
    });

    const attribute = await p.customAttribute.create({
      data: { ...(generated('CustomAttribute') as any), realmId },
    });
    await p.registrationField.create({
      data: { ...(generated('RegistrationField') as any), realmId },
    });
    await p.webhook.create({
      data: {
        ...(generated('Webhook') as any),
        secret: crypto.encrypt('hook-secret'),
        realmId,
      },
    });
    await p.auditLogStream.create({
      data: {
        ...(generated('AuditLogStream') as any),
        httpHeaders: { Authorization: 'Bearer audit-token' },
        realmId,
      },
    });
    await p.policy.create({
      data: { ...(generated('Policy') as any), realmId },
    });
    await p.continuousRiskPolicy.create({
      data: { ...(generated('ContinuousRiskPolicy') as any), realmId },
    });
    await p.consentCategory.create({
      data: {
        ...(generated('ConsentCategory') as any),
        realmId,
        policies: { create: [generated('ConsentPolicy') as any] },
      },
    });
    await p.theme.create({
      data: { ...(generated('Theme') as any), realmId },
    });
    await p.scimAttributeMapping.create({
      data: { ...(generated('ScimAttributeMapping') as any), realmId },
    });
    await p.serviceAccount.create({
      data: { ...(generated('ServiceAccount') as any), realmId },
    });
    await p.nhiCredentialPolicy.create({
      data: { ...(generated('NhiCredentialPolicy') as any), realmId },
    });
    await p.proxyApplication.create({
      data: {
        ...(generated('ProxyApplication') as any),
        realmId,
        clientId: clients.get('svc')!,
      },
    });

    const user = await p.user.create({
      data: {
        ...(generated('User') as any),
        realmId,
        passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA',
      },
    });
    await p.userRole.create({ data: { userId: user.id, roleId: realmRole.id } });
    await p.userGroup.create({ data: { userId: user.id, groupId: child.id } });
    await p.userAttribute.create({
      data: {
        userId: user.id,
        attributeId: attribute.id,
        value: 'UserAttribute.value.0',
      },
    });
    await p.organization.create({
      data: {
        ...(generated('Organization') as any),
        realmId,
        ssoConnections: {
          create: [
            {
              ...(generated('OrganizationSsoConnection') as any),
              config: { clientSecret: 'org-sso-secret' },
            },
          ],
        },
        members: {
          create: [
            { ...(generated('OrganizationMember') as any), userId: user.id },
          ],
        },
      },
    });

    // An NHI identity's client is left out of exports (listed in omitted).
    const nhi = await p.nhiIdentity.create({
      data: { realmId, name: 'device-1' },
    });
    await p.client.create({
      data: {
        realmId,
        clientId: 'nhi-device-1',
        redirectUris: [],
        webOrigins: [],
        grantTypes: ['client_credentials'],
        nhiIdentityId: nhi.id,
        tokenEndpointAuthMethod: 'self_signed_tls_client_auth',
      },
    });
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app as INestApplication<App>;
    crypto = app.get(CryptoService);
    clientSecretHash = await crypto.hashSecret(crypto.generateSecret());
    await dropAll();
    await buildSource();
    exportWithSecrets = await exportOf(
      SOURCE,
      '?includeUsers=true&includeSecrets=true',
    );
  }, 120_000);

  afterAll(async () => {
    await dropAll();
    await ctx.cleanup();
  });

  // ─── Round trip ─────────────────────────────────────────────────────────

  describe('round trip', () => {
    it('exports every allow-listed field, each at a non-default value', () => {
      const e = exportWithSecrets;
      expect(e.version).toBe(2);
      const problems: string[] = [];
      for (const [model, s] of Object.entries(spec)) {
        const columns = [
          ...Object.keys(s.fields),
          ...Object.keys(s.secrets ?? {}),
        ];
        if (columns.length === 0) continue;
        const rowsOf = ROWS_OF[model];
        if (!rowsOf) {
          problems.push(`${model}: add it to ROWS_OF and to the fixture`);
          continue;
        }
        const rows = rowsOf(e);
        if (rows.length === 0) {
          problems.push(`${model}: no rows in the export`);
          continue;
        }
        for (const field of columns) {
          const def = schemaDefault(model, field);
          const shown = rows.some(
            (r) =>
              field in r &&
              r[field] !== undefined &&
              (def === undefined || !isDeepStrictEqual(r[field], def)),
          );
          if (!shown) {
            problems.push(`${model}.${field}: never exported with a non-default value`);
          }
        }
      }
      expect(problems).toEqual([]);
    });

    it('carries references as natural keys', () => {
      const e = exportWithSecrets;
      expect(e.realm.browserFlow).toBe('realm-flow');
      const svc = e.clients.find((c: Row) => c.clientId === 'svc');
      expect(svc.authFlow).toBe('client-flow');
      expect(svc.defaultScopes).toEqual(['scope-a']);
      expect(svc.optionalScopes).toEqual(['scope-b']);
      expect(svc.serviceAccount).toEqual({
        username: 'service-account-svc',
        enabled: false,
        roles: [{ name: 'Role.name.1', clientId: 'svc' }],
        groups: ['Group.name.0'],
      });
      expect(
        e.clients.find((c: Row) => c.clientId === 'self-signed').tlsCertificates,
      ).toHaveLength(2);
      expect(e.tlsTrustAnchors).toHaveLength(1);
      expect(e.tlsRevokedCertificates).toHaveLength(2);
      expect(e.groups.find((g: Row) => g.name === 'Group.name.1')).toEqual(
        expect.objectContaining({
          parentName: 'Group.name.0',
          roles: [
            { name: 'Role.name.0', clientId: null },
            { name: 'Role.name.1', clientId: 'svc' },
          ],
        }),
      );
      expect(e.proxyApplications[0].client).toBe('svc');
      expect(e.organizations[0].members).toEqual([
        { username: 'User.username.0', role: 'OrganizationMember.role.0' },
      ]);
      // The service account is not exported as a user too.
      expect(e.users.map((u: Row) => u.username)).toEqual(['User.username.0']);
      expect(JSON.stringify(e)).not.toContain('$argon2id');
      expect(JSON.stringify(e)).not.toContain('source-kid');
      expect(e.omitted).toEqual([
        expect.objectContaining({ type: 'client', key: 'nhi-device-1' }),
      ]);
    });

    it('imports under a new name and exports the same file again', async () => {
      const res = await importFile(renamed(exportWithSecrets, COPY)).expect(
        201,
      );
      expect(res.body).toEqual(
        expect.objectContaining({ realmName: COPY, version: 2 }),
      );
      expect(res.body.warnings).toEqual([]);

      const again = await exportOf(COPY, '?includeUsers=true&includeSecrets=true');
      const expected = renamed(exportWithSecrets, COPY);
      expected.omitted = [];
      expect(again).toEqual(expected);
    });

    it('re-encrypts secrets with this instance and gives the copy its own key', async () => {
      const copy = await ctx.prisma.realm.findUniqueOrThrow({
        where: { name: COPY },
        include: { signingKeys: true, webhooks: true, clients: true },
      });
      expect(copy.smtpPassword).not.toBe('smtp-pass');
      expect(crypto.decryptSecret(copy.smtpPassword)).toBe('smtp-pass');
      expect(crypto.decryptSecret(copy.hcaptchaSecretKey)).toBe(
        'hcaptcha-secret',
      );
      expect(
        (copy.emailProviderConfig as Row).resend.apiKey,
      ).not.toBe('resend-key');
      expect(crypto.decrypt(copy.webhooks[0].secret)).toBe('hook-secret');
      expect(
        copy.clients.find((c) => c.clientId === 'svc')!.clientSecret,
      ).toBe(clientSecretHash);
      expect(copy.signingKeys).toHaveLength(1);
      expect(copy.signingKeys[0].kid).not.toBe('source-kid');
    });
  });

  // ─── Secrets ────────────────────────────────────────────────────────────

  describe('secrets', () => {
    it('are left out without includeSecrets', async () => {
      const e = await exportOf(SOURCE, '?includeUsers=true');
      expect(e.secretsIncluded).toBe(false);
      for (const [model, s] of Object.entries(spec)) {
        for (const field of Object.keys(s.secrets ?? {})) {
          for (const row of ROWS_OF[model](e)) {
            expect(row).not.toHaveProperty(field);
          }
        }
      }
      expect(e.realm.emailProviderConfig).toEqual({ resend: {} });
      expect(e.realm.smsProviderConfig).toEqual({ twilioAccountSid: 'AC123' });
      const text = JSON.stringify(e);
      for (const secret of [
        'smtp-pass',
        'hook-secret',
        'idp-secret',
        'bind-secret',
        'audit-token',
        'org-sso-secret',
        'twilio-token',
        'resend-key',
        clientSecretHash,
      ]) {
        expect(text).not.toContain(secret);
      }
    });

    it('missing on import leave secret-bound objects disabled, with warnings', async () => {
      const e = await exportOf(SOURCE, '?includeUsers=true');
      const res = await importFile(renamed(e, NO_SECRETS)).expect(201);
      expect(res.body.warnings).toEqual(
        expect.arrayContaining([
          expect.stringContaining("'svc': no client secret"),
          expect.stringContaining('webhook'),
          expect.stringContaining('identity provider'),
          expect.stringContaining('user federation'),
          expect.stringContaining('SSO connection'),
        ]),
      );
      const r = await ctx.prisma.realm.findUniqueOrThrow({
        where: { name: NO_SECRETS },
        include: {
          webhooks: true,
          identityProviders: true,
          userFederations: true,
          clients: true,
        },
      });
      expect(r.smtpPassword).toBeNull();
      expect(r.webhooks[0].enabled).toBe(false);
      // A fresh random secret that this instance can decrypt.
      expect(crypto.decrypt(r.webhooks[0].secret)).toHaveLength(64);
      expect(r.identityProviders[0].enabled).toBe(false);
      expect(r.userFederations[0].enabled).toBe(false);
      expect(r.clients.find((c) => c.clientId === 'svc')!.clientSecret).toBeNull();
    });
  });

  // ─── Failures leave nothing behind ──────────────────────────────────────

  describe('failed imports', () => {
    const realmCount = (name: string) =>
      ctx.prisma.realm.count({ where: { name } });

    it('a reference that does not resolve: 400 with its path, nothing created', async () => {
      const bad = renamed(exportWithSecrets, FAIL);
      bad.clients[0].authFlow = 'no-such-flow';
      const res = await importFile(bad).expect(400);
      expect(res.body.errors).toEqual([
        {
          path: 'clients[0].authFlow',
          message: "no flow named 'no-such-flow' in authenticationFlows",
        },
      ]);
      expect(res.body.message).toContain('clients[0].authFlow');
      expect(await realmCount(FAIL)).toBe(0);
    });

    it('an invalid flow: 400, nothing created', async () => {
      const bad = renamed(exportWithSecrets, FAIL);
      bad.authenticationFlows[0].steps = [
        { id: 'otp', type: 'totp', required: true, order: 1 },
      ];
      const res = await importFile(bad).expect(400);
      expect(res.body.errors[0].path).toMatch(
        /^authenticationFlows\[0\]\.steps/,
      );
      expect(await realmCount(FAIL)).toBe(0);
    });

    it('a wrong type: 400, nothing created', async () => {
      const bad = renamed(exportWithSecrets, FAIL);
      bad.realm.passwordMinLength = 'twelve';
      bad.clients[1].enabled = 'yes';
      const res = await importFile(bad).expect(400);
      expect(res.body.errors.map((e: Row) => e.path)).toEqual([
        'realm.passwordMinLength',
        'clients[1].enabled',
      ]);
      expect(await realmCount(FAIL)).toBe(0);
    });

    it('a database failure half-way: nothing left behind', async () => {
      const before = await ctx.prisma.client.count();
      const bad = renamed(exportWithSecrets, FAIL);
      // A valid string that PostgreSQL refuses (NUL byte): fails in the
      // database when users are written, after the realm, flows, clients,
      // roles and groups.
      bad.users[0].firstName = 'nul\u0000byte';
      const res = await importFile(bad);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expect(await realmCount(FAIL)).toBe(0);
      expect(await ctx.prisma.client.count()).toBe(before);
    });

    it('with overwrite, a failed import keeps the old realm as it was', async () => {
      const old = await ctx.prisma.realm.findUniqueOrThrow({
        where: { name: COPY },
        select: { id: true },
      });
      const before = await exportOf(COPY, '?includeUsers=true&includeSecrets=true');

      const invalid = renamed(exportWithSecrets, COPY);
      invalid.groups[0].roles = [{ name: 'ghost', clientId: null }];
      await importFile(invalid, true).expect(400);

      // Passes validation, then fails in the database after the old realm
      // was deleted inside the transaction.
      const failing = renamed(exportWithSecrets, COPY);
      failing.users[0].firstName = 'nul\u0000byte';
      const res = await importFile(failing, true);
      expect(res.status).toBeGreaterThanOrEqual(400);

      const after = await ctx.prisma.realm.findUniqueOrThrow({
        where: { name: COPY },
        select: { id: true },
      });
      expect(after.id).toBe(old.id);
      expect(
        await exportOf(COPY, '?includeUsers=true&includeSecrets=true'),
      ).toEqual(before);
    });

    it('with overwrite, a valid import replaces the realm', async () => {
      const old = await ctx.prisma.realm.findUniqueOrThrow({
        where: { name: COPY },
        select: { id: true },
      });
      const changed = renamed(exportWithSecrets, COPY);
      changed.realm.displayName = 'Replaced';
      await importFile(changed, true).expect(201);
      const now = await ctx.prisma.realm.findUniqueOrThrow({
        where: { name: COPY },
      });
      expect(now.id).not.toBe(old.id);
      expect(now.displayName).toBe('Replaced');
      // The API serves the new realm, not a cached copy of the old one.
      const res = await admin()
        .get(`/admin/realms/${COPY}`)
        .set('x-admin-api-key', TEST_ADMIN_API_KEY)
        .expect(200);
      expect(res.body.displayName).toBe('Replaced');
    });

    it('without overwrite, an existing realm is a 409', async () => {
      await importFile(renamed(exportWithSecrets, COPY)).expect(409);
    });
  });

  // ─── Version 1 ──────────────────────────────────────────────────────────

  describe('version 1 files', () => {
    it('still import, with the same mapping as before', async () => {
      const v1 = {
        version: 1,
        realm: {
          name: V1,
          displayName: 'Old export',
          enabled: true,
          accessTokenLifespan: 600,
          passwordMinLength: 12,
          bruteForceEnabled: true,
          mfaRequired: true,
          theme: { primaryColor: '#123456' },
        },
        clients: [
          {
            clientId: 'legacy-app',
            clientType: 'CONFIDENTIAL',
            clientSecret: clientSecretHash,
            name: 'Legacy',
            redirectUris: ['https://legacy.example/cb'],
            webOrigins: ['https://legacy.example', '*'],
            grantTypes: ['authorization_code', 'refresh_token'],
          },
        ],
        roles: [
          { name: 'admin', description: 'Admin', clientId: null },
          { name: 'app-admin', description: null, clientId: 'legacy-app' },
        ],
        groups: [
          { name: 'staff', description: null, parentName: null },
          { name: 'ops', description: null, parentName: 'staff' },
        ],
        clientScopes: [
          {
            name: 'openid',
            protocol: 'openid-connect',
            builtIn: true,
            protocolMappers: [
              {
                name: 'sub',
                mapperType: 'oidc-usermodel-attribute-mapper',
                config: { 'claim.name': 'sub' },
              },
            ],
          },
        ],
        identityProviders: [
          {
            alias: 'google',
            clientId: 'g-client',
            authorizationUrl: 'https://accounts.google.com/auth',
            tokenUrl: 'https://oauth2.googleapis.com/token',
          },
        ],
        clientScopeAssignments: [
          {
            clientId: 'legacy-app',
            defaultScopes: ['openid', 'unknown-scope'],
            optionalScopes: [],
          },
        ],
        users: [
          {
            username: 'alice',
            email: 'alice@example.com',
            emailVerified: true,
            roles: [
              { name: 'admin', clientId: null },
              { name: 'missing-role', clientId: null },
            ],
            groups: ['ops'],
          },
        ],
      };

      const res = await importFile(v1).expect(201);
      expect(res.body).toEqual({
        realmName: V1,
        clientsImported: 1,
        rolesImported: 2,
        groupsImported: 2,
        scopesImported: 1,
        idpsImported: 1,
        usersImported: 1,
      });

      const realm = await ctx.prisma.realm.findUniqueOrThrow({
        where: { name: V1 },
        include: {
          clients: { include: { defaultScopes: true } },
          groups: true,
          users: { include: { userRoles: true, userGroups: true } },
          identityProviders: true,
          signingKeys: true,
        },
      });
      expect(realm).toEqual(
        expect.objectContaining({
          displayName: 'Old export',
          accessTokenLifespan: 600,
          passwordMinLength: 12,
          bruteForceEnabled: true,
          mfaRequired: true,
          theme: { primaryColor: '#123456' },
        }),
      );
      expect(realm.signingKeys).toHaveLength(1);
      const client = realm.clients[0];
      expect(client.clientSecret).toBe(clientSecretHash);
      expect(client.webOrigins).toEqual(['https://legacy.example']);
      expect(client.defaultScopes).toHaveLength(1);
      const ops = realm.groups.find((g) => g.name === 'ops')!;
      const staff = realm.groups.find((g) => g.name === 'staff')!;
      expect(ops.parentId).toBe(staff.id);
      expect(realm.identityProviders[0].clientSecret).toBe('');
      expect(realm.users[0].userRoles).toHaveLength(1);
      expect(realm.users[0].userGroups).toHaveLength(1);
    });

    it('a failed version 1 import leaves nothing behind', async () => {
      const res = await importFile({
        version: 1,
        realm: { name: FAIL },
        clients: [
          { clientId: 'dup', redirectUris: [], webOrigins: [] },
          { clientId: 'dup', redirectUris: [], webOrigins: [] },
        ],
      });
      expect(res.status).toBe(409);
      expect(await ctx.prisma.realm.count({ where: { name: FAIL } })).toBe(0);
    });

    it('an exported v2 file of a v1 import round-trips', async () => {
      const e = await exportOf(V1, '?includeUsers=true&includeSecrets=true');
      expect(e.version).toBe(2);
      expect(e.clients[0].clientId).toBe('legacy-app');
    });
  });
});
