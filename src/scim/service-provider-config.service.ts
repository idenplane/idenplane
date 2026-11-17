/**
 * SCIM discovery: ServiceProviderConfig, Schemas and ResourceTypes
 * (RFC 7644 §4, RFC 7643 §5-7). Served at /scim/v2 and under each realm's
 * base URL; `meta.location` points at the URL the resource was asked for.
 */

import { Injectable } from '@nestjs/common';
import {
  SERVICE_PROVIDER_CONFIG,
  ALL_SCHEMAS,
  ALL_RESOURCE_TYPES,
} from './schemas/scim.schemas.js';
import { scimBaseUrl } from './scim-resource.js';
import type {
  ScimServiceProviderConfig,
  ScimSchema,
  ScimResourceType,
} from './types/scim.types.js';

@Injectable()
export class ScimServiceProviderConfigService {
  getConfig(realmName?: string): ScimServiceProviderConfig {
    return {
      ...structuredClone(SERVICE_PROVIDER_CONFIG),
      meta: {
        resourceType: 'ServiceProviderConfig',
        location: `${scimBaseUrl(realmName)}/ServiceProviderConfig`,
      },
    };
  }

  getSchemas(realmName?: string): ScimSchema[] {
    return ALL_SCHEMAS.map((s) => withSchemaMeta(s, realmName));
  }

  /** A schema by its URN (compared case-insensitively). */
  getSchemaById(schemaId: string, realmName?: string): ScimSchema | undefined {
    const schema = ALL_SCHEMAS.find(
      (s) => s.id.toLowerCase() === schemaId.toLowerCase(),
    );
    return schema && withSchemaMeta(schema, realmName);
  }

  getResourceTypes(realmName?: string): ScimResourceType[] {
    return ALL_RESOURCE_TYPES.map((rt) => withResourceTypeMeta(rt, realmName));
  }

  /** A resource type by its name (compared case-insensitively). */
  getResourceTypeByName(
    name: string,
    realmName?: string,
  ): ScimResourceType | undefined {
    const rt = ALL_RESOURCE_TYPES.find(
      (r) => r.name.toLowerCase() === name.toLowerCase(),
    );
    return rt && withResourceTypeMeta(rt, realmName);
  }
}

function withSchemaMeta(schema: ScimSchema, realmName?: string): ScimSchema {
  return {
    ...structuredClone(schema),
    meta: {
      resourceType: 'Schema',
      location: `${scimBaseUrl(realmName)}/Schemas/${schema.id}`,
    },
  };
}

function withResourceTypeMeta(
  rt: ScimResourceType,
  realmName?: string,
): ScimResourceType {
  return {
    ...structuredClone(rt),
    meta: {
      resourceType: 'ResourceType',
      location: `${scimBaseUrl(realmName)}/ResourceTypes/${rt.id}`,
    },
  };
}
