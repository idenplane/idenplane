/**
 * SCIM 2.0 Core Types
 * Implements RFC 7644 - System for Cross-domain Identity Management
 */

// SCIM Resource Types
export const SCIM_RESOURCE_TYPES = ['User', 'Group'] as const;
export type ScimResourceTypeName = (typeof SCIM_RESOURCE_TYPES)[number];

// SCIM Content Type
export const SCIM_CONTENT_TYPE = 'application/scim+json';

// SCIM 2.0 schema URNs (RFC 7643 §8.7, RFC 7644 §3)
export const SCIM_SCHEMAS = {
  USER: 'urn:ietf:params:scim:schemas:core:2.0:User',
  GROUP: 'urn:ietf:params:scim:schemas:core:2.0:Group',
  ENTERPRISE_USER: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User',
  RESOURCE_TYPE: 'urn:ietf:params:scim:schemas:core:2.0:ResourceType',
  SCHEMA: 'urn:ietf:params:scim:schemas:core:2.0:Schema',
  SERVICE_PROVIDER_CONFIG:
    'urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig',
  LIST_RESPONSE: 'urn:ietf:params:scim:api:messages:2.0:ListResponse',
  ERROR: 'urn:ietf:params:scim:api:messages:2.0:Error',
  PATCH_OP: 'urn:ietf:params:scim:api:messages:2.0:PatchOp',
  BULK_REQUEST: 'urn:ietf:params:scim:api:messages:2.0:BulkRequest',
  BULK_RESPONSE: 'urn:ietf:params:scim:api:messages:2.0:BulkResponse',
} as const;

// SCIM Operations for PATCH
export const SCIM_OPERATIONS = ['add', 'replace', 'remove'] as const;
export type ScimOperation = (typeof SCIM_OPERATIONS)[number];

// SCIM Path filter operator
export const SCIM_FILTER_OPERATORS = [
  'eq',
  'ne',
  'co',
  'sw',
  'ew',
  'gt',
  'ge',
  'lt',
  'le',
] as const;
export type ScimFilterOperator = (typeof SCIM_FILTER_OPERATORS)[number];

/**
 * Base SCIM Resource with common attributes
 * RFC 7643 Section 3
 */
export interface ScimResource {
  id?: string;
  externalId?: string;
  meta?: ScimMeta;
}

/**
 * SCIM Meta information
 * RFC 7643 Section 3.5
 */
export interface ScimMeta {
  resourceType?: string;
  created?: string;
  lastModified?: string;
  version?: string;
  location?: string;
}

/**
 * SCIM List Response
 * RFC 7644 Section 2.9
 */
export interface ScimListResponse<T> {
  schemas: string[];
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
  Resources: T[];
}

/**
 * SCIM Error Response
 * RFC 7644 Section 3.12
 */
export interface ScimError {
  schemas: string[];
  status: string;
  scimType?: string;
  detail: string;
}

/**
 * SCIM User Resource
 * RFC 7643 Section 4.1
 */
export interface ScimUser extends ScimResource {
  schemas: string[];
  userName: string;
  name?: ScimName;
  displayName?: string;
  nickName?: string;
  profileUrl?: string;
  emails?: ScimEmail[];
  phoneNumbers?: ScimPhoneNumber[];
  addresses?: ScimAddress[];
  active?: boolean;
  title?: string;
  userType?: string;
  preferredLanguage?: string;
  locale?: string;
  timezone?: string;
  groups?: ScimGroupMembership[];
  entitlements?: string[];
  roles?: string[];
  x509Certificates?: ScimX509Certificate[];
  'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'?: ScimEnterpriseUser;
  password?: string; // Write-only, never returned
}

/**
 * SCIM Name
 */
export interface ScimName {
  formatted?: string;
  familyName?: string;
  givenName?: string;
  middleName?: string;
  honorificPrefix?: string;
  honorificSuffix?: string;
}

/**
 * SCIM Email
 */
export interface ScimEmail {
  value: string;
  type?: string;
  primary?: boolean;
  display?: string;
}

/**
 * SCIM Phone Number
 */
export interface ScimPhoneNumber {
  value: string;
  type?: string;
  primary?: boolean;
}

/**
 * SCIM Address
 */
export interface ScimAddress {
  type?: string;
  streetAddress?: string;
  locality?: string;
  region?: string;
  postalCode?: string;
  country?: string;
  formatted?: string;
  primary?: boolean;
}

/**
 * SCIM Group Membership
 */
export interface ScimGroupMembership {
  value: string; // Group id
  display?: string;
  type?: string;
  $ref?: string;
}

/**
 * SCIM X509 Certificate
 */
export interface ScimX509Certificate {
  value: string;
  type?: string;
}

/**
 * SCIM Enterprise User Extension
 * RFC 7643 Section 4.3
 */
export interface ScimEnterpriseUser {
  employeeNumber?: string;
  costCenter?: string;
  organization?: string;
  division?: string;
  department?: string;
  manager?: ScimManager;
}

/**
 * SCIM Manager
 */
export interface ScimManager {
  value?: string;
  displayName?: string;
}

/**
 * SCIM Group Resource
 * RFC 7643 Section 4.2
 */
export interface ScimGroup extends ScimResource {
  schemas: string[];
  displayName: string;
  members?: ScimMember[];
  externalId?: string;
}

/**
 * SCIM Group Member
 */
export interface ScimMember {
  value?: string;
  display?: string;
  type?: string;
  $ref?: string;
}

/**
 * SCIM Service Provider Configuration
 * RFC 7644 Section 4
 */
export interface ScimServiceProviderConfig {
  schemas: string[];
  documentationUri?: string;
  patch?: ScimCapability;
  bulk?: ScimBulkCapability;
  filter?: ScimFilterCapability;
  changePassword?: ScimCapability;
  sort?: ScimCapability;
  etag?: ScimCapability;
  authenticationSchemes?: ScimAuthenticationScheme[];
  meta?: ScimMeta;
}

/**
 * SCIM Capability
 */
export interface ScimCapability {
  supported: boolean;
}

/**
 * SCIM Bulk Capability
 */
export interface ScimBulkCapability extends ScimCapability {
  maxOperations?: number;
  maxPayloadSize?: number;
}

/**
 * SCIM Filter Capability
 */
export interface ScimFilterCapability extends ScimCapability {
  maxResults?: number;
  supportedOperators?: string[];
}

/**
 * SCIM Authentication Scheme
 */
export interface ScimAuthenticationScheme {
  name: string;
  description: string;
  specUri?: string;
  documentationUri?: string;
  type: string;
  primary: boolean;
}

/**
 * SCIM Schema
 * RFC 7643 Section 7
 */
export interface ScimSchema {
  schemas?: string[];
  id: string;
  name: string;
  description?: string;
  attributes: ScimSchemaAttribute[];
  meta?: ScimMeta;
}

/**
 * SCIM Schema Attribute
 */
export interface ScimSchemaAttribute {
  name: string;
  type: string;
  description?: string;
  required?: boolean;
  multiValued?: boolean;
  caseExact?: boolean;
  mutability?: string;
  returned?: string;
  uniqueness?: string;
  referenceTypes?: string[];
  canonicalValues?: string[];
  subAttributes?: ScimSchemaAttribute[];
}

/**
 * SCIM Resource Type
 * RFC 7643 Section 6
 */
export interface ScimResourceType {
  schemas: string[];
  id: string;
  name: string;
  description?: string;
  endpoint: string;
  schema: string;
  schemaExtensions: ScimSchemaExtension[];
  meta?: ScimMeta;
}

/**
 * SCIM Schema Extension
 */
export interface ScimSchemaExtension {
  schema: string;
  required: boolean;
}

/**
 * SCIM Bulk Operation Request
 * RFC 7644 Section 3.7. The RFC names the list `Operations`; lowercase
 * `operations` is still read for clients written against older versions.
 */
export interface ScimBulkRequest {
  schemas?: string[];
  Operations?: ScimBulkOperation[];
  operations?: ScimBulkOperation[];
  failOnErrors?: number;
}

/**
 * SCIM Bulk Operation
 */
export interface ScimBulkOperation {
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  data?: unknown;
  bulkId?: string;
  version?: string;
}

/**
 * SCIM Bulk Response
 * RFC 7644 Section 3.7
 */
export interface ScimBulkResponse {
  schemas: string[];
  Operations: ScimBulkResponseOperation[];
}

/**
 * SCIM Bulk Response Operation (RFC 7644 §3.7.3)
 */
export interface ScimBulkResponseOperation {
  bulkId?: string;
  status: string;
  method: string;
  version?: string;
  location?: string;
  response?: ScimError | ScimResource;
}

/**
 * SCIM Search Request (POST /Users or /Groups with filters)
 */
export interface ScimSearchRequest {
  schemas: string[];
  attributes?: string[];
  excludedAttributes?: string[];
  filter?: string;
  startIndex?: number;
  count?: number;
}

/**
 * SCIM PATCH Request
 * RFC 7644 Section 3.5.2. The RFC names the list `Operations`; lowercase
 * `operations` is still read for clients written against older versions.
 */
export interface ScimPatchRequest {
  schemas?: string[];
  Operations?: ScimPatchOperation[];
  operations?: ScimPatchOperation[];
}

/**
 * SCIM PATCH Operation. `op` is matched case-insensitively (Entra ID sends
 * `Replace`, `Add`, `Remove`).
 */
export interface ScimPatchOperation {
  op: string;
  path?: string;
  value?: unknown;
}

/** A PATCH operation after validation: `op` is lowercase. */
export interface NormalizedScimPatchOperation {
  op: ScimOperation;
  path?: string;
  value?: unknown;
}

/**
 * The realm a SCIM request acts in. `name` is needed for `meta.location`.
 */
export interface ScimRealmRef {
  id: string;
  name: string;
}

/**
 * Pagination parameters for SCIM
 */
export interface ScimPaginationParams {
  startIndex?: number;
  count?: number;
}

/**
 * SCIM filter parsed structure
 */
export interface ParsedScimFilter {
  attribute: string;
  operator: string;
  value: string;
}
