import { $Enums, Prisma } from '@prisma/client';
import type { FieldType, ModelExportSpec } from './realm-export.fields.js';

/**
 * Reads, checks and writes the columns an allow-list (realm-export.fields.ts)
 * names, from their declared types. Used by the export, the import validator
 * and the import itself, so all three agree on every field.
 */

export interface ParsedType {
  base: string;
  list: boolean;
  nullable: boolean;
  hasDefault: boolean;
  /** Must be present in an import (no default, not nullable, not a list). */
  required: boolean;
}

const cache = new Map<string, ParsedType>();

export function parseFieldType(type: FieldType): ParsedType {
  let parsed = cache.get(type);
  if (parsed) return parsed;
  const [head, ...attributes] = type.split(' ');
  const list = head.endsWith('[]');
  const nullable = head.endsWith('?');
  const base = list ? head.slice(0, -2) : nullable ? head.slice(0, -1) : head;
  const hasDefault = attributes.includes('@default');
  parsed = {
    base,
    list,
    nullable,
    hasDefault,
    required: !list && !nullable && !hasDefault,
  };
  cache.set(type, parsed);
  return parsed;
}

const ENUMS = $Enums as unknown as Record<string, Record<string, string>>;

export function enumValues(name: string): string[] | undefined {
  const values = ENUMS[name];
  return values ? Object.values(values) : undefined;
}

const INT_MIN = -2147483648;
const INT_MAX = 2147483647;

export interface FieldProblem {
  path: string;
  message: string;
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value === 'object' ? 'an object' : typeof value;
}

/** Why `value` is not a valid `base` value, or undefined. */
function scalarProblem(base: string, value: unknown): string | undefined {
  switch (base) {
    case 'String':
      return typeof value === 'string'
        ? undefined
        : `must be a string, not ${describe(value)}`;
    case 'Boolean':
      return typeof value === 'boolean'
        ? undefined
        : `must be a boolean, not ${describe(value)}`;
    case 'Int':
      return typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= INT_MIN &&
        value <= INT_MAX
        ? undefined
        : `must be a 32-bit integer, not ${typeof value === 'number' ? String(value) : describe(value)}`;
    case 'Float':
      return typeof value === 'number' && Number.isFinite(value)
        ? undefined
        : `must be a number, not ${describe(value)}`;
    case 'DateTime':
      return typeof value === 'string' && !Number.isNaN(Date.parse(value))
        ? undefined
        : 'must be an ISO 8601 date-time string';
    case 'Json':
      return undefined;
    default: {
      const values = enumValues(base);
      if (!values) return `has an unsupported type ${base}`;
      return typeof value === 'string' && values.includes(value)
        ? undefined
        : `must be one of ${values.join(', ')}`;
    }
  }
}

/** Why `value` cannot be imported into a column of `type`, or undefined. */
export function fieldProblem(
  type: FieldType,
  value: unknown,
): string | undefined {
  const t = parseFieldType(type);
  if (value === null) {
    return t.nullable ? undefined : 'must not be null';
  }
  if (t.list) {
    if (!Array.isArray(value))
      return `must be an array, not ${describe(value)}`;
    for (let i = 0; i < value.length; i++) {
      const problem = scalarProblem(t.base, value[i]);
      if (problem) return `[${i}] ${problem}`;
    }
    return undefined;
  }
  return scalarProblem(t.base, value);
}

/** The value as it goes into the export file. */
export function exportValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  return value;
}

/** The value as it goes into Prisma create data. */
export function importValue(type: FieldType, value: unknown): unknown {
  const t = parseFieldType(type);
  // Prisma refuses a bare null for a Json column.
  if (value === null) return t.base === 'Json' ? Prisma.DbNull : null;
  if (t.base === 'DateTime') return new Date(value as string);
  return value;
}

/** The exported (non-secret) columns of a row, in allow-list order. */
export function pickFields(
  spec: ModelExportSpec,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const name of Object.keys(spec.fields)) {
    out[name] = exportValue(row[name]);
  }
  return out;
}

/**
 * Check an object's allow-listed columns: types, enums, nulls and required
 * fields. `secrets` columns are checked when present.
 */
export function checkFields(
  spec: ModelExportSpec,
  item: Record<string, unknown>,
  path: string,
  problems: FieldProblem[],
): void {
  const columns: Array<[string, FieldType]> = [
    ...Object.entries(spec.fields),
    ...Object.entries(spec.secrets ?? {}).map(
      ([name, s]) => [name, s.type] as [string, FieldType],
    ),
  ];
  for (const [name, type] of columns) {
    const isSecret = !!spec.secrets && name in spec.secrets;
    if (!(name in item) || item[name] === undefined) {
      // A missing secret is allowed: exports leave secrets out by default.
      if (parseFieldType(type).required && !isSecret) {
        problems.push({ path: `${path}.${name}`, message: 'is required' });
      }
      continue;
    }
    const problem = fieldProblem(type, item[name]);
    if (problem) problems.push({ path: `${path}.${name}`, message: problem });
  }
}

/** Report keys of `item` that are not columns of `spec` or in `extra`. */
export function checkUnknownKeys(
  spec: ModelExportSpec,
  item: Record<string, unknown>,
  path: string,
  extra: readonly string[],
  problems: FieldProblem[],
): void {
  for (const key of Object.keys(item)) {
    if (
      key in spec.fields ||
      (spec.secrets && key in spec.secrets) ||
      extra.includes(key)
    ) {
      continue;
    }
    problems.push({ path: `${path}.${key}`, message: 'is not a known field' });
  }
}

/**
 * Prisma create data for the allow-listed, non-secret columns present in
 * `item`. A missing column is left out, so the schema default applies; a
 * missing list without a default becomes an empty list.
 */
export function createData(
  spec: ModelExportSpec,
  item: Record<string, unknown>,
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const [name, type] of Object.entries(spec.fields)) {
    const value = item[name];
    if (value === undefined) {
      const t = parseFieldType(type);
      if (t.list && !t.hasDefault) data[name] = [];
      continue;
    }
    data[name] = importValue(type, value);
  }
  return data;
}

/** True for a plain JSON object (not null, not an array). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
