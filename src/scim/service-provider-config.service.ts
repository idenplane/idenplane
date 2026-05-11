/**
 * SCIM Service Provider Configuration
 * RFC 7644 Section 4
 */

import { Injectable } from '@nestjs/common';
import {
  SERVICE_PROVIDER_CONFIG,
  ALL_SCHEMAS,
  ALL_RESOURCE_TYPES,
} from './schemas/scim.schemas.js';
import type { ScimServiceProviderConfig, ScimSchema, ScimResourceType } from './types/scim.types.js';

@Injectable()
export class ScimServiceProviderConfigService {
  /**
   * Get the Service Provider Configuration
   */
  getConfig(): ScimServiceProviderConfig {
    return { ...SERVICE_PROVIDER_CONFIG };
  }

  /**
   * Get all supported schemas
   */
  getSchemas(): ScimSchema[] {
    return [...ALL_SCHEMAS];
  }

  /**
   * Get a specific schema by ID
   */
  getSchemaById(schemaId: string): ScimSchema | undefined {
    return ALL_SCHEMAS.find(s => s.id === schemaId);
  }

  /**
   * Get all resource types
   */
  getResourceTypes(): ScimResourceType[] {
    return [...ALL_RESOURCE_TYPES];
  }

  /**
   * Get a specific resource type by name
   */
  getResourceTypeByName(name: string): ScimResourceType | undefined {
    return ALL_RESOURCE_TYPES.find(rt => rt.name === name);
  }
}