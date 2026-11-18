/**
 * SCIM PATCH for Users (RFC 7644 §3.5.2), as a pure function over the
 * fields this server stores. The service loads the user, applies every
 * operation here, and writes the result once, so a request either applies
 * in full or not at all.
 *
 * The same engine reads the body of a POST or PUT ({@link userStateFromResource}):
 * a full representation is a path-less `replace` onto an empty user, so
 * both verbs and PATCH read every attribute the same way.
 *
 * What is stored:
 * - userName, active, name.givenName/familyName and the primary email, in
 *   the user's own columns;
 * - externalId, in its own column;
 * - password, write-only: the service checks it against the realm policy,
 *   hashes it, and never returns it;
 * - displayName, nickName, profileUrl, title, userType, preferredLanguage,
 *   locale, timezone, the other name parts, phoneNumbers, addresses and the
 *   enterprise extension (employeeNumber, costCenter, organization,
 *   division, department, manager), in the SCIM profile (see user-profile.ts).
 *
 * ims, photos, entitlements, roles and x509Certificates are accepted and
 * ignored: Entra ID and Okta can send them, and refusing them would fail
 * the whole user. In a PATCH, names outside the schema are refused with
 * `invalidPath`; in a POST or PUT body they are ignored.
 */

import { scimBadRequest } from './scim-errors.js';
import {
  CORE_USER_URN,
  ENTERPRISE_USER_URN,
  coerceScimBoolean,
  matchesValueFilter,
  parsePatchPath,
  type ScimPatchPath,
  type ScimValueFilter,
} from './patch-request.js';
import {
  ENTERPRISE_STRINGS,
  MAX_MULTI_VALUES,
  MAX_PROFILE_TEXT,
  MULTI_VALUED,
  PROFILE_NAME_PARTS,
  PROFILE_STRINGS,
  type MultiValuedSpec,
  type ScimMultiValue,
  type ScimProfile,
} from './user-profile.js';
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
  externalId?: string | null;
  profile?: ScimProfile;
  /**
   * A new password this request sets. Write-only: never loaded from the
   * user, never returned.
   */
  password?: string;
}

/** `patch`: a PATCH request. `resource`: the body of a POST or PUT. */
type Mode = 'patch' | 'resource';

interface Context {
  state: Required<Omit<ScimUserState, 'password'>> &
    Pick<ScimUserState, 'password'>;
  mode: Mode;
}

/**
 * Core User attributes with no storage here. Writes to them are accepted and
 * dropped.
 */
const IGNORED_USER_ATTRIBUTES = new Set([
  'ims',
  'photos',
  'entitlements',
  'roles',
  'x509certificates',
]);

/** Attributes a client may not write (RFC 7643 readOnly). */
const READ_ONLY_USER_ATTRIBUTES = new Set(['id', 'meta', 'groups']);

/** Longest password accepted (as CryptoService.hashPassword). */
export const MAX_SCIM_PASSWORD_LENGTH = 1024;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function contextFor(current: ScimUserState, mode: Mode): Context {
  return {
    mode,
    state: {
      username: current.username,
      email: current.email,
      firstName: current.firstName,
      lastName: current.lastName,
      enabled: current.enabled,
      externalId: current.externalId ?? null,
      profile: structuredClone(current.profile ?? {}),
      password: current.password,
    },
  };
}

export function applyUserPatch(
  current: ScimUserState,
  operations: NormalizedScimPatchOperation[],
): ScimUserState {
  const ctx = contextFor(current, 'patch');
  for (const operation of operations) {
    if (operation.path === undefined) {
      if (!isPlainObject(operation.value)) {
        throw scimBadRequest(
          'invalidValue',
          `An ${operation.op} without a "path" needs an object "value"`,
        );
      }
      applyObject(ctx, operation.op, operation.value);
    } else if (operation.path.toLowerCase() === ENTERPRISE_USER_URN) {
      // The whole extension: `{"path": "urn:...:enterprise:2.0:User",
      // "value": {"department": "..."}}`.
      if (operation.op === 'remove') {
        delete ctx.state.profile.enterprise;
      } else if (isPlainObject(operation.value)) {
        applyEnterpriseObject(ctx, operation.op, operation.value);
      } else {
        throw scimBadRequest(
          'invalidValue',
          'The enterprise extension must be an object',
        );
      }
    } else {
      applyPath(
        ctx,
        operation.op,
        parsePatchPath(operation.path),
        operation.value,
      );
    }
  }
  return ctx.state;
}

/**
 * The user a POST or PUT body describes. Every stored attribute the body
 * leaves out is empty, as RFC 7644 §3.5.1 replaces; `base` gives the values
 * that are kept when absent: `active` (a PUT without it does not disable
 * the user) and `userName` (checked by the caller).
 */
export function userStateFromResource(
  body: Record<string, unknown>,
  base: { username: string; enabled: boolean },
): ScimUserState {
  const ctx = contextFor(
    {
      username: base.username,
      enabled: base.enabled,
      email: null,
      firstName: null,
      lastName: null,
      externalId: null,
      profile: {},
    },
    'resource',
  );
  applyObject(ctx, 'replace', body);
  return ctx.state;
}

/** A no-path add/replace: each key is an attribute path. */
function applyObject(
  ctx: Context,
  op: ScimOperation,
  value: Record<string, unknown>,
): void {
  for (const [key, val] of Object.entries(value)) {
    const lower = key.toLowerCase();
    if (lower === 'schemas' || lower === 'id' || lower === 'meta') {
      // Read-only or structural; ignored in a value object, as in PUT.
      continue;
    }
    if (lower === CORE_USER_URN) {
      if (isPlainObject(val)) applyObject(ctx, op, val);
      continue;
    }
    if (lower === ENTERPRISE_USER_URN) {
      if (isPlainObject(val)) applyEnterpriseObject(ctx, op, val);
      else if (val !== null && val !== undefined) {
        throw scimBadRequest(
          'invalidValue',
          'The enterprise extension must be an object',
        );
      }
      continue;
    }
    let path: ScimPatchPath;
    try {
      path = parsePatchPath(key);
    } catch (error) {
      if (ctx.mode === 'resource') continue; // not an attribute name
      throw error;
    }
    applyPath(ctx, op, path, val);
  }
}

function applyEnterpriseObject(
  ctx: Context,
  op: ScimOperation,
  value: Record<string, unknown>,
): void {
  for (const [key, val] of Object.entries(value)) {
    let path: ScimPatchPath;
    try {
      path = parsePatchPath(key);
    } catch (error) {
      if (ctx.mode === 'resource') continue;
      throw error;
    }
    applyEnterprise(ctx, op, { ...path, schema: ENTERPRISE_USER_URN }, val);
  }
}

function applyPath(
  ctx: Context,
  op: ScimOperation,
  path: ScimPatchPath,
  value: unknown,
): void {
  if (path.schema !== undefined) {
    if (path.schema === ENTERPRISE_USER_URN) {
      applyEnterprise(ctx, op, path, value);
      return;
    }
    if (path.schema !== CORE_USER_URN) {
      if (ctx.mode === 'resource') return;
      throw scimBadRequest(
        'invalidPath',
        `Unknown schema in path: ${path.schema}`,
      );
    }
  }

  const { state } = ctx;
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
  if (attribute === 'password') {
    if (path.filter) throw notMultiValued('password');
    if (path.subAttribute) throw noSubAttribute('password');
    applyPassword(ctx, op, value);
    return;
  }
  if (attribute === 'externalid') {
    if (path.filter) throw notMultiValued('externalId');
    if (path.subAttribute) throw noSubAttribute('externalId');
    state.externalId =
      op === 'remove' ? null : profileString(value, 'externalId');
    return;
  }
  if (Object.hasOwn(PROFILE_STRINGS, attribute)) {
    const name = PROFILE_STRINGS[attribute];
    if (path.filter) throw notMultiValued(name);
    if (path.subAttribute) throw noSubAttribute(name);
    setOrDelete(
      state.profile,
      name,
      op === 'remove' ? null : profileString(value, name),
    );
    return;
  }
  if (Object.hasOwn(MULTI_VALUED, attribute)) {
    applyMultiValued(state.profile, MULTI_VALUED[attribute], op, path, value);
    return;
  }
  if (IGNORED_USER_ATTRIBUTES.has(attribute)) return;
  if (READ_ONLY_USER_ATTRIBUTES.has(attribute)) {
    if (ctx.mode === 'resource') return; // RFC 7644 §3.5.1: ignored in PUT
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
      // `"active": null` in a PUT body keeps the current state.
      if (ctx.mode === 'resource' && (value === null || value === undefined)) {
        return;
      }
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
  if (ctx.mode === 'resource') return;
  throw scimBadRequest(
    'invalidPath',
    `"${attribute}" is not an attribute of the User schema`,
  );
}

/**
 * `password` (RFC 7643 §4.1.1): write-only. An add or replace sets it; it
 * cannot be removed (that would leave a provisioned user without a way to
 * sign in that the client chose). The value's strength is checked against
 * the realm's policy by the service.
 */
function applyPassword(ctx: Context, op: ScimOperation, value: unknown): void {
  if (op === 'remove') {
    throw scimBadRequest('invalidValue', '"password" cannot be removed');
  }
  if (ctx.mode === 'resource' && (value === null || value === undefined)) {
    return; // a PUT without a password keeps the current one
  }
  if (typeof value !== 'string' || value === '') {
    throw scimBadRequest(
      'invalidValue',
      '"password" must be a non-empty string',
    );
  }
  if (value.length > MAX_SCIM_PASSWORD_LENGTH) {
    throw scimBadRequest(
      'invalidValue',
      `"password" must not exceed ${MAX_SCIM_PASSWORD_LENGTH} characters`,
    );
  }
  ctx.state.password = value;
}

/** The enterprise extension (RFC 7643 §4.3). */
function applyEnterprise(
  ctx: Context,
  op: ScimOperation,
  path: ScimPatchPath,
  value: unknown,
): void {
  const { profile } = ctx.state;
  const enterprise = (profile.enterprise ??= {});
  const { attribute } = path;
  if (path.filter) throw notMultiValued(attribute);

  if (Object.hasOwn(ENTERPRISE_STRINGS, attribute)) {
    const name = ENTERPRISE_STRINGS[attribute];
    if (path.subAttribute) throw noSubAttribute(name);
    setOrDelete(
      enterprise,
      name,
      op === 'remove' ? null : profileString(value, name),
    );
    return;
  }
  if (attribute === 'manager') {
    // Standard: `{"value": "<id>"}`. Entra ID sends the id as a bare
    // string, and an empty string or `{"value": ""}` to clear it.
    if (path.subAttribute !== undefined && path.subAttribute !== 'value') {
      if (path.subAttribute === 'displayname') return; // readOnly
      throw scimBadRequest(
        'invalidPath',
        `"manager.${path.subAttribute}" is not supported`,
      );
    }
    let id: unknown = value;
    if (op === 'remove') id = null;
    else if (path.subAttribute === undefined && isPlainObject(value)) {
      id = value['value'];
    }
    setOrDelete(enterprise, 'manager', profileString(id, 'manager.value'));
    return;
  }
  if (ctx.mode === 'resource') return;
  throw scimBadRequest(
    'invalidPath',
    `"${attribute}" is not an attribute of the enterprise User extension`,
  );
}

function applyName(
  state: Context['state'],
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
    delete state.profile.name;
    return;
  }
  if (value === null || value === undefined) return;
  if (!isPlainObject(value)) {
    throw scimBadRequest('invalidValue', '"name" must be an object');
  }
  // Only the sub-attributes given are changed (RFC 7644 §3.5.2.3).
  for (const [key, val] of Object.entries(value)) {
    setNamePart(state, key.toLowerCase(), val);
  }
}

function setNamePart(state: Context['state'], part: string, value: unknown) {
  if (part === 'givenname') {
    state.firstName = optionalString(value, 'name.givenName');
    return;
  }
  if (part === 'familyname') {
    state.lastName = optionalString(value, 'name.familyName');
    return;
  }
  if (!Object.hasOwn(PROFILE_NAME_PARTS, part)) {
    throw scimBadRequest('invalidPath', `"name.${part}" is not supported`);
  }
  const name = PROFILE_NAME_PARTS[part];
  const parts = (state.profile.name ??= {});
  setOrDelete(parts, name, profileString(value, `name.${name}`));
  if (Object.keys(parts).length === 0) delete state.profile.name;
}

/**
 * `emails`. One email is stored: the user's work/primary email. A filter
 * that selects it (`type eq "work"`, `primary eq true`, or its `value`)
 * reads and writes it; a filter for another kind of email (`type eq
 * "home"`) targets a value this server does not keep and is ignored.
 */
function applyEmails(
  state: Context['state'],
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
  if (value === null || value === undefined) {
    if (op === 'replace') state.email = null;
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

/**
 * `phoneNumbers` and `addresses`: lists of values, each told apart by its
 * `type`. The forms clients send:
 *   replace  path "phoneNumbers", value [...]                   the list
 *   add      path "phoneNumbers", value [...]                   adds, or
 *            updates the value of the same type
 *   add      path 'phoneNumbers[type eq "work"].value'          (Entra ID)
 *            sets that value, creating the work number if there is none
 *   remove   path 'phoneNumbers[type eq "work"]'                drops it
 *   remove   path "phoneNumbers"                                drops all
 */
function applyMultiValued(
  profile: ScimProfile,
  spec: MultiValuedSpec,
  op: ScimOperation,
  path: ScimPatchPath,
  value: unknown,
): void {
  const label = spec.key;
  let list: ScimMultiValue[] = (profile[spec.key] ?? []).map((v) => ({
    ...v,
  }));
  const sub =
    path.subAttribute === undefined
      ? undefined
      : canonicalSub(spec, path.subAttribute, label);

  if (path.filter) {
    const filter = path.filter;
    if (!Object.hasOwn(spec.subs, filter.attribute)) {
      throw scimBadRequest(
        'invalidPath',
        `Cannot filter ${label} on "${filter.attribute}"`,
      );
    }
    const matches = list.filter((item) => matchesItem(filter, item));
    if (op === 'remove') {
      if (sub) for (const item of matches) delete item[sub];
      else list = list.filter((item) => !matches.includes(item));
    } else {
      let targets = matches;
      if (targets.length === 0) {
        if (
          filter.operator !== 'eq' ||
          filter.value === null ||
          filter.value === undefined
        ) {
          throw scimBadRequest(
            'noTarget',
            `No value of ${label} matches the filter`,
          );
        }
        // Entra ID writes `phoneNumbers[type eq "work"].value` for a number
        // the user does not have yet: the filter describes the new value.
        const created: ScimMultiValue = {
          [spec.subs[filter.attribute]]:
            typeof filter.value === 'boolean'
              ? filter.value
              : String(filter.value),
        };
        list.push(created);
        targets = [created];
      }
      for (const item of targets) {
        if (sub) setSub(item, sub, value, label);
        else {
          if (!isPlainObject(value)) {
            throw scimBadRequest(
              'invalidValue',
              `A value of ${label} must be an object`,
            );
          }
          Object.assign(item, normalizeItem(spec, value, label));
        }
      }
    }
  } else if (sub) {
    if (op === 'remove') for (const item of list) delete item[sub];
    else {
      if (list.length === 0) list.push({});
      for (const item of list) setSub(item, sub, value, label);
    }
  } else if (op === 'remove' || value === null || value === undefined) {
    list = [];
  } else {
    const items = (Array.isArray(value) ? value : [value]).map((v) => {
      if (!isPlainObject(v)) {
        throw scimBadRequest(
          'invalidValue',
          `Each value of ${label} must be an object`,
        );
      }
      return normalizeItem(spec, v, label);
    });
    if (op === 'replace') list = items;
    else {
      for (const item of items) {
        const type = typeof item['type'] === 'string' ? item['type'] : null;
        const same =
          type === null
            ? -1
            : list.findIndex(
                (v) =>
                  typeof v['type'] === 'string' &&
                  v['type'].toLowerCase() === type.toLowerCase(),
              );
        if (same === -1) list.push(item);
        else list[same] = { ...list[same], ...item };
      }
    }
  }

  list = list.filter(hasContent);
  if (list.length > MAX_MULTI_VALUES) {
    throw scimBadRequest(
      'invalidValue',
      `At most ${MAX_MULTI_VALUES} values of ${label} are kept`,
    );
  }
  if (list.length === 0) delete profile[spec.key];
  else profile[spec.key] = list;
}

function canonicalSub(spec: MultiValuedSpec, sub: string, label: string) {
  if (!Object.hasOwn(spec.subs, sub)) {
    throw scimBadRequest('invalidPath', `"${label}.${sub}" is not supported`);
  }
  return spec.subs[sub];
}

/** A filter on a stored value; names in the filter are lowercased. */
function matchesItem(filter: ScimValueFilter, item: ScimMultiValue): boolean {
  const lowered: Record<string, string | boolean> = {};
  for (const [k, v] of Object.entries(item)) lowered[k.toLowerCase()] = v;
  return matchesValueFilter(filter, lowered);
}

function normalizeItem(
  spec: MultiValuedSpec,
  raw: Record<string, unknown>,
  label: string,
): ScimMultiValue {
  const item: ScimMultiValue = {};
  for (const [key, val] of Object.entries(raw)) {
    const lower = key.toLowerCase();
    if (!Object.hasOwn(spec.subs, lower)) continue; // e.g. "display" on addresses
    setSub(item, spec.subs[lower], val, label);
  }
  return item;
}

function setSub(
  item: ScimMultiValue,
  sub: string,
  value: unknown,
  label: string,
): void {
  if (value === null || value === undefined || value === '') {
    delete item[sub];
    return;
  }
  if (sub === 'primary') {
    item[sub] = coerceScimBoolean(value, `${label}.primary`);
    return;
  }
  const text = profileString(value, `${label}.${sub}`);
  if (text === null) delete item[sub];
  else item[sub] = text;
}

/** A value with more than its `type`/`primary` flags. */
const hasContent = (item: ScimMultiValue) =>
  Object.keys(item).some((k) => k !== 'type' && k !== 'primary');

function setOrDelete<T extends object>(
  target: T,
  key: keyof T,
  value: string | null,
): void {
  if (value === null) delete target[key];
  else (target as Record<keyof T, unknown>)[key] = value;
}

/** A profile string: null for null/empty, capped in length. */
function profileString(value: unknown, attribute: string): string | null {
  const text = optionalString(value, attribute);
  if (text !== null && text.length > MAX_PROFILE_TEXT) {
    throw scimBadRequest(
      'invalidValue',
      `"${attribute}" must not exceed ${MAX_PROFILE_TEXT} characters`,
    );
  }
  return text;
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
