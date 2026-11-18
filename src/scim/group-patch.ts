/**
 * SCIM PATCH for Groups (RFC 7644 §3.5.2), as a pure plan the service then
 * applies in one transaction.
 *
 * Member changes as real clients send them:
 *   add     path "members", value [{ "value": "<userId>" }]        (both)
 *   remove  path "members[value eq \"<userId>\"]"                 (Okta)
 *   remove  path "members", value [{ "value": "<userId>" }]        (Entra ID)
 *   remove  path "members", no value: every member
 *   replace path "members", value [...]: exactly these members
 */

import { scimBadRequest } from './scim-errors.js';
import {
  CORE_GROUP_URN,
  parsePatchPath,
  type ScimPatchPath,
} from './patch-request.js';
import type {
  NormalizedScimPatchOperation,
  ScimOperation,
} from './types/scim.types.js';

export type GroupMemberStep =
  | { kind: 'add'; userIds: string[] }
  | { kind: 'remove'; userIds: string[] }
  | { kind: 'set'; userIds: string[] }
  | { kind: 'clear' };

export interface GroupPatchPlan {
  displayName?: string;
  /** A new externalId; null removes it. */
  externalId?: string | null;
  members: GroupMemberStep[];
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function planGroupPatch(
  operations: NormalizedScimPatchOperation[],
): GroupPatchPlan {
  const plan: GroupPatchPlan = { members: [] };
  for (const operation of operations) {
    if (operation.path === undefined) {
      if (!isPlainObject(operation.value)) {
        throw scimBadRequest(
          'invalidValue',
          `An ${operation.op} without a "path" needs an object "value"`,
        );
      }
      applyObject(plan, operation.op, operation.value);
    } else {
      applyPath(
        plan,
        operation.op,
        parsePatchPath(operation.path),
        operation.value,
      );
    }
  }
  return plan;
}

function applyObject(
  plan: GroupPatchPlan,
  op: ScimOperation,
  value: Record<string, unknown>,
): void {
  for (const [key, val] of Object.entries(value)) {
    const lower = key.toLowerCase();
    if (lower === 'schemas' || lower === 'id' || lower === 'meta') continue;
    if (lower === CORE_GROUP_URN && isPlainObject(val)) {
      applyObject(plan, op, val);
      continue;
    }
    applyPath(plan, op, parsePatchPath(key), val);
  }
}

function applyPath(
  plan: GroupPatchPlan,
  op: ScimOperation,
  path: ScimPatchPath,
  value: unknown,
): void {
  if (path.schema !== undefined && path.schema !== CORE_GROUP_URN) {
    throw scimBadRequest(
      'invalidPath',
      `Unknown schema in path: ${path.schema}`,
    );
  }
  switch (path.attribute) {
    case 'displayname':
      if (path.filter || path.subAttribute) {
        throw scimBadRequest(
          'invalidPath',
          '"displayName" is a simple attribute',
        );
      }
      if (op === 'remove') {
        throw scimBadRequest('invalidValue', '"displayName" cannot be removed');
      }
      if (typeof value !== 'string' || value.trim() === '') {
        throw scimBadRequest(
          'invalidValue',
          '"displayName" must be a non-empty string',
        );
      }
      plan.displayName = value;
      return;
    case 'members':
      applyMembers(plan, op, path, value);
      return;
    case 'externalid':
      if (path.filter || path.subAttribute) {
        throw scimBadRequest(
          'invalidPath',
          '"externalId" is a simple attribute',
        );
      }
      plan.externalId = op === 'remove' ? null : externalIdValue(value);
      return;
    case 'id':
    case 'meta':
      throw scimBadRequest('mutability', `"${path.attribute}" is read-only`);
    default:
      throw scimBadRequest(
        'invalidPath',
        `"${path.attribute}" is not an attribute of the Group schema`,
      );
  }
}

function applyMembers(
  plan: GroupPatchPlan,
  op: ScimOperation,
  path: ScimPatchPath,
  value: unknown,
): void {
  if (path.subAttribute !== undefined) {
    throw scimBadRequest(
      'invalidPath',
      `"members.${path.subAttribute}" cannot be changed`,
    );
  }
  if (path.filter) {
    const { filter } = path;
    if (
      filter.attribute !== 'value' ||
      filter.operator !== 'eq' ||
      typeof filter.value !== 'string' ||
      filter.value === ''
    ) {
      throw scimBadRequest(
        'invalidPath',
        'A members filter must be: members[value eq "<id>"]',
      );
    }
    if (op !== 'remove') {
      throw scimBadRequest(
        'invalidPath',
        'Use "add" with path "members" to add a member',
      );
    }
    plan.members.push({ kind: 'remove', userIds: [filter.value] });
    return;
  }

  if (op === 'remove') {
    if (value === undefined || value === null) {
      plan.members.push({ kind: 'clear' });
    } else {
      plan.members.push({ kind: 'remove', userIds: memberIds(value) });
    }
    return;
  }
  const userIds = memberIds(value);
  plan.members.push(
    op === 'replace' ? { kind: 'set', userIds } : { kind: 'add', userIds },
  );
}

/** The user ids of a `members` value: `[{ "value": "<id>" }, ...]`. */
export function memberIds(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [value];
  return list.map((item) => {
    const id = isPlainObject(item) ? item['value'] : undefined;
    if (typeof id !== 'string' || id === '') {
      throw scimBadRequest(
        'invalidValue',
        'Each member must be an object with a string "value"',
      );
    }
    return id;
  });
}

/** An `externalId` value: a string, or null/empty to clear it. */
export function externalIdValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw scimBadRequest('invalidValue', '"externalId" must be a string');
  }
  if (value.length > 2048) {
    throw scimBadRequest('invalidValue', '"externalId" is too long');
  }
  return value.trim() === '' ? null : value;
}
