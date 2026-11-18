/**
 * SCIM Filter Parser
 * Parses SCIM filter expressions per RFC 7644 Section 3.4.2.2
 *
 * Filter format: {attr} {operator} {value}
 * Example: userName eq "john"
 * Comparisons may be joined with `and` and `or` (`and` binds tighter, as in
 * RFC 7644); parentheses, `not` and value-path filters (`emails[...]`) are
 * not supported and are refused with 400 invalidFilter.
 */

import { Injectable, Logger } from '@nestjs/common';
import { parseCompareValue } from './patch-request.js';
import { scimBadRequest } from './scim-errors.js';

export interface FilterParseResult {
  attribute: string;
  operator: string;
  value: string | boolean | number | null;
}

const invalidFilter = (detail: string) =>
  scimBadRequest('invalidFilter', detail);

/**
 * Parse a SCIM filter string into components
 * Supports eq, ne, co, sw, ew, gt, ge, lt, le operators and `pr`
 */
export function parseScimFilter(filter: string): FilterParseResult {
  if (!filter || typeof filter !== 'string') {
    throw invalidFilter('Invalid filter expression');
  }

  const trimmed = filter.trim();

  // The attribute may carry a schema URN prefix, hence `:` and `-`. Neither
  // class overlaps `\s`, so the match stays linear.
  const presence = trimmed.match(/^([\w.:-]+)\s+pr$/i);
  if (presence) {
    return { attribute: presence[1], operator: 'pr', value: null };
  }

  // Match filter pattern: attribute operator value
  // Operators: eq, ne, co (contains), sw (starts with), ew (ends with), gt, ge, lt, le
  // The value group is `\S.*` rather than `.+`: forcing the first character to
  // be non-whitespace removes the overlap with the preceding `\s+`, which was
  // the source of the polynomial backtracking (CodeQL js/polynomial-redos). The
  // leading `\s+` already consumed any whitespace before the value.
  const operatorMatch = trimmed.match(
    /^([\w.:-]+)\s+(eq|ne|co|sw|ew|gt|ge|lt|le)\s+(\S.*)$/i,
  );

  if (!operatorMatch) {
    throw invalidFilter(`Invalid filter syntax: ${trimmed}`);
  }

  const [, attribute, operator, rawValue] = operatorMatch;
  // The value must be exactly one JSON value. A compound filter such as
  // `userName eq "a" and active eq true` is refused rather than read as one
  // long value; `and`/`or` are not supported.
  const value = parseCompareValue(rawValue);
  if (value === undefined) {
    throw invalidFilter(
      `Unsupported filter value: ${rawValue.trim()} (use one comparison with a quoted string, number, true, false or null)`,
    );
  }

  return {
    attribute: attribute.trim(),
    operator: operator.toLowerCase(),
    value,
  };
}

/** Most comparisons one filter may join with `and`/`or`. */
const MAX_FILTER_COMPARISONS = 20;

/**
 * Splits a filter into its comparisons: the result is an OR of ANDs
 * (`a and b or c` → [[a, b], [c]]). Scans once, left to right, outside
 * quoted strings; each comparison is then read by {@link parseScimFilter}.
 */
export function parseScimFilterExpression(
  filter: string,
): FilterParseResult[][] {
  if (!filter || typeof filter !== 'string') {
    throw invalidFilter('Invalid filter expression');
  }
  const groups: FilterParseResult[][] = [[]];
  let count = 0;
  let start = 0;
  let quote: string | null = null;
  const push = (end: number) => {
    const text = filter.slice(start, end);
    if (++count > MAX_FILTER_COMPARISONS) {
      throw invalidFilter(
        `A filter may join at most ${MAX_FILTER_COMPARISONS} comparisons`,
      );
    }
    groups[groups.length - 1].push(parseScimFilter(text));
  };
  for (let i = 0; i < filter.length; i++) {
    const c = filter[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === '(' || c === ')' || c === '[' || c === ']') {
      throw invalidFilter(
        'Grouping and value-path filters are not supported; join comparisons with "and" or "or"',
      );
    }
    if (c !== ' ') continue;
    // A logical operator is a whole word between spaces.
    const word = /^(and|or) +/i.exec(filter.slice(i + 1, i + 6));
    if (!word) continue;
    push(i);
    if (word[1].toLowerCase() === 'or') groups.push([]);
    i += word[0].length;
    start = i + 1;
  }
  if (quote) throw invalidFilter('Unterminated string in filter');
  push(filter.length);
  return groups;
}

type FieldKind = 'string' | 'exact' | 'boolean' | 'id' | 'member';

/**
 * Filterable User attributes, by lowercased SCIM name. Only these reach the
 * database query: a client must never filter on an arbitrary column (such
 * as `passwordHash` or `realmId`).
 */
const USER_FILTER_FIELDS: Record<string, { field: string; kind: FieldKind }> = {
  id: { field: 'id', kind: 'id' },
  username: { field: 'username', kind: 'string' },
  'name.givenname': { field: 'firstName', kind: 'string' },
  'name.familyname': { field: 'lastName', kind: 'string' },
  emails: { field: 'email', kind: 'string' },
  'emails.value': { field: 'email', kind: 'string' },
  active: { field: 'enabled', kind: 'boolean' },
  externalid: { field: 'scimExternalId', kind: 'exact' },
};

const GROUP_FILTER_FIELDS: Record<string, { field: string; kind: FieldKind }> =
  {
    id: { field: 'id', kind: 'id' },
    displayname: { field: 'name', kind: 'string' },
    externalid: { field: 'scimExternalId', kind: 'exact' },
    members: { field: 'userGroups', kind: 'member' },
    'members.value': { field: 'userGroups', kind: 'member' },
  };

function fieldCondition(
  parsed: FilterParseResult,
  spec: { field: string; kind: FieldKind },
): Record<string, unknown> {
  const { operator, value, attribute } = parsed;
  const { field, kind } = spec;

  if (kind === 'member') {
    // `members eq "<userId>"`: the groups that user belongs to.
    if (operator === 'pr') return { [field]: { some: {} } };
    if (operator !== 'eq' || typeof value !== 'string') {
      throw invalidFilter(
        `"${attribute}" supports only eq with a user id, or pr`,
      );
    }
    return { [field]: { some: { userId: value } } };
  }

  if (operator === 'pr') {
    return kind === 'string' || kind === 'exact'
      ? { [field]: { not: null } }
      : {};
  }

  if (kind === 'boolean') {
    if (typeof value !== 'boolean') {
      throw invalidFilter(`"${attribute}" must be compared with true or false`);
    }
    if (operator === 'eq') return { [field]: value };
    if (operator === 'ne') return { [field]: { not: value } };
    throw invalidFilter(
      `Operator "${operator}" is not supported for "${attribute}"`,
    );
  }

  if (value === null) {
    if (kind === 'id') throw invalidFilter('"id" cannot be null');
    if (operator === 'eq') return { [field]: null };
    if (operator === 'ne') return { [field]: { not: null } };
    throw invalidFilter(`Operator "${operator}" cannot compare with null`);
  }

  const text = String(value);
  if (kind === 'id') {
    if (operator === 'eq') return { [field]: text };
    if (operator === 'ne') return { [field]: { not: text } };
    throw invalidFilter(`Operator "${operator}" is not supported for "id"`);
  }

  if (kind === 'exact') {
    // externalId is caseExact (RFC 7643 §3.1).
    switch (operator) {
      case 'eq':
        return { [field]: text };
      case 'ne':
        return { [field]: { not: text } };
      case 'co':
        return { [field]: { contains: text } };
      case 'sw':
        return { [field]: { startsWith: text } };
      case 'ew':
        return { [field]: { endsWith: text } };
    }
  }

  // String attributes here are case-insensitive (RFC 7643 caseExact=false).
  const mode = 'insensitive';
  switch (operator) {
    case 'eq':
      return { [field]: { equals: text, mode } };
    case 'ne':
      return { [field]: { not: text, mode } };
    case 'co':
      return { [field]: { contains: text, mode } };
    case 'sw':
      return { [field]: { startsWith: text, mode } };
    case 'ew':
      return { [field]: { endsWith: text, mode } };
    case 'gt':
      return { [field]: { gt: text } };
    case 'ge':
      return { [field]: { gte: text } };
    case 'lt':
      return { [field]: { lt: text } };
    case 'le':
      return { [field]: { lte: text } };
    default:
      throw invalidFilter(`Unsupported operator: ${operator}`);
  }
}

function toWhere(
  filter: string,
  realmId: string,
  fields: Record<string, { field: string; kind: FieldKind }>,
  resource: string,
): Record<string, unknown> {
  const condition = (parsed: FilterParseResult) => {
    const key = parsed.attribute
      .replace(/^urn:ietf:params:scim:schemas:core:2\.0:(User|Group):/i, '')
      .toLowerCase();
    const spec = Object.hasOwn(fields, key) ? fields[key] : undefined;
    if (!spec) {
      throw invalidFilter(
        `Filtering ${resource} on "${parsed.attribute}" is not supported`,
      );
    }
    return fieldCondition(parsed, spec);
  };
  const groups = parseScimFilterExpression(filter).map((all) =>
    all.length === 1 ? condition(all[0]) : { AND: all.map(condition) },
  );
  const where = groups.length === 1 ? groups[0] : { OR: groups };
  // realmId last, so no filter can widen the query to another realm: it
  // is ANDed with the whole expression.
  return { ...where, realmId };
}

/**
 * Convert SCIM filter to Prisma where clause for Users
 */
export function scimFilterToPrismaWhereUser(
  filter: string,
  realmId: string,
): Record<string, unknown> {
  return toWhere(filter, realmId, USER_FILTER_FIELDS, 'Users');
}

/**
 * Convert SCIM filter to Prisma where clause for Groups
 */
export function scimFilterToPrismaWhereGroup(
  filter: string,
  realmId: string,
): Record<string, unknown> {
  return toWhere(filter, realmId, GROUP_FILTER_FIELDS, 'Groups');
}

@Injectable()
export class ScimFilterParserService {
  private readonly logger = new Logger(ScimFilterParserService.name);

  parseFilter(filter: string): FilterParseResult {
    try {
      return parseScimFilter(filter);
    } catch (error) {
      this.logger.warn(`Failed to parse SCIM filter: ${filter}`, error);
      throw error;
    }
  }

  toPrismaWhereUser(filter: string, realmId: string): Record<string, unknown> {
    try {
      return scimFilterToPrismaWhereUser(filter, realmId);
    } catch (error) {
      this.logger.warn(
        `Failed to convert filter to Prisma where: ${filter}`,
        error,
      );
      throw error;
    }
  }

  toPrismaWhereGroup(filter: string, realmId: string): Record<string, unknown> {
    try {
      return scimFilterToPrismaWhereGroup(filter, realmId);
    } catch (error) {
      this.logger.warn(
        `Failed to convert filter to Prisma where: ${filter}`,
        error,
      );
      throw error;
    }
  }
}
