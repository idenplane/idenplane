/**
 * SCIM Bulk Operations Service
 * Implements RFC 7644 Section 3.7 - Bulk Operations
 */

import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ScimUsersService } from './scim-users.service.js';
import { ScimGroupsService } from './scim-groups.service.js';
import type {
  ScimBulkRequest,
  ScimBulkResponse,
  ScimBulkResponseOperation,
  ScimUser,
  ScimGroup,
} from './types/scim.types.js';

@Injectable()
export class ScimBulkService {
  private readonly logger = new Logger(ScimBulkService.name);

  constructor(
    private readonly usersService: ScimUsersService,
    private readonly groupsService: ScimGroupsService,
  ) {}

  /**
   * Process bulk operations
   * RFC 7644 Section 3.7
   */
  async processBulk(
    realmId: string,
    request: ScimBulkRequest,
  ): Promise<ScimBulkResponse> {
    const results: ScimBulkResponseOperation[] = [];

    for (const operation of request.operations) {
      try {
        const result = await this.processOperation(realmId, operation);
        results.push(result);
      } catch (error) {
        results.push({
          bulkId: operation.bulkId || '',
          status: '400',
          operationType: operation.method,
          response: {
            schemas: ['urn:scim:schemas:core:1.0:Error'],
            status: '400',
            detail: error instanceof Error ? error.message : 'Unknown error',
          },
        });
      }
    }

    return {
      schemas: ['urn:scim:schemas:core:1.0:BulkResponse'],
      operations: results,
    };
  }

  /**
   * Process a single bulk operation
   */
  private async processOperation(
    realmId: string,
    operation: {
      method: string;
      path: string;
      data?: unknown;
      bulkId?: string;
    },
  ): Promise<ScimBulkResponseOperation> {
    const { method, path, data, bulkId } = operation;

    // Extract resource type and ID from path
    // Path format: /Users or /Users/{id}
    const match = path.match(/^\/(Users|Groups)(?:\/(.+))?$/);
    if (!match) {
      throw new BadRequestException(`Invalid path: ${path}`);
    }

    const [, resourceType, resourceId] = match;

    switch (method) {
      case 'POST':
        /* eslint-disable @typescript-eslint/no-unsafe-argument */
        return this.handlePost(
          realmId,
          resourceType,
          data as any,
          bulkId || '',
        );
      case 'PUT':
        /* eslint-disable @typescript-eslint/no-unsafe-argument */
        return this.handlePut(
          realmId,
          resourceType,
          resourceId,
          data as any,
          bulkId || '',
        );
      case 'PATCH':
        /* eslint-disable @typescript-eslint/no-unsafe-argument */
        return this.handlePatch(
          realmId,
          resourceType,
          resourceId,
          data as any,
          bulkId || '',
        );
      case 'DELETE':
        return this.handleDelete(
          realmId,
          resourceType,
          resourceId,
          bulkId || '',
        );
      default:
        throw new BadRequestException(`Unsupported method: ${method}`);
    }
  }

  /**
   * Handle POST (create) operation
   */
  private async handlePost(
    realmId: string,
    resourceType: string,
    data: ScimUser | ScimGroup,
    bulkId: string,
  ): Promise<ScimBulkResponseOperation> {
    let location: string;

    if (resourceType === 'Users') {
      const user = await this.usersService.create(realmId, data as ScimUser);
      location = `/scim/v2/Users/${user.id}`;
    } else {
      const group = await this.groupsService.create(realmId, data as ScimGroup);
      location = `/scim/v2/Groups/${group.id}`;
    }

    return {
      bulkId,
      status: '201',
      operationType: 'POST',
      location,
    };
  }

  /**
   * Handle PUT (full update) operation
   */
  private async handlePut(
    realmId: string,
    resourceType: string,
    resourceId: string,
    data: ScimUser | ScimGroup,
    bulkId: string,
  ): Promise<ScimBulkResponseOperation> {
    let location: string;

    if (resourceType === 'Users') {
      const user = await this.usersService.update(
        realmId,
        resourceId,
        data as ScimUser,
      );
      location = `/scim/v2/Users/${user.id}`;
    } else {
      const group = await this.groupsService.update(
        realmId,
        resourceId,
        data as ScimGroup,
      );
      location = `/scim/v2/Groups/${group.id}`;
    }

    return {
      bulkId,
      status: '200',
      operationType: 'PUT',
      location,
    };
  }

  /**
   * Handle PATCH (partial update) operation
   */
  private async handlePatch(
    realmId: string,
    resourceType: string,
    resourceId: string,
    data: { operations: any[] },
    bulkId: string,
  ): Promise<ScimBulkResponseOperation> {
    let location: string;

    if (resourceType === 'Users') {
      /* eslint-disable @typescript-eslint/no-unsafe-argument */
      const user = await this.usersService.patch(
        realmId,
        resourceId,
        data.operations,
      );
      location = `/scim/v2/Users/${user.id}`;
    } else {
      /* eslint-disable @typescript-eslint/no-unsafe-argument */
      const group = await this.groupsService.patch(
        realmId,
        resourceId,
        data.operations,
      );
      location = `/scim/v2/Groups/${group.id}`;
    }

    return {
      bulkId,
      status: '200',
      operationType: 'PATCH',
      location,
    };
  }

  /**
   * Handle DELETE operation
   */
  private async handleDelete(
    realmId: string,
    resourceType: string,
    resourceId: string,
    bulkId: string,
  ): Promise<ScimBulkResponseOperation> {
    if (resourceType === 'Users') {
      await this.usersService.delete(realmId, resourceId);
    } else {
      await this.groupsService.delete(realmId, resourceId);
    }

    return {
      bulkId,
      status: '204',
      operationType: 'DELETE',
    };
  }
}
