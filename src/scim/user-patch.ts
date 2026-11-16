/**
 * SCIM PATCH for Users (RFC 7644 §3.5.2), as a pure function over the
 * fields this server stores. The service loads the user, applies every
 * operation here, and writes the result once, so a request either applies
 * in full or not at all.
 *
 * Attributes of the SCIM User schema (core or enterprise extension) that
 * have no column here (displayName, title, phoneNumbers, department, ...)
 * are accepted and ignored, as POST and PUT ignore them: Entra ID and Okta
 * send them on every sync, and refusing them would fail the whole user.
 * Names outside the schema are refused with `invalidPath`.
 */

import { scimBadRequest } from './scim-errors.js';
import {
  CORE_USER_URN,
  ENTERPRISE_USER_URN,
  coerceScimBoolean,
  matchesValueFilter,
  parsePatchPath,
  type ScimPatchPath,
} from './patch-request.js';
import type {
  NormalizedScimPatchOperation,
  ScimOperation,
} from './types/scim.types.js';

/** The User fields SCIM can change. */
export interface ScimUserState {
  username: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  enabled: boolean;
}

/**
 * Core User attributes with no column here. Writes to them are accepted and
 * dropped. `phoneNumbers` is deliberately among them: `User.phoneNumber` is
 * the SMS MFA factor and must never be set by provisioning.
 */
const UNSTORED_USER_ATTRIBUTES = new Set([
  'externalid',
  'displayname',
  'nickname',
  'profileurl',
  'title',
  'usertype',
  'preferredlanguage',
  'locale',
  'timezone',
  'password',
  'phonenumbers',
  'ims',
  'photos',
  'addresses',
  'entitlements',
  'roles',
  'x509certificates',
]);

/** Sub-attributes of `name` that are not stored. */
const UNSTORED_NAME_PARTS = new Set([
  'formatted',
  'middlename',
  'honorificprefix',
  'honorificsuffix',
]);

/** Attributes a client may not write (RFC 7643 readOnly). */
const READ_ONLY_USER_ATTRIBUTES = new Set(['id', 'meta', 'groups']);

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function applyUserPatch(
  current: ScimUserState,
  operations: NormalizedScimPatchOperation[],
): ScimUserState {
  const next: ScimUserState = { ...current };
  for (const operation of operations) {
    if (operation.path === undefined) {
      if (!isPlainObject(operation.value)) {
        throw scimBadRequest(
          'invalidValue',
          `An ${operation.op} without a "path" needs an object "value"`,
        );
      }
      applyObject(next, operation.op, operation.value);
    } else {
      applyPath(
        next,
        operation.op,
        parsePatchPath(operation.path),
        operation.value,
      );
    }
  }
  return next;
}

/** A no-path add/replace: each key is an attribute path. */
function applyObject(
  state: ScimUserState,
  op: ScimOperation,
  value: Record<string, unknown>,
): void {
  for (const [key, val] of Object.entries(value)) {
    const lower = key.toLowerCase();
    if (lower === 'schemas' || lower === 'id' || lower === 'meta') {
      // Read-only or structural; ignored in a value object, as in PUT.
      continue;
    }
    if (lower === CORE_USER_URN && isPlainObject(val)) {
      applyObject(state, op, val);
      continue;
    }
    if (lower === ENTERPRISE_USER_URN) continue;
    applyPath(state, op, parsePatchPath(key), val);
  }
}

function applyPath(
  state: ScimUserState,
  op: ScimOperation,
  path: ScimPatchPath,
  value: unknown,
): void {
  if (path.schema !== undefined) {
    if (path.schema === ENTERPRISE_USER_URN) return; // not stored
    if (path.schema !== CORE_USER_URN) {
      throw scimBadRequest(
        'invalidPath',
        `Unknown schema in path: ${path.schema}`,
      );
    }
  }

  const { attribute } = path;
  if (attribute === 'emails') {
    applyEmails(state, op, path, value);
    return;
  }
  if (attribute === 'name') {
    if (path.filter) throw notMultiValued('name');
    applyName(state, op, path.subAttribute, value);
    return;
  }
  if (UNSTORED_USER_ATTRIBUTES.has(attribute)) return;
  if (READ_ONLY_USER_ATTRIBUTES.has(attribute)) {
    throw scimBadRequest('mutability', `"${attribute}" is read-only`);
  }
  if (attribute === 'username' || attribute === 'active') {
    if (path.filter) throw notMultiValued(attribute);
    if (path.subAttribute) throw noSubAttribute(attribute);
    if (op === 'remove') {
      throw scimBadRequest(
        'invalidValue',
        `"${attribute === 'username' ? 'userName' : 'active'}" cannot be removed`,
      );
    }
    if (attribute === 'active') {
      state.enabled = coerceScimBoolean(value, 'active');
    } else {
      if (typeof value !== 'string' || value.trim() === '') {
        throw scimBadRequest(
          'invalidValue',
          '"userName" must be a non-empty string',
        );
      }
      state.username = value;
    }
    return;
  }
  throw scimBadRequest(
    'invalidPath',
    `"${attribute}" is not an attribute of the User schema`,
  );
}

function applyName(
  state: ScimUserState,
  op: ScimOperation,
  sub: string | undefined,
  value: unknown,
): void {
  if (sub !== undefined) {
    setNamePart(state, sub, op === 'remove' ? null : value);
    return;
  }
  if (op === 'remove') {
    state.firstName = null;
    state.lastName = null;
    return;
  }
  if (!isPlainObject(value)) {
    throw scimBadRequest('invalidValue', '"name" must be an object');
  }
  // Only the sub-attributes given are changed (RFC 7644 §3.5.2.3).
  for (const [key, val] of Object.entries(value)) {
    setNamePart(state, key.toLowerCase(), val);
  }
}

function setNamePart(state: ScimUserState, part: string, value: unknown) {
  if (UNSTORED_NAME_PARTS.has(part)) return;
  if (part !== 'givenname' && part !== 'familyname') {
    throw scimBadRequest('invalidPath', `"name.${part}" is not supported`);
  }
  const text = optionalString(value, `name.${part}`);
  if (part === 'givenname') state.firstName = text;
  else state.lastName = text;
}

/**
 * `emails`. One email is stored: the user's work/primary email. A filter
 * that selects it (`type eq "work"`, `primary eq true`, or its `value`)
 * reads and writes it; a filter for another kind of email (`type eq
 * "home"`) targets a value this server does not keep and is ignored.
 */
function applyEmails(
  state: ScimUserState,
  op: ScimOperation,
  path: ScimPatchPath,
  value: unknown,
): void {
  const sub = path.subAttribute;
  if (
    sub !== undefined &&
    !['value', 'type', 'primary', 'display'].includes(sub)
  ) {
    throw scimBadRequest('invalidPath', `"emails.${sub}" is not supported`);
  }
  if (sub !== undefined && sub !== 'value') return; // not stored

  const { filter } = path;
  if (filter) {
    if (!['value', 'type', 'primary', 'display'].includes(filter.attribute)) {
      throw scimBadRequest(
        'invalidPath',
        `Cannot filter emails on "${filter.attribute}"`,
      );
    }
    const stored = state.email
      ? { value: state.email, type: 'work', primary: true }
      : null;
    const targetsStored = stored
      ? matchesValueFilter(filter, stored)
      : op !== 'remove' &&
        matchesValueFilter(filter, { type: 'work', primary: true });
    if (!targetsStored) return;
    if (op === 'remove') {
      state.email = null;
      return;
    }
    if (sub === 'value') {
      state.email = optionalString(value, 'emails.value');
    } else if (isPlainObject(value)) {
      state.email = optionalString(value['value'], 'emails.value');
    } else {
      throw scimBadRequest('invalidValue', 'An email must be an object');
    }
    return;
  }

  if (op === 'remove') {
    state.email = null;
    return;
  }
  if (sub === 'value') {
    state.email = optionalString(value, 'emails.value');
    return;
  }
  const list = Array.isArray(value) ? value : [value];
  if (list.length === 0) {
    if (op === 'replace') state.email = null;
    return;
  }
  const emails = list.map((item) => {
    if (!isPlainObject(item)) {
      throw scimBadRequest('invalidValue', 'Each email must be an object');
    }
    return item;
  });
  const chosen =
    emails.find((e) => {
      try {
        return coerceScimBoolean(e['primary'], 'primary');
      } catch {
        return false;
      }
    }) ?? emails[0];
  state.email = optionalString(chosen['value'], 'emails.value');
}

function optionalString(value: unknown, attribute: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw scimBadRequest('invalidValue', `"${attribute}" must be a string`);
  }
  return value.trim() === '' ? null : value;
}

const notMultiValued = (attribute: string) =>
  scimBadRequest(
    'invalidPath',
    `"${attribute}" is not multi-valued; it takes no filter`,
  );

const noSubAttribute = (attribute: string) =>
  scimBadRequest('invalidPath', `"${attribute}" has no sub-attributes`);
