import type { ApiBodyOptions } from '@nestjs/swagger';
import { EXPORT_MODELS, type ModelExportSpec } from './realm-export.fields.js';
import { parseFieldType, enumValues } from './field-codec.js';

/**
 * OpenAPI description of the version 2 realm export, built from the same
 * allow-list the export uses, so the docs list every exported field.
 */

const spec = EXPORT_MODELS as Record<string, ModelExportSpec>;

/** @nestjs/swagger's SchemaObject (not exported from the package root). */
type SchemaObject = Exclude<
  Extract<ApiBodyOptions, { schema: unknown }>['schema'],
  { $ref: string }
>;

function property(type: string): SchemaObject {
  const t = parseFieldType(type);
  let base: SchemaObject;
  switch (t.base) {
    case 'String':
      base = { type: 'string' };
      break;
    case 'Int':
      base = { type: 'integer' };
      break;
    case 'Float':
      base = { type: 'number' };
      break;
    case 'Boolean':
      base = { type: 'boolean' };
      break;
    case 'DateTime':
      base = { type: 'string', format: 'date-time' };
      break;
    case 'Json':
      base = {};
      break;
    default:
      base = { type: 'string', enum: enumValues(t.base) };
  }
  if (t.list) return { type: 'array', items: base };
  return t.nullable ? { ...base, nullable: true } : base;
}

function model(
  name: string,
  extra: Record<string, SchemaObject> = {},
): SchemaObject {
  const s = spec[name];
  const properties: Record<string, SchemaObject> = {};
  const required: string[] = [];
  for (const [field, type] of Object.entries(s.fields)) {
    properties[field] = property(type);
    if (parseFieldType(type).required) required.push(field);
  }
  for (const [field, secret] of Object.entries(s.secrets ?? {})) {
    properties[field] = {
      ...property(secret.type),
      description: 'Secret: exported only with includeSecrets=true',
    };
  }
  return {
    type: 'object',
    properties: { ...properties, ...extra },
    ...(required.length ? { required } : {}),
  };
}

const array = (items: SchemaObject): SchemaObject => ({ type: 'array', items });
const names: SchemaObject = array({ type: 'string' });
const roleRefs: SchemaObject = array({
  type: 'object',
  properties: {
    name: { type: 'string' },
    clientId: { type: 'string', nullable: true },
  },
});

export const REALM_EXPORT_V2_SCHEMA: SchemaObject = {
  type: 'object',
  description:
    'Realm export, format version 2. References between objects use natural keys (flow name, clientId, scope name, role name + clientId, group name, username). Imports also accept version 1 files.',
  required: ['version', 'realm'],
  properties: {
    version: { type: 'integer', enum: [2] },
    secretsIncluded: { type: 'boolean' },
    usersIncluded: { type: 'boolean' },
    realm: model('Realm', {
      browserFlow: { type: 'string', nullable: true, description: 'Flow name' },
    }),
    authenticationFlows: array(model('AuthenticationFlow')),
    clientScopes: array(
      model('ClientScope', { protocolMappers: array(model('ProtocolMapper')) }),
    ),
    clients: array(
      model('Client', {
        authFlow: { type: 'string', nullable: true, description: 'Flow name' },
        defaultScopes: names,
        optionalScopes: names,
        serviceAccount: {
          type: 'object',
          nullable: true,
          properties: {
            username: { type: 'string' },
            enabled: { type: 'boolean' },
            roles: roleRefs,
            groups: names,
          },
        },
        tlsCertificates: array(model('ClientTlsCertificate')),
      }),
    ),
    roles: array(
      model('Role', { clientId: { type: 'string', nullable: true } }),
    ),
    groups: array(
      model('Group', {
        parentName: { type: 'string', nullable: true },
        roles: roleRefs,
      }),
    ),
    identityProviders: array(model('IdentityProvider')),
    samlServiceProviders: array(model('SamlServiceProvider')),
    userFederations: array(
      model('UserFederation', {
        mappers: array(model('UserFederationMapper')),
      }),
    ),
    tlsTrustAnchors: array(model('RealmTlsTrustAnchor')),
    tlsRevokedCertificates: array(model('TlsRevokedCertificate')),
    customAttributes: array(model('CustomAttribute')),
    registrationFields: array(model('RegistrationField')),
    organizations: array(
      model('Organization', {
        ssoConnections: array(model('OrganizationSsoConnection')),
        members: array(
          model('OrganizationMember', { username: { type: 'string' } }),
        ),
      }),
    ),
    webhooks: array(model('Webhook')),
    auditLogStreams: array(model('AuditLogStream')),
    policies: array(model('Policy')),
    continuousRiskPolicies: array(model('ContinuousRiskPolicy')),
    consentCategories: array(
      model('ConsentCategory', { policies: array(model('ConsentPolicy')) }),
    ),
    themes: array(model('Theme')),
    scimAttributeMappings: array(model('ScimAttributeMapping')),
    serviceAccounts: array(model('ServiceAccount')),
    nhiCredentialPolicies: array(model('NhiCredentialPolicy')),
    proxyApplications: array(
      model('ProxyApplication', {
        client: { type: 'string', description: 'clientId' },
      }),
    ),
    users: array(
      model('User', {
        roles: roleRefs,
        groups: names,
        attributes: {
          type: 'object',
          additionalProperties: { type: 'string' },
        },
      }),
    ),
    omitted: array({
      type: 'object',
      description: 'Objects the export left out, and why (ignored on import)',
      properties: {
        type: { type: 'string' },
        key: { type: 'string' },
        reason: { type: 'string' },
      },
    }),
  },
};

export const REALM_IMPORT_RESULT_SCHEMA: SchemaObject = {
  type: 'object',
  properties: {
    realmName: { type: 'string' },
    version: {
      type: 'integer',
      description: 'Format that was imported (2 only)',
    },
    clientsImported: { type: 'integer' },
    rolesImported: { type: 'integer' },
    groupsImported: { type: 'integer' },
    scopesImported: { type: 'integer' },
    idpsImported: { type: 'integer' },
    usersImported: { type: 'integer' },
    flowsImported: { type: 'integer' },
    warnings: {
      type: 'array',
      items: { type: 'string' },
      description:
        'What needs attention, e.g. secrets that were not in the file (version 2 only)',
    },
  },
};
