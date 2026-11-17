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
import { SCIM_BULK_MAX_OPERATIONS } from './schemas/scim.schemas.js';
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

/** RFC 7644 §3.7.2: a value `bulkId:<id>` refers to a resource this request creates. */
const BULK_ID_REFERENCE = 'bulkId:';
/** How deep into an operation's data references are looked for. */
const MAX_REFERENCE_DEPTH = 32;

interface Resolved {
  path: unknown;
  data: unknown;
  /** bulkIds referenced but not created (yet). */
  missing: string[];
}

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
   *
   * `bulkId` references are resolved (§3.7.2): a value `"bulkId:<id>"`
   * anywhere in an operation's `data`, or as the id in its `path`, becomes
   * the id of the resource the operation with that `bulkId` created. An
   * operation that refers to one created later in the request waits for
   * it; one whose reference cannot be resolved (unknown, failed, or
   * circular) fails with 409 `invalidValue`.
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
    if (operations.length > SCIM_BULK_MAX_OPERATIONS) {
      throw new ScimException(
        413,
        'tooMany',
        `A bulk request may contain at most ${SCIM_BULK_MAX_OPERATIONS} operations`,
      );
    }
    const failOnErrors =
      typeof body.failOnErrors === 'number' && body.failOnErrors > 0
        ? body.failOnErrors
        : Infinity;

    const list = operations as ScimBulkOperation[];
    const declared = new Set(
      list
        .map((op) => op?.bulkId)
        .filter((id): id is string => typeof id === 'string' && id !== ''),
    );
    const createdIds = new Map<string, string>();
    const failedIds = new Set<string>();

    const results: ScimBulkResponseOperation[] = [];
    let errors = 0;
    const fail = (
      operation: ScimBulkOperation,
      method: string,
      error: unknown,
    ) => {
      const scimError = toScimError(error);
      results.push({
        ...(operation?.bulkId ? { bulkId: operation.bulkId } : {}),
        method,
        status: scimError.status,
        response: scimError,
      });
      if (operation?.bulkId) failedIds.add(operation.bulkId);
      errors++;
    };

    let pending = list;
    while (pending.length > 0 && errors < failOnErrors) {
      const waiting: ScimBulkOperation[] = [];
      for (const operation of pending) {
        if (errors >= failOnErrors) break;
        const method = String(operation?.method ?? '').toUpperCase();
        const resolved = resolveReferences(operation, createdIds);
        if (resolved.missing.length > 0) {
          const canWait = resolved.missing.every(
            (id) => declared.has(id) && !failedIds.has(id),
          );
          if (canWait) waiting.push(operation);
          else fail(operation, method, unresolved(resolved.missing));
          continue;
        }
        try {
          const result = await this.processOperation(
            realm,
            method,
            operation,
            resolved,
          );
          if (operation?.bulkId && result.id) {
            createdIds.set(operation.bulkId, result.id);
          }
          results.push(result.response);
        } catch (error) {
          fail(operation, method, error);
        }
      }
      if (waiting.length === pending.length) {
        // No operation could run: the references are circular.
        for (const operation of waiting) {
          if (errors >= failOnErrors) break;
          const method = String(operation?.method ?? '').toUpperCase();
          fail(
            operation,
            method,
            unresolved(resolveReferences(operation, createdIds).missing),
          );
        }
        break;
      }
      pending = waiting;
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
    resolved: Resolved,
  ): Promise<{ id?: string; response: ScimBulkResponseOperation }> {
    const { path, data } = resolved;
    const bulkId = operation?.bulkId;

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
      throw scimBadRequest('invalidPath', `Invalid path: ${String(path)}`);
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
        id: created.id,
        response: {
          ...base,
          status: '201',
          location: scimLocation(realm, resourceType, created.id!),
        },
      };
    }

    if (!resourceId) {
      throw scimBadRequest('invalidPath', `${method} needs a resource id`);
    }
    const location = scimLocation(realm, resourceType, resourceId);

    switch (method) {
      case 'PUT':
        if (isUsers) {
          await this.usersService.update(realm, resourceId, data as ScimUser);
        } else {
          await this.groupsService.update(realm, resourceId, data as ScimGroup);
        }
        return { response: { ...base, status: '200', location } };
      case 'PATCH': {
        const operations = getPatchOperations(data);
        if (isUsers) {
          await this.usersService.patch(realm, resourceId, operations);
          return { response: { ...base, status: '200', location } };
        }
        await this.groupsService.patch(realm, resourceId, operations);
        return { response: { ...base, status: '204', location } };
      }
      case 'DELETE':
        if (isUsers) {
          await this.usersService.delete(realm, resourceId);
        } else {
          await this.groupsService.delete(realm, resourceId);
        }
        return { response: { ...base, status: '204', location } };
      default:
        throw scimBadRequest('invalidSyntax', `Unsupported method: ${method}`);
    }
  }
}

/** The operation's path and data with `bulkId:` references replaced. */
export function resolveReferences(
  operation: ScimBulkOperation | undefined,
  created: ReadonlyMap<string, string>,
): Resolved {
  const missing = new Set<string>();
  const resolveString = (value: string): string => {
    if (!value.startsWith(BULK_ID_REFERENCE)) return value;
    const id = value.slice(BULK_ID_REFERENCE.length);
    const target = created.get(id);
    if (target === undefined) {
      missing.add(id);
      return value;
    }
    return target;
  };
  const walk = (value: unknown, depth: number): unknown => {
    if (typeof value === 'string') return resolveString(value);
    if (depth >= MAX_REFERENCE_DEPTH) return value;
    if (Array.isArray(value)) return value.map((v) => walk(v, depth + 1));
    if (typeof value === 'object' && value !== null) {
      // fromEntries defines own properties, so a "__proto__" key stays data.
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, walk(v, depth + 1)]),
      );
    }
    return value;
  };

  let path: unknown = operation?.path;
  if (typeof path === 'string') {
    const slash = path.lastIndexOf('/');
    if (slash > 0) {
      const id = path.slice(slash + 1);
      const resolvedId = resolveString(id);
      if (resolvedId !== id) {
        path = `${path.slice(0, slash + 1)}${encodeURIComponent(resolvedId)}`;
      }
    }
  }
  return { path, data: walk(operation?.data, 0), missing: [...missing] };
}

function unresolved(ids: string[]) {
  return new ScimException(
    409,
    'invalidValue',
    `Cannot resolve bulkId reference(s): ${ids.map((id) => `bulkId:${id}`).join(', ')}`,
  );
}
