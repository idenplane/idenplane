/**
 * SCIM 2.0 Schema Definitions
 * RFC 7643 - SCIM Schema Specification
 */

import type {
  ScimSchema,
  ScimResourceType,
  ScimServiceProviderConfig,
} from '../types/scim.types.js';

// User Schema - RFC 7643 Section 4.1
export const USER_SCHEMA: ScimSchema = {
  id: 'urn:scim:schemas:core:1.0:User',
  name: 'User',
  description: 'User Account',
  attributes: [
    {
      name: 'userName',
      type: 'string',
      required: true,
      caseExact: false,
      mutability: 'readWrite',
      returned: 'always',
      uniqueness: 'server',
    },
    {
      name: 'name',
      type: 'complex',
      required: false,
      multiValued: false,
      mutability: 'readWrite',
      returned: 'always',
      subAttributes: [
        {
          name: 'formatted',
          type: 'string',
          mutability: 'readWrite',
          returned: 'always',
        },
        {
          name: 'familyName',
          type: 'string',
          mutability: 'readWrite',
          returned: 'always',
        },
        {
          name: 'givenName',
          type: 'string',
          mutability: 'readWrite',
          returned: 'always',
        },
        {
          name: 'middleName',
          type: 'string',
          mutability: 'readWrite',
          returned: 'never',
        },
        {
          name: 'honorificPrefix',
          type: 'string',
          mutability: 'readWrite',
          returned: 'never',
        },
        {
          name: 'honorificSuffix',
          type: 'string',
          mutability: 'readWrite',
          returned: 'never',
        },
      ],
    },
    {
      name: 'displayName',
      type: 'string',
      required: false,
      caseExact: false,
      mutability: 'readWrite',
      returned: 'always',
    },
    {
      name: 'emails',
      type: 'complex',
      required: false,
      multiValued: true,
      mutability: 'readWrite',
      returned: 'always',
      uniqueness: 'none',
      subAttributes: [
        {
          name: 'value',
          type: 'string',
          mutability: 'readWrite',
          returned: 'always',
        },
        {
          name: 'type',
          type: 'string',
          mutability: 'readWrite',
          returned: 'always',
        },
        {
          name: 'primary',
          type: 'boolean',
          mutability: 'readWrite',
          returned: 'never',
        },
        {
          name: 'display',
          type: 'string',
          mutability: 'readOnly',
          returned: 'always',
        },
      ],
    },
    {
      name: 'phoneNumbers',
      type: 'complex',
      required: false,
      multiValued: true,
      mutability: 'readWrite',
      returned: 'always',
      uniqueness: 'none',
      subAttributes: [
        {
          name: 'value',
          type: 'string',
          mutability: 'readWrite',
          returned: 'always',
        },
        {
          name: 'type',
          type: 'string',
          mutability: 'readWrite',
          returned: 'always',
        },
        {
          name: 'primary',
          type: 'boolean',
          mutability: 'readWrite',
          returned: 'never',
        },
      ],
    },
    {
      name: 'addresses',
      type: 'complex',
      required: false,
      multiValued: true,
      mutability: 'readWrite',
      returned: 'always',
      uniqueness: 'none',
      subAttributes: [
        {
          name: 'formatted',
          type: 'string',
          mutability: 'readWrite',
          returned: 'always',
        },
        {
          name: 'streetAddress',
          type: 'string',
          mutability: 'readWrite',
          returned: 'always',
        },
        {
          name: 'locality',
          type: 'string',
          mutability: 'readWrite',
          returned: 'always',
        },
        {
          name: 'region',
          type: 'string',
          mutability: 'readWrite',
          returned: 'always',
        },
        {
          name: 'postalCode',
          type: 'string',
          mutability: 'readWrite',
          returned: 'always',
        },
        {
          name: 'country',
          type: 'string',
          mutability: 'readWrite',
          returned: 'always',
        },
        {
          name: 'type',
          type: 'string',
          mutability: 'readWrite',
          returned: 'always',
        },
        {
          name: 'primary',
          type: 'boolean',
          mutability: 'readWrite',
          returned: 'never',
        },
      ],
    },
    {
      name: 'active',
      type: 'boolean',
      required: false,
      mutability: 'readWrite',
      returned: 'always',
    },
    {
      name: 'title',
      type: 'string',
      required: false,
      caseExact: false,
      mutability: 'readWrite',
      returned: 'never',
    },
    {
      name: 'userType',
      type: 'string',
      required: false,
      caseExact: false,
      mutability: 'readWrite',
      returned: 'never',
    },
    {
      name: 'preferredLanguage',
      type: 'string',
      required: false,
      caseExact: false,
      mutability: 'readWrite',
      returned: 'never',
    },
    {
      name: 'locale',
      type: 'string',
      required: false,
      caseExact: false,
      mutability: 'readWrite',
      returned: 'never',
    },
    {
      name: 'timezone',
      type: 'string',
      required: false,
      caseExact: false,
      mutability: 'readWrite',
      returned: 'never',
    },
    {
      name: 'groups',
      type: 'complex',
      required: false,
      multiValued: true,
      mutability: 'readOnly',
      returned: 'never',
      uniqueness: 'none',
      subAttributes: [
        {
          name: 'value',
          type: 'string',
          mutability: 'readOnly',
          returned: 'never',
        },
        {
          name: 'display',
          type: 'string',
          mutability: 'readOnly',
          returned: 'never',
        },
        {
          name: 'type',
          type: 'string',
          mutability: 'readOnly',
          returned: 'never',
        },
      ],
    },
    {
      name: 'entitlements',
      type: 'string',
      required: false,
      multiValued: true,
      caseExact: false,
      mutability: 'readWrite',
      returned: 'never',
    },
    {
      name: 'roles',
      type: 'string',
      required: false,
      multiValued: true,
      caseExact: false,
      mutability: 'readWrite',
      returned: 'never',
    },
    {
      name: 'x509Certificates',
      type: 'complex',
      required: false,
      multiValued: true,
      mutability: 'readOnly',
      returned: 'never',
      uniqueness: 'none',
      subAttributes: [
        {
          name: 'value',
          type: 'string',
          mutability: 'readOnly',
          returned: 'never',
        },
        {
          name: 'type',
          type: 'string',
          mutability: 'readWrite',
          returned: 'never',
        },
      ],
    },
    {
      name: 'externalId',
      type: 'string',
      required: false,
      caseExact: false,
      mutability: 'readWrite',
      returned: 'always',
      uniqueness: 'none',
    },
    {
      name: 'meta',
      type: 'complex',
      required: false,
      multiValued: false,
      mutability: 'readOnly',
      returned: 'never',
      subAttributes: [
        {
          name: 'resourceType',
          type: 'string',
          mutability: 'readOnly',
          returned: 'never',
        },
        {
          name: 'created',
          type: 'dateTime',
          mutability: 'readOnly',
          returned: 'never',
        },
        {
          name: 'lastModified',
          type: 'dateTime',
          mutability: 'readOnly',
          returned: 'never',
        },
        {
          name: 'version',
          type: 'string',
          mutability: 'readOnly',
          returned: 'never',
        },
        {
          name: 'location',
          type: 'string',
          mutability: 'readOnly',
          returned: 'never',
        },
      ],
    },
  ],
  type: 'resource',
};

// Group Schema - RFC 7643 Section 4.2
export const GROUP_SCHEMA: ScimSchema = {
  id: 'urn:scim:schemas:core:1.0:Group',
  name: 'Group',
  description: 'Group',
  attributes: [
    {
      name: 'displayName',
      type: 'string',
      required: true,
      caseExact: false,
      mutability: 'readWrite',
      returned: 'always',
      uniqueness: 'server',
    },
    {
      name: 'members',
      type: 'complex',
      required: false,
      multiValued: true,
      mutability: 'readWrite',
      returned: 'always',
      uniqueness: 'none',
      subAttributes: [
        {
          name: 'value',
          type: 'string',
          mutability: 'readOnly',
          returned: 'never',
        },
        {
          name: 'display',
          type: 'string',
          mutability: 'readOnly',
          returned: 'never',
        },
        {
          name: 'type',
          type: 'string',
          mutability: 'readOnly',
          returned: 'never',
          referenceTypes: ['User', 'Group'],
        },
        {
          name: '$ref',
          type: 'string',
          mutability: 'readOnly',
          returned: 'never',
        },
      ],
    },
    {
      name: 'externalId',
      type: 'string',
      required: false,
      caseExact: false,
      mutability: 'readWrite',
      returned: 'always',
      uniqueness: 'none',
    },
    {
      name: 'meta',
      type: 'complex',
      required: false,
      multiValued: false,
      mutability: 'readOnly',
      returned: 'never',
      subAttributes: [
        {
          name: 'resourceType',
          type: 'string',
          mutability: 'readOnly',
          returned: 'never',
        },
        {
          name: 'created',
          type: 'dateTime',
          mutability: 'readOnly',
          returned: 'never',
        },
        {
          name: 'lastModified',
          type: 'dateTime',
          mutability: 'readOnly',
          returned: 'never',
        },
        {
          name: 'version',
          type: 'string',
          mutability: 'readOnly',
          returned: 'never',
        },
        {
          name: 'location',
          type: 'string',
          mutability: 'readOnly',
          returned: 'never',
        },
      ],
    },
  ],
  type: 'resource',
};

// Enterprise User Schema Extension - RFC 7643 Section 4.3
export const ENTERPRISE_USER_SCHEMA: ScimSchema = {
  id: 'urn:scim:schemas:extension:enterprise:1.0',
  name: 'EnterpriseUser',
  description: 'Enterprise User Extension',
  attributes: [
    {
      name: 'employeeNumber',
      type: 'string',
      required: false,
      caseExact: false,
      mutability: 'readWrite',
      returned: 'never',
    },
    {
      name: 'costCenter',
      type: 'string',
      required: false,
      caseExact: false,
      mutability: 'readWrite',
      returned: 'never',
    },
    {
      name: 'organization',
      type: 'string',
      required: false,
      caseExact: false,
      mutability: 'readWrite',
      returned: 'never',
    },
    {
      name: 'division',
      type: 'string',
      required: false,
      caseExact: false,
      mutability: 'readWrite',
      returned: 'never',
    },
    {
      name: 'department',
      type: 'string',
      required: false,
      caseExact: false,
      mutability: 'readWrite',
      returned: 'never',
    },
    {
      name: 'manager',
      type: 'complex',
      required: false,
      multiValued: false,
      mutability: 'readWrite',
      returned: 'never',
      subAttributes: [
        {
          name: 'value',
          type: 'string',
          mutability: 'readWrite',
          returned: 'never',
          referenceTypes: ['User'],
        },
        {
          name: 'displayName',
          type: 'string',
          mutability: 'readOnly',
          returned: 'never',
        },
      ],
    },
  ],
  type: 'schema',
};

// User Resource Type
export const USER_RESOURCE_TYPE: ScimResourceType = {
  schemas: ['urn:scim:schemas:core:1.0:ResourceType'],
  id: 'User',
  name: 'User',
  description: 'User Account',
  endpoint: '/Users',
  schema: 'urn:scim:schemas:core:1.0:User',
  schemaExtensions: [
    { schema: 'urn:scim:schemas:extension:enterprise:1.0', required: false },
  ],
};

// Group Resource Type
export const GROUP_RESOURCE_TYPE: ScimResourceType = {
  schemas: ['urn:scim:schemas:core:1.0:ResourceType'],
  id: 'Group',
  name: 'Group',
  description: 'Group',
  endpoint: '/Groups',
  schema: 'urn:scim:schemas:core:1.0:Group',
  schemaExtensions: [],
};

// Service Provider Configuration - RFC 7644 Section 4
export const SERVICE_PROVIDER_CONFIG: ScimServiceProviderConfig = {
  schemas: ['urn:scim:schemas:core:1.0:ServiceProviderConfig'],
  documentationUri: 'https://authme.example.com/docs/scim',
  patch: { supported: true },
  bulk: {
    supported: true,
    maxOperations: 1000,
    maxPayloadSize: 10485760, // 10MB
  },
  filter: {
    supported: true,
    maxResults: 100,
    supportedOperators: ['eq', 'ne', 'co', 'sw', 'ew', 'gt', 'lt', 'le'],
  },
  changePassword: { supported: false },
  sort: { supported: false },
  etag: { supported: true },
  authenticationSchemes: [
    {
      name: 'OAuth Bearer Token',
      description:
        'Authentication scheme using the OAuth Bearer Token Standard',
      specUri: 'https://www.rfc-editor.org/rfc/rfc6750',
      documentationUri: 'https://authme.example.com/docs/scim/auth',
      type: 'oauthbearertoken',
      primary: true,
    },
    {
      name: 'API Key',
      description: 'Authentication scheme using an API key',
      specUri: 'https://authme.example.com/docs/scim/auth',
      documentationUri: 'https://authme.example.com/docs/scim/auth',
      type: 'apiKey',
      primary: false,
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

// Map AuthMe attributes to SCIM attributes
export const DEFAULT_USER_ATTRIBUTE_MAPPING: Record<string, string> = {
  username: 'userName',
  email: 'emails[primary=true].value',
  firstName: 'name.givenName',
  lastName: 'name.familyName',
  displayName: 'displayName',
  enabled: 'active',
  title: 'title',
  preferredLanguage: 'preferredLanguage',
  locale: 'locale',
  timezone: 'timezone',
};

// Map SCIM attributes to AuthMe attributes
export const DEFAULT_SCIM_TO_AUTHME_MAPPING: Record<string, string> = {
  userName: 'username',
  'name.givenName': 'firstName',
  'name.familyName': 'lastName',
  displayName: 'displayName',
  'emails[primary=true].value': 'email',
  active: 'enabled',
  title: 'title',
  preferredLanguage: 'preferredLanguage',
  locale: 'locale',
  timezone: 'timezone',
};
