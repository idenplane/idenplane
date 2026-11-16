/**
 * SCIM PATCH request parsing (RFC 7644 §3.5.2).
 *
 * Shared by the user and group PATCH handlers and by Bulk. Every parser here
 * scans its input once, left to right, with no backtracking regular
 * expressions, so a hostile path or filter costs linear time.
 */

import { scimBadRequest } from './scim-errors.js';
import { SCIM_OPERATIONS, SCIM_SCHEMAS } from './types/scim.types.js';
import type {
  NormalizedScimPatchOperation,
  ScimOperation,
} from './types/scim.types.js';

/** Longest path accepted; real paths are a few dozen characters. */
const MAX_PATH_LENGTH = 1024;

/**
 * The operations of a PATCH request body. RFC 7644 names the list
 * `Operations`; lowercase `operations` is accepted for older clients. Each
 * `op` is matched case-insensitively (Entra ID sends `Replace`).
 */
export function getPatchOperations(
  body: unknown,
): NormalizedScimPatchOperation[] {
  const record =
    typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>)
      : {};
  const list = record['Operations'] ?? record['operations'];
  if (!Array.isArray(list)) {
    throw scimBadRequest(
      'invalidSyntax',
      'The PATCH request must contain an "Operations" array',
    );
  }
  return list.map(normalizePatchOperation);
}

function normalizePatchOperation(raw: unknown): NormalizedScimPatchOperation {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw scimBadRequest('invalidSyntax', 'Each operation must be an object');
  }
  const { op, path, value } = raw as Record<string, unknown>;
  const name = typeof op === 'string' ? op.toLowerCase() : '';
  if (!(SCIM_OPERATIONS as readonly string[]).includes(name)) {
    throw scimBadRequest(
      'invalidSyntax',
      `Unsupported operation "${String(op)}"; use add, replace or remove`,
    );
  }
  if (path !== undefined && path !== null && typeof path !== 'string') {
    throw scimBadRequest('invalidPath', 'The "path" must be a string');
  }
  const trimmedPath =
    typeof path === 'string' && path.trim() !== '' ? path.trim() : undefined;
  if (name === 'remove' && !trimmedPath) {
    throw scimBadRequest('noTarget', 'A remove operation needs a "path"');
  }
  return { op: name as ScimOperation, path: trimmedPath, value };
}

export type ScimCompareOperator =
  'eq' | 'ne' | 'co' | 'sw' | 'ew' | 'gt' | 'ge' | 'lt' | 'le' | 'pr';

/** A single comparison inside a value path, e.g. `type eq "work"`. */
export interface ScimValueFilter {
  attribute: string;
  operator: ScimCompareOperator;
  value?: string | number | boolean | null;
}

/** A parsed PATCH path. Names are lowercased; SCIM names are case-insensitive. */
export interface ScimPatchPath {
  /** The schema URN prefix, lowercased, when the path had one. */
  schema?: string;
  attribute: string;
  filter?: ScimValueFilter;
  subAttribute?: string;
}

const COMPARE_OPERATORS = new Set([
  'eq',
  'ne',
  'co',
  'sw',
  'ew',
  'gt',
  'ge',
  'lt',
  'le',
]);

const isNameStart = (c: string) => /^[A-Za-z]$/.test(c);
const isNameChar = (c: string) => /^[A-Za-z0-9_$-]$/.test(c);

/**
 * Parses `attr`, `attr.sub`, `attr[filter]` or `attr[filter].sub`, with an
 * optional schema URN prefix (`urn:...:User:department`). The filter is a
 * single comparison (`type eq "work"`, `value eq "id"`, `primary eq true`)
 * or a presence test (`value pr`).
 */
export function parsePatchPath(path: string): ScimPatchPath {
  if (path.length > MAX_PATH_LENGTH) {
    throw scimBadRequest('invalidPath', 'The path is too long');
  }
  let rest = path;
  let schema: string | undefined;
  if (rest.toLowerCase().startsWith('urn:')) {
    // The attribute starts after the last ':' before any '[' (filter values
    // may themselves contain ':').
    const bracket = rest.indexOf('[');
    const head = bracket === -1 ? rest : rest.slice(0, bracket);
    const colon = head.lastIndexOf(':');
    schema = rest.slice(0, colon).toLowerCase();
    rest = rest.slice(colon + 1);
  }

  let i = 0;
  const readName = (): string => {
    const start = i;
    if (i >= rest.length || !isNameStart(rest[i])) {
      throw invalidPath(path);
    }
    i++;
    while (i < rest.length && isNameChar(rest[i])) i++;
    return rest.slice(start, i).toLowerCase();
  };

  const attribute = readName();
  let filter: ScimValueFilter | undefined;
  let subAttribute: string | undefined;

  if (rest[i] === '[') {
    const close = findFilterEnd(rest, i + 1);
    if (close === -1) throw invalidPath(path);
    filter = parseValueFilter(rest.slice(i + 1, close), path);
    i = close + 1;
  }
  if (rest[i] === '.') {
    i++;
    subAttribute = readName();
  }
  if (i !== rest.length) throw invalidPath(path);

  return { schema, attribute, filter, subAttribute };
}

/** Index of the `]` closing a filter, skipping quoted strings; -1 if none. */
function findFilterEnd(s: string, from: number): number {
  let quote: string | null = null;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === ']') {
      return i;
    }
  }
  return -1;
}

function parseValueFilter(text: string, path: string): ScimValueFilter {
  const s = text.trim();
  let i = 0;
  const skipSpace = () => {
    while (i < s.length && s[i] === ' ') i++;
  };
  const start = i;
  if (!isNameStart(s[i] ?? '')) throw invalidPath(path);
  while (i < s.length && (isNameChar(s[i]) || s[i] === '.')) i++;
  const attribute = s.slice(start, i).toLowerCase();
  if (s[i] !== ' ') throw invalidPath(path);
  skipSpace();
  const opStart = i;
  while (i < s.length && s[i] !== ' ') i++;
  const operator = s.slice(opStart, i).toLowerCase();
  skipSpace();
  const rawValue = s.slice(i);

  if (operator === 'pr') {
    if (rawValue !== '') throw invalidPath(path);
    return { attribute, operator: 'pr' };
  }
  if (!COMPARE_OPERATORS.has(operator) || rawValue === '') {
    throw invalidPath(path);
  }
  const value = parseCompareValue(rawValue);
  if (value === undefined) throw invalidPath(path);
  return { attribute, operator: operator as ScimCompareOperator, value };
}

/**
 * A comparison value (RFC 7644 §3.4.2.2 compValue): a JSON string, a number,
 * true, false or null. Single-quoted strings are also read, for clients that
 * followed older Idenplane docs. Returns undefined when `raw` is not exactly
 * one such value (so `"a" and b eq "c"` is rejected, not misread).
 */
export function parseCompareValue(
  raw: string,
): string | number | boolean | null | undefined {
  const s = raw.trim();
  if (s === 'true' || s === 'True') return true;
  if (s === 'false' || s === 'False') return false;
  if (s === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(s);
      return typeof parsed === 'string' ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
    const inner = s.slice(1, -1);
    return inner.includes("'") ? undefined : inner;
  }
  return undefined;
}

function invalidPath(path: string) {
  return scimBadRequest('invalidPath', `Invalid path "${path}"`);
}

/**
 * A boolean from a SCIM value. Entra ID sends `"True"`/`"False"` strings for
 * boolean attributes; those are read case-insensitively.
 */
export function coerceScimBoolean(value: unknown, attribute: string): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase();
    if (lower === 'true') return true;
    if (lower === 'false') return false;
  }
  throw scimBadRequest(
    'invalidValue',
    `"${attribute}" must be a boolean (true or false)`,
  );
}

/** True when `filter` matches a value whose sub-attributes are `record`. */
export function matchesValueFilter(
  filter: ScimValueFilter,
  record: Record<string, string | boolean | null | undefined>,
): boolean {
  const actual = record[filter.attribute];
  if (filter.operator === 'pr') {
    return actual !== undefined && actual !== null && actual !== '';
  }
  if (actual === undefined || actual === null) {
    return filter.operator === 'ne' && filter.value !== null;
  }
  if (typeof actual === 'boolean' || typeof filter.value !== 'string') {
    const expected =
      typeof filter.value === 'string'
        ? filter.value.toLowerCase() === 'true'
        : filter.value;
    if (filter.operator === 'eq') return actual === expected;
    if (filter.operator === 'ne') return actual !== expected;
    return false;
  }
  // String sub-attributes of the values this server stores (type, value,
  // display) are case-insensitive (RFC 7643 caseExact=false).
  const a = actual.toLowerCase();
  const e = filter.value.toLowerCase();
  switch (filter.operator) {
    case 'eq':
      return a === e;
    case 'ne':
      return a !== e;
    case 'co':
      return a.includes(e);
    case 'sw':
      return a.startsWith(e);
    case 'ew':
      return a.endsWith(e);
    case 'gt':
      return a > e;
    case 'ge':
      return a >= e;
    case 'lt':
      return a < e;
    case 'le':
      return a <= e;
    default:
      return false;
  }
}

/** Lowercased schema URNs, for matching path prefixes and value keys. */
export const CORE_USER_URN = SCIM_SCHEMAS.USER.toLowerCase();
export const CORE_GROUP_URN = SCIM_SCHEMAS.GROUP.toLowerCase();
export const ENTERPRISE_USER_URN = SCIM_SCHEMAS.ENTERPRISE_USER.toLowerCase();
