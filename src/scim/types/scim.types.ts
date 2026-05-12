/**
 * SCIM 2.0 Core Types
 * Implements RFC 7644 - System for Cross-domain Identity Management
 */

// SCIM Resource Types
export const SCIM_RESOURCE_TYPES = ['User', 'Group'] as const;
export type ScimResourceTypeName = (typeof SCIM_RESOURCE_TYPES)[number];

// SCIM Content Type
export const SCIM_CONTENT_TYPE = 'application/scim+json';

// SCIM Schema URNs
export const SCIM_SCHEMAS = {
  USER: 'urn:scim:schemas:core:1.0',
  GROUP: 'urn:scim:schemas:core:1.0',
  ENTERPRISE_USER: 'urn:scim:schemas:extension:enterprise:1.0',
  RESOURCE_TYPE: 'urn:scim:schemas:core:1.0:ResourceType',
  SCHEMA: 'urn:scim:schemas:core:1.0:Schema',
  SERVICE_PROVIDER_CONFIG: 'urn:scim:schemas:core:1.0:ServiceProviderConfig',
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
  'gt',
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
  extensionEnterpriseUser?: ScimEnterpriseUser;
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
  id: string;
  name: string;
  description?: string;
  attributes: ScimSchemaAttribute[];
  type: string;
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
 * RFC 7644 Section 3.7
 */
export interface ScimBulkRequest {
  schemas: string[];
  operations: ScimBulkOperation[];
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
  operations: ScimBulkResponseOperation[];
}

/**
 * SCIM Bulk Response Operation
 */
export interface ScimBulkResponseOperation {
  bulkId: string;
  status: string;
  operationType?: string;
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
 * RFC 7644 Section 3.6
 */
export interface ScimPatchRequest {
  schemas: string[];
  operations: ScimPatchOperation[];
}

/**
 * SCIM PATCH Operation
 */
export interface ScimPatchOperation {
  op: ScimOperation;
  path?: string;
  value?: unknown;
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
