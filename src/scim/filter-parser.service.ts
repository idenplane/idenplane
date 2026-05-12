/**
 * SCIM Filter Parser
 * Parses SCIM filter expressions per RFC 7644 Section 3.4.2.2
 *
 * Filter format: {attr} {operator} {value}
 * Example: userName eq "john"
 * Combined: userName eq "john" and emails.primary eq true
 */

import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import type { ParsedScimFilter } from './types/scim.types.js';

export interface FilterParseResult {
  attribute: string;
  operator: string;
  value: string | boolean | number;
}

/**
 * Parse a SCIM filter string into components
 * Supports eq, ne, co, sw, ew, gt, ge, lt, le operators
 */
export function parseScimFilter(filter: string): FilterParseResult {
  if (!filter || typeof filter !== 'string') {
    throw new BadRequestException('Invalid filter expression');
  }

  const trimmed = filter.trim();

  // Match filter pattern: attribute operator value
  // Operators: eq, ne, co (contains), sw (starts with), ew (ends with), gt, ge, lt, le
  const operatorMatch = trimmed.match(
    /^([\w.]+)\s+(eq|ne|co|sw|ew|gt|ge|lt|le)\s+(.+)$/i,
  );

  if (!operatorMatch) {
    throw new BadRequestException(`Invalid filter syntax: ${trimmed}`);
  }

  const [, attribute, operator, rawValue] = operatorMatch;
  const value = parseFilterValue(rawValue.trim());

  return {
    attribute: attribute.trim(),
    operator: operator.toLowerCase(),
    value,
  };
}

/**
 * Parse filter value - handles quoted strings, booleans, numbers
 */
function parseFilterValue(raw: string): string | boolean | number {
  // Boolean
  if (raw === 'true') return true;
  if (raw === 'false') return false;

  // Number
  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    return parseFloat(raw);
  }

  // Quoted string
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return raw.slice(1, -1);
  }

  // Unquoted string
  return raw;
}

/**
 * Convert SCIM filter to Prisma where clause for Users
 */
export function scimFilterToPrismaWhereUser(
  filter: string,
  realmId: string,
): Record<string, unknown> {
  const parsed = parseScimFilter(filter);
  const { attribute, operator, value } = parsed;

  // Map SCIM attributes to database fields
  const attrToField: Record<string, string> = {
    userName: 'username',
    'name.givenName': 'firstName',
    'name.familyName': 'lastName',
    displayName: 'displayName',
    'emails.value': 'email',
    active: 'enabled',
    title: 'title',
    externalId: 'federationLink',
  };

  const field = attrToField[attribute] || attribute;

  switch (operator) {
    case 'eq':
      return { realmId, [field]: value };
    case 'ne':
      return { realmId, [field]: { not: value } };
    case 'co': // contains
      return { realmId, [field]: { contains: String(value) } };
    case 'sw': // starts with
      return { realmId, [field]: { startsWith: String(value) } };
    case 'ew': // ends with
      return { realmId, [field]: { endsWith: String(value) } };
    case 'gt':
      return { realmId, [field]: { gt: value } };
    case 'ge':
      return { realmId, [field]: { gte: value } };
    case 'lt':
      return { realmId, [field]: { lt: value } };
    case 'le':
      return { realmId, [field]: { lte: value } };
    default:
      throw new BadRequestException(`Unsupported operator: ${operator}`);
  }
}

/**
 * Convert SCIM filter to Prisma where clause for Groups
 */
export function scimFilterToPrismaWhereGroup(
  filter: string,
  realmId: string,
): Record<string, unknown> {
  const parsed = parseScimFilter(filter);
  const { attribute, operator, value } = parsed;

  if (attribute === 'displayName') {
    switch (operator) {
      case 'eq':
        return { realmId, name: value };
      case 'ne':
        return { realmId, name: { not: value } };
      case 'co':
        return { realmId, name: { contains: String(value) } };
      case 'sw':
        return { realmId, name: { startsWith: String(value) } };
      case 'ew':
        return { realmId, name: { endsWith: String(value) } };
      default:
        throw new BadRequestException(
          `Unsupported operator for displayName: ${operator}`,
        );
    }
  }

  if (attribute === 'externalId') {
    switch (operator) {
      case 'eq':
        return { realmId, id: value };
      default:
        throw new BadRequestException(
          `Unsupported operator for externalId: ${operator}`,
        );
    }
  }

  throw new BadRequestException(`Unsupported attribute: ${attribute}`);
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
