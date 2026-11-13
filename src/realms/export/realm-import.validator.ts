import { isCaCertificate } from '../../client-auth/certificate-checks.js';
import {
  CertificatePemError,
  normalizeSerial,
  parseSingleCertificatePem,
  summarizeCertificate,
  type CertificateSummary,
} from '../../client-auth/certificate-pem.js';
import {
  canonicalDn,
  DistinguishedNameError,
  parseRfc4514,
} from '../../client-auth/distinguished-name.js';
import {
  clientAuthSettingsProblem,
  isValidSanDns,
  isValidSanEmail,
  isValidSanIp,
  isValidSanUri,
  isValidSubjectDn,
  type ClientAuthSettings,
} from '../../clients/client-auth-settings.js';
import { validateFlowSteps } from '../../auth-flow/flow-validator.js';
import { SECRET_PLACEHOLDER } from '../secret-placeholder.js';
import { providerConfigSecrets } from '../realm-secrets.util.js';
import { EXPORT_MODELS, type ModelExportSpec } from './realm-export.fields.js';
import {
  checkFields,
  checkUnknownKeys,
  isRecord,
  type FieldProblem,
} from './field-codec.js';

/**
 * Checks a version 2 realm export before anything is written, and returns
 * every problem with its path. On success it also returns what the import
 * derives from the file (certificate details, canonical deny-list entries)
 * and the warnings to report.
 */

type Item = Record<string, unknown>;

const spec = EXPORT_MODELS as Record<string, ModelExportSpec>;

/** Limits the admin API enforces too. */
export const MAX_CLIENT_CERTIFICATES = 10;
export const MAX_TRUST_ANCHORS = 50;

export interface RoleRef {
  name: string;
  clientId: string | null;
}

export interface DenyListEntry {
  x5tS256: string | null;
  issuerDn: string | null;
  serialNumber: string | null;
  reason: string | null;
}

export interface ValidatedImport {
  problems: FieldProblem[];
  warnings: string[];
  /** Keyed by the certificate's path in the file. */
  certificates: Map<string, CertificateSummary>;
  /** In the order of tlsRevokedCertificates. */
  denyList: DenyListEntry[];
  /** Group names, parents before children. */
  groupOrder: string[];
}

/** Top-level keys of a version 2 file. */
export const V2_SECTIONS = [
  'authenticationFlows',
  'clientScopes',
  'clients',
  'roles',
  'groups',
  'identityProviders',
  'samlServiceProviders',
  'userFederations',
  'tlsTrustAnchors',
  'tlsRevokedCertificates',
  'customAttributes',
  'registrationFields',
  'organizations',
  'webhooks',
  'auditLogStreams',
  'policies',
  'continuousRiskPolicies',
  'consentCategories',
  'themes',
  'scimAttributeMappings',
  'serviceAccounts',
  'nhiCredentialPolicies',
  'proxyApplications',
  'users',
] as const;

const TOP_LEVEL = [
  'version',
  'secretsIncluded',
  'usersIncluded',
  'realm',
  'omitted',
  ...V2_SECTIONS,
];

/** A realm name as the admin API accepts it: a lowercase slug. */
export function isRealmSlug(name: string): boolean {
  if (name.length < 2 || name.length > 100) return false;
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i);
    const alnum = (c >= 97 && c <= 122) || (c >= 48 && c <= 57);
    const edge = i === 0 || i === name.length - 1;
    if (!alnum && (edge || c !== 45)) return false;
  }
  return true;
}

/** base64url SHA-256, no padding: 43 characters of [A-Za-z0-9_-]. */
function isX5tS256(value: string): boolean {
  if (value.length !== 43) return false;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    const ok =
      (c >= 65 && c <= 90) ||
      (c >= 97 && c <= 122) ||
      (c >= 48 && c <= 57) ||
      c === 45 ||
      c === 95;
    if (!ok) return false;
  }
  return true;
}

const roleKey = (r: RoleRef) => `${r.clientId ?? ''}\u0000${r.name}`;

export function validateV2Import(payload: Item): ValidatedImport {
  const problems: FieldProblem[] = [];
  const warnings: string[] = [];
  const certificates = new Map<string, CertificateSummary>();
  const denyList: DenyListEntry[] = [];
  const fail = (path: string, message: string) =>
    problems.push({ path, message });

  for (const key of Object.keys(payload)) {
    if (!TOP_LEVEL.includes(key)) fail(key, 'is not a known section');
  }
  for (const key of ['secretsIncluded', 'usersIncluded']) {
    if (key in payload && typeof payload[key] !== 'boolean') {
      fail(key, 'must be a boolean');
    }
  }
  if ('omitted' in payload && !Array.isArray(payload['omitted'])) {
    fail('omitted', 'must be an array');
  }

  /** The objects of an optional array section; problems for the rest. */
  const list = (holder: Item, key: string, path: string): Item[] => {
    const value = holder[key];
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
      fail(path, 'must be an array');
      return [];
    }
    const items: Item[] = [];
    value.forEach((item, i) => {
      if (isRecord(item)) items.push(item);
      else fail(`${path}[${i}]`, 'must be an object');
    });
    return items;
  };

  /** Standard checks of one row: unknown keys, then column types. */
  const row = (model: string, item: Item, path: string, extra: string[]) => {
    checkUnknownKeys(spec[model], item, path, extra, problems);
    checkFields(spec[model], item, path, problems);
  };

  /** A list of strings (names), checked for type and duplicates. */
  const names = (holder: Item, key: string, path: string): string[] => {
    const value = holder[key];
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
      fail(path, 'must be an array of strings');
      return [];
    }
    const out: string[] = [];
    value.forEach((v, i) => {
      if (typeof v !== 'string') fail(`${path}[${i}]`, 'must be a string');
      else if (out.includes(v)) fail(`${path}[${i}]`, `'${v}' is listed twice`);
      else out.push(v);
    });
    return out;
  };

  /** Role references ({name, clientId}). */
  const roleRefs = (holder: Item, key: string, path: string): RoleRef[] => {
    const out: RoleRef[] = [];
    list(holder, key, path).forEach((r, i) => {
      const p = `${path}[${i}]`;
      for (const k of Object.keys(r)) {
        if (k !== 'name' && k !== 'clientId')
          fail(`${p}.${k}`, 'is not a known field');
      }
      if (typeof r['name'] !== 'string') fail(`${p}.name`, 'must be a string');
      const clientId = r['clientId'] ?? null;
      if (clientId !== null && typeof clientId !== 'string') {
        fail(`${p}.clientId`, 'must be a string or null');
      }
      if (
        typeof r['name'] === 'string' &&
        (clientId === null || typeof clientId === 'string')
      ) {
        out.push({ name: r['name'], clientId: clientId });
      }
    });
    return out;
  };

  /** Report duplicate natural keys within one section. */
  const unique = (
    items: Item[],
    path: string,
    key: (item: Item) => unknown,
    label: string,
  ) => {
    const seen = new Set<string>();
    items.forEach((item, i) => {
      const k = key(item);
      if (typeof k !== 'string') return;
      if (seen.has(k))
        fail(
          `${path}[${i}]`,
          `duplicate ${label} '${k.split('\u0000').join('/')}'`,
        );
      seen.add(k);
    });
  };

  /** A secret holding the API's hidden-value marker can never work. */
  const notPlaceholder = (value: unknown, path: string) => {
    if (typeof value === 'string' && value.includes(SECRET_PLACEHOLDER)) {
      fail(path, 'holds the hidden-value placeholder, not a secret');
    }
  };
  const checkSecrets = (model: string, item: Item, path: string) => {
    for (const name of Object.keys(spec[model].secrets ?? {})) {
      notPlaceholder(item[name], `${path}.${name}`);
    }
  };

  const readCertificate = (pem: unknown, path: string) => {
    if (typeof pem !== 'string') return undefined;
    try {
      const summary = summarizeCertificate(parseSingleCertificatePem(pem));
      certificates.set(path, summary);
      return summary;
    } catch (err) {
      if (
        err instanceof CertificatePemError ||
        err instanceof DistinguishedNameError
      ) {
        fail(`${path}.certificatePem`, err.message);
        return undefined;
      }
      throw err;
    }
  };

  // ─── Realm ───────────────────────────────────────────────────────────

  const realm = payload['realm'];
  if (!isRecord(realm)) {
    fail('realm', 'is required and must be an object');
    return { problems, warnings, certificates, denyList, groupOrder: [] };
  }
  row('Realm', realm, 'realm', ['browserFlow']);
  checkSecrets('Realm', realm, 'realm');
  if (typeof realm['name'] === 'string' && !isRealmSlug(realm['name'])) {
    fail('realm.name', 'must be a lowercase slug (e.g. "my-app")');
  }
  for (const [field, kind] of Object.entries(
    spec['Realm'].jsonWithSecrets ?? {},
  )) {
    const config = realm[field];
    if (config === undefined || config === null) continue;
    if (!isRecord(config)) {
      fail(`realm.${field}`, 'must be an object');
      continue;
    }
    for (const secret of providerConfigSecrets(kind, config)) {
      if (
        secret.value !== undefined &&
        secret.value !== null &&
        typeof secret.value !== 'string'
      ) {
        fail(`realm.${field}.${secret.path}`, 'must be a string');
      }
      notPlaceholder(secret.value, `realm.${field}.${secret.path}`);
    }
  }
  if (realm['smsMfaEnabled'] === true) {
    const provider = realm['smsProvider'];
    if (provider === undefined || provider === 'none') {
      fail('realm.smsMfaEnabled', 'needs an smsProvider other than "none"');
    }
  }
  const browserFlow = realm['browserFlow'] ?? null;
  if (browserFlow !== null && typeof browserFlow !== 'string') {
    fail('realm.browserFlow', 'must be a flow name or null');
  }

  // ─── Flows ───────────────────────────────────────────────────────────

  const flows = list(payload, 'authenticationFlows', 'authenticationFlows');
  flows.forEach((f, i) => {
    const path = `authenticationFlows[${i}]`;
    row('AuthenticationFlow', f, path, []);
    if (f['steps'] !== undefined) {
      for (const e of validateFlowSteps(f['steps'])) {
        fail(`${path}.${e.path}`, `${e.message} (${e.code})`);
      }
    }
  });
  unique(flows, 'authenticationFlows', (f) => f['name'], 'flow name');
  const flowNames = new Set(
    flows.map((f) => f['name']).filter((n) => typeof n === 'string'),
  );
  if (typeof browserFlow === 'string' && !flowNames.has(browserFlow)) {
    fail(
      'realm.browserFlow',
      `no flow named '${browserFlow}' in authenticationFlows`,
    );
  }

  // ─── Client scopes ───────────────────────────────────────────────────

  const scopes = list(payload, 'clientScopes', 'clientScopes');
  scopes.forEach((s, i) => {
    const path = `clientScopes[${i}]`;
    row('ClientScope', s, path, ['protocolMappers']);
    const mappers = list(s, 'protocolMappers', `${path}.protocolMappers`);
    mappers.forEach((m, j) =>
      row('ProtocolMapper', m, `${path}.protocolMappers[${j}]`, []),
    );
    unique(mappers, `${path}.protocolMappers`, (m) => m['name'], 'mapper name');
  });
  unique(scopes, 'clientScopes', (s) => s['name'], 'scope name');
  const scopeNames = new Set(scopes.map((s) => s['name']));

  // ─── Clients ─────────────────────────────────────────────────────────

  const clients = list(payload, 'clients', 'clients');
  const clientIds = new Set(
    clients.map((c) => c['clientId']).filter((c) => typeof c === 'string'),
  );
  const serviceAccountNames: string[] = [];
  const pendingRoleRefs: Array<{ path: string; ref: RoleRef }> = [];
  const pendingGroupRefs: Array<{ path: string; name: string }> = [];

  clients.forEach((c, i) => {
    const path = `clients[${i}]`;
    row('Client', c, path, [
      'authFlow',
      'defaultScopes',
      'optionalScopes',
      'serviceAccount',
      'tlsCertificates',
    ]);
    checkSecrets('Client', c, path);

    const authFlow = c['authFlow'] ?? null;
    if (authFlow !== null && typeof authFlow !== 'string') {
      fail(`${path}.authFlow`, 'must be a flow name or null');
    } else if (typeof authFlow === 'string' && !flowNames.has(authFlow)) {
      fail(
        `${path}.authFlow`,
        `no flow named '${authFlow}' in authenticationFlows`,
      );
    }

    for (const key of ['defaultScopes', 'optionalScopes']) {
      names(c, key, `${path}.${key}`).forEach((n, j) => {
        if (!scopeNames.has(n))
          fail(`${path}.${key}[${j}]`, `no client scope named '${n}'`);
      });
    }

    // Authentication settings, as the client admin API checks them.
    const rules: Array<[string, (v: unknown) => boolean]> = [
      ['tlsClientAuthSubjectDn', isValidSubjectDn],
      ['tlsClientAuthSanDns', isValidSanDns],
      ['tlsClientAuthSanUri', isValidSanUri],
      ['tlsClientAuthSanIp', isValidSanIp],
      ['tlsClientAuthSanEmail', isValidSanEmail],
    ];
    let rulesValid = true;
    for (const [field, valid] of rules) {
      const v = c[field];
      if (typeof v === 'string' && !valid(v)) {
        fail(`${path}.${field}`, 'is not a valid value for this rule');
        rulesValid = false;
      }
    }
    const clientType = c['clientType'] ?? 'CONFIDENTIAL';
    if (
      rulesValid &&
      (clientType === 'CONFIDENTIAL' || clientType === 'PUBLIC')
    ) {
      const problem = clientAuthSettingsProblem({
        clientType,
        tokenEndpointAuthMethod: (c['tokenEndpointAuthMethod'] ??
          null) as ClientAuthSettings['tokenEndpointAuthMethod'],
        tlsClientAuthSubjectDn: (c['tlsClientAuthSubjectDn'] ?? null) as
          string | null,
        tlsClientAuthSanDns: (c['tlsClientAuthSanDns'] ?? null) as
          string | null,
        tlsClientAuthSanUri: (c['tlsClientAuthSanUri'] ?? null) as
          string | null,
        tlsClientAuthSanIp: (c['tlsClientAuthSanIp'] ?? null) as string | null,
        tlsClientAuthSanEmail: (c['tlsClientAuthSanEmail'] ?? null) as
          string | null,
      });
      if (problem) fail(`${path}.tokenEndpointAuthMethod`, problem);
    }

    if (Array.isArray(c['webOrigins']) && c['webOrigins'].includes('*')) {
      warnings.push(
        `${path}.webOrigins: the wildcard origin "*" was removed; list the client's origins explicitly`,
      );
    }

    const certs = list(c, 'tlsCertificates', `${path}.tlsCertificates`);
    if (certs.length > MAX_CLIENT_CERTIFICATES) {
      fail(
        `${path}.tlsCertificates`,
        `a client can have at most ${MAX_CLIENT_CERTIFICATES} certificates`,
      );
    }
    const thumbprints = new Set<string>();
    certs.forEach((t, j) => {
      const p = `${path}.tlsCertificates[${j}]`;
      row('ClientTlsCertificate', t, p, []);
      const summary = readCertificate(t['certificatePem'], p);
      if (summary) {
        if (thumbprints.has(summary.x5tS256))
          fail(p, 'the same certificate is listed twice');
        thumbprints.add(summary.x5tS256);
      }
    });

    const sa = c['serviceAccount'];
    if (sa !== undefined && sa !== null) {
      const p = `${path}.serviceAccount`;
      if (!isRecord(sa)) {
        fail(p, 'must be an object or null');
      } else {
        for (const k of Object.keys(sa)) {
          if (!['username', 'enabled', 'roles', 'groups'].includes(k)) {
            fail(`${p}.${k}`, 'is not a known field');
          }
        }
        if (typeof sa['username'] !== 'string' || !sa['username']) {
          fail(`${p}.username`, 'must be a non-empty string');
        } else if (serviceAccountNames.includes(sa['username'])) {
          fail(
            `${p}.username`,
            `'${sa['username']}' is the service account of another client too`,
          );
        } else {
          serviceAccountNames.push(sa['username']);
        }
        if (sa['enabled'] !== undefined && typeof sa['enabled'] !== 'boolean') {
          fail(`${p}.enabled`, 'must be a boolean');
        }
        roleRefs(sa, 'roles', `${p}.roles`).forEach((ref, j) =>
          pendingRoleRefs.push({ path: `${p}.roles[${j}]`, ref }),
        );
        names(sa, 'groups', `${p}.groups`).forEach((name, j) =>
          pendingGroupRefs.push({ path: `${p}.groups[${j}]`, name }),
        );
      }
    }
  });
  unique(clients, 'clients', (c) => c['clientId'], 'clientId');

  // ─── Roles and groups ────────────────────────────────────────────────

  const roles = list(payload, 'roles', 'roles');
  roles.forEach((r, i) => {
    const path = `roles[${i}]`;
    row('Role', r, path, ['clientId']);
    const clientId = r['clientId'] ?? null;
    if (clientId !== null && typeof clientId !== 'string') {
      fail(`${path}.clientId`, 'must be a clientId or null');
    } else if (typeof clientId === 'string' && !clientIds.has(clientId)) {
      fail(`${path}.clientId`, `no client '${clientId}' in clients`);
    }
  });
  unique(
    roles,
    'roles',
    (r) =>
      typeof r['name'] === 'string'
        ? roleKey({
            name: r['name'],
            clientId: (r['clientId'] as string) ?? null,
          })
        : undefined,
    'role',
  );
  const roleKeys = new Set(
    roles.map((r) =>
      roleKey({
        name: r['name'] as string,
        clientId: (r['clientId'] as string) ?? null,
      }),
    ),
  );

  const groups = list(payload, 'groups', 'groups');
  const parentOf = new Map<string, string | null>();
  groups.forEach((g, i) => {
    const path = `groups[${i}]`;
    row('Group', g, path, ['parentName', 'roles']);
    const parent = g['parentName'] ?? null;
    if (parent !== null && typeof parent !== 'string') {
      fail(`${path}.parentName`, 'must be a group name or null');
    }
    if (typeof g['name'] === 'string') {
      parentOf.set(g['name'], typeof parent === 'string' ? parent : null);
    }
    roleRefs(g, 'roles', `${path}.roles`).forEach((ref, j) =>
      pendingRoleRefs.push({ path: `${path}.roles[${j}]`, ref }),
    );
  });
  unique(groups, 'groups', (g) => g['name'], 'group name');
  groups.forEach((g, i) => {
    const parent = g['parentName'];
    if (typeof parent === 'string' && !parentOf.has(parent)) {
      fail(`groups[${i}].parentName`, `no group named '${parent}'`);
    }
  });
  // Parents before children; a cycle can never be created.
  const groupOrder: string[] = [];
  const placed = new Set<string>();
  let progress = true;
  while (progress && placed.size < parentOf.size) {
    progress = false;
    for (const [name, parent] of parentOf) {
      if (placed.has(name)) continue;
      if (parent === null || placed.has(parent) || !parentOf.has(parent)) {
        placed.add(name);
        groupOrder.push(name);
        progress = true;
      }
    }
  }
  for (const name of parentOf.keys()) {
    if (!placed.has(name))
      fail('groups', `group '${name}' is part of a parent cycle`);
  }

  // ─── Other configuration ─────────────────────────────────────────────

  const simple = (
    section: string,
    model: string,
    key?: (item: Item) => unknown,
    label?: string,
  ) => {
    const items = list(payload, section, section);
    items.forEach((item, i) => {
      row(model, item, `${section}[${i}]`, []);
      checkSecrets(model, item, `${section}[${i}]`);
    });
    if (key && label) unique(items, section, key, label);
    return items;
  };

  simple('identityProviders', 'IdentityProvider', (i) => i['alias'], 'alias');
  simple(
    'samlServiceProviders',
    'SamlServiceProvider',
    (s) => s['entityId'],
    'entityId',
  );
  const customAttributes = simple(
    'customAttributes',
    'CustomAttribute',
    (a) => a['name'],
    'attribute name',
  );
  simple(
    'registrationFields',
    'RegistrationField',
    (f) => f['name'],
    'field name',
  );
  const webhooks = simple('webhooks', 'Webhook');
  simple('auditLogStreams', 'AuditLogStream');
  simple('policies', 'Policy');
  simple(
    'continuousRiskPolicies',
    'ContinuousRiskPolicy',
    (p) =>
      typeof p['name'] === 'string'
        ? `${(p['clientId'] as string) ?? ''}\u0000${p['name']}`
        : undefined,
    'policy',
  );
  simple('themes', 'Theme', (t) => t['name'], 'theme name');
  simple(
    'scimAttributeMappings',
    'ScimAttributeMapping',
    (m) =>
      typeof m['scimAttribute'] === 'string'
        ? `${m['resourceType'] as string}\u0000${m['scimAttribute']}`
        : undefined,
    'mapping',
  );
  simple(
    'serviceAccounts',
    'ServiceAccount',
    (s) => s['name'],
    'service account name',
  );
  simple(
    'nhiCredentialPolicies',
    'NhiCredentialPolicy',
    (p) => p['name'],
    'policy name',
  );
  webhooks.forEach((w, i) => {
    if (w['secret'] !== undefined && w['secret'] === '') {
      fail(`webhooks[${i}].secret`, 'must not be empty');
    }
  });

  const federations = list(payload, 'userFederations', 'userFederations');
  federations.forEach((f, i) => {
    const path = `userFederations[${i}]`;
    row('UserFederation', f, path, ['mappers']);
    checkSecrets('UserFederation', f, path);
    const mappers = list(f, 'mappers', `${path}.mappers`);
    mappers.forEach((m, j) =>
      row('UserFederationMapper', m, `${path}.mappers[${j}]`, []),
    );
    unique(mappers, `${path}.mappers`, (m) => m['name'], 'mapper name');
  });
  unique(federations, 'userFederations', (f) => f['name'], 'federation name');

  const anchors = list(payload, 'tlsTrustAnchors', 'tlsTrustAnchors');
  if (anchors.length > MAX_TRUST_ANCHORS) {
    fail(
      'tlsTrustAnchors',
      `a realm can have at most ${MAX_TRUST_ANCHORS} trust anchors`,
    );
  }
  const anchorThumbprints = new Set<string>();
  anchors.forEach((a, i) => {
    const path = `tlsTrustAnchors[${i}]`;
    row('RealmTlsTrustAnchor', a, path, []);
    const summary = readCertificate(a['certificatePem'], path);
    if (!summary) return;
    const problem = isCaCertificate(
      parseSingleCertificatePem(a['certificatePem']),
    );
    if (problem)
      fail(`${path}.certificatePem`, `not a usable trust anchor: ${problem}`);
    if (anchorThumbprints.has(summary.x5tS256))
      fail(path, 'the same trust anchor is listed twice');
    anchorThumbprints.add(summary.x5tS256);
  });

  list(payload, 'tlsRevokedCertificates', 'tlsRevokedCertificates').forEach(
    (r, i) => {
      const path = `tlsRevokedCertificates[${i}]`;
      const before = problems.length;
      row('TlsRevokedCertificate', r, path, []);
      if (problems.length > before) return;
      const entry: DenyListEntry = {
        x5tS256: (r['x5tS256'] as string | null | undefined) ?? null,
        issuerDn: null,
        serialNumber: null,
        reason: (r['reason'] as string | null | undefined) ?? null,
      };
      if (entry.x5tS256 !== null && !isX5tS256(entry.x5tS256)) {
        fail(
          `${path}.x5tS256`,
          'must be a base64url SHA-256 thumbprint (43 characters)',
        );
      }
      const issuer = r['issuerDn'] ?? null;
      const serial = r['serialNumber'] ?? null;
      if ((issuer === null) !== (serial === null)) {
        fail(path, 'issuerDn and serialNumber go together');
      } else if (typeof issuer === 'string' && typeof serial === 'string') {
        try {
          const parsed = parseRfc4514(issuer);
          if (parsed.length === 0) throw new DistinguishedNameError('empty');
          entry.issuerDn = canonicalDn(parsed);
        } catch (err) {
          if (!(err instanceof DistinguishedNameError)) throw err;
          fail(
            `${path}.issuerDn`,
            `is not an RFC 4514 distinguished name: ${err.message}`,
          );
        }
        entry.serialNumber = normalizeSerial(serial) ?? null;
        if (!entry.serialNumber)
          fail(`${path}.serialNumber`, 'must be hexadecimal');
      }
      if (!entry.x5tS256 && !(issuer && serial)) {
        fail(
          path,
          'name the certificate: x5tS256, or issuerDn with serialNumber',
        );
      }
      denyList.push(entry);
    },
  );

  const consent = list(payload, 'consentCategories', 'consentCategories');
  consent.forEach((c, i) => {
    const path = `consentCategories[${i}]`;
    row('ConsentCategory', c, path, ['policies']);
    list(c, 'policies', `${path}.policies`).forEach((p, j) =>
      row('ConsentPolicy', p, `${path}.policies[${j}]`, []),
    );
  });
  unique(consent, 'consentCategories', (c) => c['key'], 'category key');

  const proxies = list(payload, 'proxyApplications', 'proxyApplications');
  proxies.forEach((p, i) => {
    const path = `proxyApplications[${i}]`;
    row('ProxyApplication', p, path, ['client']);
    if (typeof p['client'] !== 'string') {
      fail(
        `${path}.client`,
        "must be the clientId of the application's client",
      );
    } else if (!clientIds.has(p['client'])) {
      fail(`${path}.client`, `no client '${p['client']}' in clients`);
    }
  });
  unique(proxies, 'proxyApplications', (p) => p['slug'], 'slug');

  // ─── Users (optional) ────────────────────────────────────────────────

  const users = list(payload, 'users', 'users');
  const usernames = new Set<string>();
  const attributeNames = new Set(customAttributes.map((a) => a['name']));
  users.forEach((u, i) => {
    const path = `users[${i}]`;
    row('User', u, path, ['roles', 'groups', 'attributes']);
    roleRefs(u, 'roles', `${path}.roles`).forEach((ref, j) =>
      pendingRoleRefs.push({ path: `${path}.roles[${j}]`, ref }),
    );
    names(u, 'groups', `${path}.groups`).forEach((name, j) =>
      pendingGroupRefs.push({ path: `${path}.groups[${j}]`, name }),
    );
    const attributes = u['attributes'];
    if (attributes !== undefined) {
      if (!isRecord(attributes)) {
        fail(
          `${path}.attributes`,
          'must be an object of attribute name to value',
        );
      } else {
        for (const [name, value] of Object.entries(attributes)) {
          if (!attributeNames.has(name))
            fail(
              `${path}.attributes.${name}`,
              `no custom attribute named '${name}'`,
            );
          if (typeof value !== 'string')
            fail(`${path}.attributes.${name}`, 'must be a string');
        }
      }
    }
    if (typeof u['username'] === 'string') {
      if (serviceAccountNames.includes(u['username'])) {
        fail(
          `${path}.username`,
          `'${u['username']}' is a client's service account; it is created with the client`,
        );
      }
      usernames.add(u['username']);
    }
  });
  unique(users, 'users', (u) => u['username'], 'username');
  unique(
    users,
    'users',
    (u) => (typeof u['email'] === 'string' ? u['email'] : undefined),
    'email',
  );

  const organizations = list(payload, 'organizations', 'organizations');
  organizations.forEach((o, i) => {
    const path = `organizations[${i}]`;
    row('Organization', o, path, ['ssoConnections', 'members']);
    list(o, 'ssoConnections', `${path}.ssoConnections`).forEach((s, j) => {
      row('OrganizationSsoConnection', s, `${path}.ssoConnections[${j}]`, []);
    });
    const members = list(o, 'members', `${path}.members`);
    members.forEach((m, j) => {
      const p = `${path}.members[${j}]`;
      row('OrganizationMember', m, p, ['username']);
      if (typeof m['username'] !== 'string') {
        fail(`${p}.username`, 'must be a string');
      } else if (!usernames.has(m['username'])) {
        fail(`${p}.username`, `no user '${m['username']}' in users`);
      }
    });
    unique(members, `${path}.members`, (m) => m['username'], 'member');
  });
  unique(organizations, 'organizations', (o) => o['slug'], 'slug');

  // ─── References collected above ──────────────────────────────────────

  for (const { path, ref } of pendingRoleRefs) {
    if (!roleKeys.has(roleKey(ref))) {
      fail(
        path,
        ref.clientId
          ? `no role '${ref.name}' of client '${ref.clientId}' in roles`
          : `no realm role '${ref.name}' in roles`,
      );
    }
  }
  for (const { path, name } of pendingGroupRefs) {
    if (!parentOf.has(name)) fail(path, `no group named '${name}' in groups`);
  }

  return { problems, warnings, certificates, denyList, groupOrder };
}
