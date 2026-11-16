/**
 * SCIM Bulk Operations Service
 * Implements RFC 7644 Section 3.7 - Bulk Operations
 */

import { Injectable, Logger } from '@nestjs/common';
import { ScimUsersService } from './scim-users.service.js';
import { ScimGroupsService } from './scim-groups.service.js';
import { getPatchOperations } from './patch-request.js';
import { ScimException, scimBadRequest, toScimError } from './scim-errors.js';
import { scimLocation } from './scim-resource.js';
import { SERVICE_PROVIDER_CONFIG } from './schemas/scim.schemas.js';
import { SCIM_SCHEMAS } from './types/scim.types.js';
import type {
  ScimBulkOperation,
  ScimBulkRequest,
  ScimBulkResponse,
  ScimBulkResponseOperation,
  ScimUser,
  ScimGroup,
  ScimRealmRef,
} from './types/scim.types.js';

const MAX_OPERATIONS = SERVICE_PROVIDER_CONFIG.bulk?.maxOperations ?? 1000;

@Injectable()
export class ScimBulkService {
  private readonly logger = new Logger(ScimBulkService.name);

  constructor(
    private readonly usersService: ScimUsersService,
    private readonly groupsService: ScimGroupsService,
  ) {}

  /**
   * Process bulk operations
   * RFC 7644 Section 3.7. The RFC names the list `Operations`; lowercase
   * `operations` is still read for older clients.
   */
  async processBulk(
    realm: ScimRealmRef,
    request: ScimBulkRequest,
  ): Promise<ScimBulkResponse> {
    const body: ScimBulkRequest = request ?? {};
    const operations: unknown = body.Operations ?? body.operations;
    if (!Array.isArray(operations)) {
      throw scimBadRequest(
        'invalidSyntax',
        'The bulk request must contain an "Operations" array',
      );
    }
    if (operations.length > MAX_OPERATIONS) {
      throw new ScimException(
        413,
        'tooMany',
        `A bulk request may contain at most ${MAX_OPERATIONS} operations`,
      );
    }
    const failOnErrors =
      typeof body.failOnErrors === 'number' && body.failOnErrors > 0
        ? body.failOnErrors
        : Infinity;

    const results: ScimBulkResponseOperation[] = [];
    let errors = 0;

    for (const operation of operations as ScimBulkOperation[]) {
      const method = String(operation?.method ?? '').toUpperCase();
      try {
        results.push(await this.processOperation(realm, method, operation));
      } catch (error) {
        const scimError = toScimError(error);
        results.push({
          ...(operation?.bulkId ? { bulkId: operation.bulkId } : {}),
          method,
          status: scimError.status,
          response: scimError,
        });
        errors++;
        if (errors >= failOnErrors) break;
      }
    }

    return {
      schemas: [SCIM_SCHEMAS.BULK_RESPONSE],
      Operations: results,
    };
  }

  /**
   * Process a single bulk operation
   */
  private async processOperation(
    realm: ScimRealmRef,
    method: string,
    operation: ScimBulkOperation,
  ): Promise<ScimBulkResponseOperation> {
    const { path, data, bulkId } = operation ?? ({} as ScimBulkOperation);

    // Path format: /Users, /Users/{id}, /Groups or /Groups/{id}
    const match =
      typeof path === 'string'
        ? path.match(/^\/(Users|Groups)(?:\/([^/]+))?$/)
        : null;
    if (!match) {
      throw scimBadRequest('invalidPath', `Invalid path: ${String(path)}`);
    }

    const resourceType = match[1] as 'Users' | 'Groups';
    let resourceId: string | undefined;
    try {
      resourceId = match[2] ? decodeURIComponent(match[2]) : undefined;
    } catch {
      throw scimBadRequest('invalidPath', `Invalid path: ${path}`);
    }
    const isUsers = resourceType === 'Users';
    const base = { ...(bulkId ? { bulkId } : {}), method };

    if (method === 'POST') {
      if (resourceId) {
        throw scimBadRequest('invalidPath', 'POST takes a path with no id');
      }
      const created = isUsers
        ? await this.usersService.create(realm, data as ScimUser)
        : await this.groupsService.create(realm, data as ScimGroup);
      return {
        ...base,
        status: '201',
        location: scimLocation(realm, resourceType, created.id!),
      };
    }

    if (!resourceId) {
      throw scimBadRequest('invalidPath', `${method} needs a resource id`);
    }

    switch (method) {
      case 'PUT': {
        const updated = isUsers
          ? await this.usersService.update(realm, resourceId, data as ScimUser)
          : await this.groupsService.update(
              realm,
              resourceId,
              data as ScimGroup,
            );
        return {
          ...base,
          status: '200',
          location: scimLocation(realm, resourceType, updated.id!),
        };
      }
      case 'PATCH': {
        const operations = getPatchOperations(data);
        const patched = isUsers
          ? await this.usersService.patch(realm, resourceId, operations)
          : await this.groupsService.patch(realm, resourceId, operations);
        return {
          ...base,
          status: '200',
          location: scimLocation(realm, resourceType, patched.id!),
        };
      }
      case 'DELETE':
        if (isUsers) {
          await this.usersService.delete(realm, resourceId);
        } else {
          await this.groupsService.delete(realm, resourceId);
        }
        return { ...base, status: '204' };
      default:
        throw scimBadRequest('invalidSyntax', `Unsupported method: ${method}`);
    }
  }
}
