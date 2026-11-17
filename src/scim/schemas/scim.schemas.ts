/**
 * SCIM 2.0 discovery: the schemas (RFC 7643 §7), resource types (§6) and
 * service provider configuration (§5) this server publishes.
 *
 * They describe what the server does, not the whole of RFC 7643: an
 * attribute is listed only when it is stored and returned, and a feature is
 * `supported` only when it works. ims, photos, entitlements, roles and
 * x509Certificates are not stored, so they are not listed (a client that
 * sends them anyway is not refused; the values are dropped).
 */

import type {
  ScimSchema,
  ScimSchemaAttribute,
  ScimResourceType,
  ScimServiceProviderConfig,
} from '../types/scim.types.js';
import { SCIM_SCHEMAS } from '../types/scim.types.js';
import { SCIM_JSON_BODY_LIMIT } from '../../common/http/body-parsers.js';

/** The SCIM JSON body limit, in bytes (the body parser enforces it). */
export const SCIM_MAX_PAYLOAD_BYTES = SCIM_JSON_BODY_LIMIT;
/** Most operations in one Bulk request. */
export const SCIM_BULK_MAX_OPERATIONS = 1000;

const DOCS_URI = 'https://idenplane.com/guides/scim';

type AttributeOptions = Partial<Omit<ScimSchemaAttribute, 'name' | 'type'>>;

/**
 * An attribute with every characteristic RFC 7643 §7 lists, defaulted as
 * §2.2 defaults them.
 */
function attr(
  name: string,
  type: string,
  description: string,
  options: AttributeOptions = {},
): ScimSchemaAttribute {
  const attribute: ScimSchemaAttribute = {
    name,
    type,
    multiValued: false,
    description,
    required: false,
    caseExact: false,
    mutability: 'readWrite',
    returned: 'default',
    uniqueness: 'none',
    ...options,
  };
  if (type === 'complex' || type === 'boolean') {
    delete attribute.caseExact;
    delete attribute.uniqueness;
  }
  return attribute;
}

const str = (name: string, description: string, options?: AttributeOptions) =>
  attr(name, 'string', description, options);

const typeAttr = (canonicalValues: string[]) =>
  str('type', 'A label for the value, e.g. "work".', { canonicalValues });

const primaryAttr = attr(
  'primary',
  'boolean',
  'Whether this is the preferred value.',
);

// User Schema - RFC 7643 Section 4.1
export const USER_SCHEMA: ScimSchema = {
  id: SCIM_SCHEMAS.USER,
  name: 'User',
  description: 'User Account',
  attributes: [
    str('userName', 'Unique identifier for the user; unique in the realm.', {
      required: true,
      returned: 'always',
      uniqueness: 'server',
    }),
    attr('name', 'complex', "The components of the user's name.", {
      subAttributes: [
        str('formatted', 'The full name, formatted for display.'),
        str('familyName', 'The family name (last name).'),
        str('givenName', 'The given name (first name).'),
        str('middleName', 'The middle name(s).'),
        str('honorificPrefix', 'The honorific prefix, e.g. "Ms.".'),
        str('honorificSuffix', 'The honorific suffix, e.g. "III".'),
      ],
    }),
    str(
      'displayName',
      'The name to display. When none was set, "givenName familyName".',
    ),
    str('nickName', 'The casual name of the user.'),
    attr('profileUrl', 'reference', "A URI of the user's online profile.", {
      referenceTypes: ['external'],
    }),
    str('title', 'The user\'s title, e.g. "Vice President".'),
    str('userType', 'The relationship to the organisation, e.g. "Employee".'),
    str('preferredLanguage', 'The preferred language (RFC 7231 tag).'),
    str('locale', 'The default location, e.g. "en-US".'),
    str('timezone', 'The time zone, in IANA format, e.g. "Europe/Paris".'),
    attr('active', 'boolean', 'Whether the user may sign in.'),
    str(
      'password',
      "The user's cleartext password. Write-only: checked against the realm's password policy, stored hashed, never returned.",
      { mutability: 'writeOnly', returned: 'never', caseExact: true },
    ),
    attr(
      'emails',
      'complex',
      'The user\'s email. One is stored: the primary (or first) one, returned with type "work".',
      {
        multiValued: true,
        subAttributes: [
          str('value', 'The email address.'),
          str('display', 'A label for display.', { mutability: 'readOnly' }),
          typeAttr(['work', 'home', 'other']),
          primaryAttr,
        ],
      },
    ),
    attr('phoneNumbers', 'complex', "The user's phone numbers.", {
      multiValued: true,
      subAttributes: [
        str('value', 'The phone number.'),
        str('display', 'A label for display.'),
        typeAttr(['work', 'home', 'mobile', 'fax', 'pager', 'other']),
        primaryAttr,
      ],
    }),
    attr('addresses', 'complex', "The user's physical addresses.", {
      multiValued: true,
      subAttributes: [
        str('formatted', 'The full address, formatted for display.'),
        str('streetAddress', 'The street address.'),
        str('locality', 'The city or locality.'),
        str('region', 'The state or region.'),
        str('postalCode', 'The postal code.'),
        str('country', 'The country (ISO 3166-1 alpha-2).'),
        typeAttr(['work', 'home', 'other']),
        primaryAttr,
      ],
    }),
    attr(
      'groups',
      'complex',
      'The groups the user belongs to. Read-only: change membership through the Group.',
      {
        multiValued: true,
        mutability: 'readOnly',
        subAttributes: [
          str('value', 'The id of the group.', { mutability: 'readOnly' }),
          attr('$ref', 'reference', 'The URI of the group.', {
            mutability: 'readOnly',
            referenceTypes: ['Group'],
          }),
          str('display', 'The name of the group.', {
            mutability: 'readOnly',
          }),
          str('type', 'How the user belongs to the group.', {
            mutability: 'readOnly',
            canonicalValues: ['direct', 'indirect'],
          }),
        ],
      },
    ),
    str('externalId', "The provisioning client's identifier for the user.", {
      caseExact: true,
    }),
  ],
};

// Group Schema - RFC 7643 Section 4.2
export const GROUP_SCHEMA: ScimSchema = {
  id: SCIM_SCHEMAS.GROUP,
  name: 'Group',
  description: 'Group',
  attributes: [
    str('displayName', 'The name of the group; unique in the realm.', {
      required: true,
      returned: 'always',
      uniqueness: 'server',
    }),
    attr('members', 'complex', 'The users in the group.', {
      multiValued: true,
      subAttributes: [
        str('value', 'The id of the user.', { mutability: 'immutable' }),
        attr('$ref', 'reference', 'The URI of the user.', {
          mutability: 'immutable',
          referenceTypes: ['User'],
        }),
        str('display', 'The userName of the user.', {
          mutability: 'readOnly',
        }),
        str('type', 'The type of member. Only users can be members.', {
          mutability: 'immutable',
          canonicalValues: ['User'],
        }),
      ],
    }),
    str('externalId', "The provisioning client's identifier for the group.", {
      caseExact: true,
    }),
  ],
};

// Enterprise User Schema Extension - RFC 7643 Section 4.3
export const ENTERPRISE_USER_SCHEMA: ScimSchema = {
  id: SCIM_SCHEMAS.ENTERPRISE_USER,
  name: 'EnterpriseUser',
  description: 'Enterprise User',
  attributes: [
    str('employeeNumber', 'The employee number.'),
    str('costCenter', 'The cost center.'),
    str('organization', 'The organisation.'),
    str('division', 'The division.'),
    str('department', 'The department.'),
    attr('manager', 'complex', "The user's manager.", {
      subAttributes: [
        str('value', 'The id of the manager (as the client knows it).'),
      ],
    }),
  ],
};

// User Resource Type
export const USER_RESOURCE_TYPE: ScimResourceType = {
  schemas: [SCIM_SCHEMAS.RESOURCE_TYPE],
  id: 'User',
  name: 'User',
  description: 'User Account',
  endpoint: '/Users',
  schema: SCIM_SCHEMAS.USER,
  schemaExtensions: [{ schema: SCIM_SCHEMAS.ENTERPRISE_USER, required: false }],
};

// Group Resource Type
export const GROUP_RESOURCE_TYPE: ScimResourceType = {
  schemas: [SCIM_SCHEMAS.RESOURCE_TYPE],
  id: 'Group',
  name: 'Group',
  description: 'Group',
  endpoint: '/Groups',
  schema: SCIM_SCHEMAS.GROUP,
  schemaExtensions: [],
};

// Service Provider Configuration - RFC 7643 Section 5
export const SERVICE_PROVIDER_CONFIG: ScimServiceProviderConfig = {
  schemas: [SCIM_SCHEMAS.SERVICE_PROVIDER_CONFIG],
  documentationUri: DOCS_URI,
  patch: { supported: true },
  bulk: {
    supported: true,
    maxOperations: SCIM_BULK_MAX_OPERATIONS,
    maxPayloadSize: SCIM_MAX_PAYLOAD_BYTES,
  },
  filter: {
    supported: true,
    maxResults: 100,
    supportedOperators: [
      'eq',
      'ne',
      'co',
      'sw',
      'ew',
      'gt',
      'ge',
      'lt',
      'le',
      'pr',
    ],
  },
  changePassword: { supported: true },
  sort: { supported: false },
  etag: { supported: false },
  authenticationSchemes: [
    {
      name: 'OAuth Bearer Token',
      description:
        'A SCIM token created for the realm, sent as "Authorization: Bearer <token>"',
      specUri: 'https://www.rfc-editor.org/rfc/rfc6750',
      documentationUri: DOCS_URI,
      type: 'oauthbearertoken',
      primary: true,
    },
  ],
};

// All schemas for discovery
export const ALL_SCHEMAS: ScimSchema[] = [
  USER_SCHEMA,
  GROUP_SCHEMA,
  ENTERPRISE_USER_SCHEMA,
];

// Resource types for discovery
export const ALL_RESOURCE_TYPES: ScimResourceType[] = [
  USER_RESOURCE_TYPE,
  GROUP_RESOURCE_TYPE,
];
