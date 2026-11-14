import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A small reader for prisma/schema.prisma, used by the realm export fitness
 * test and the round-trip test. Prisma 7's runtime DMMF has field names and
 * types only (no list, optional or default flags), so the schema text is the
 * source of truth here. The input is our own schema file, not user input.
 */

export interface SchemaField {
  name: string;
  /** Base type: String, Int, … or an enum or model name. */
  type: string;
  list: boolean;
  optional: boolean;
  hasDefault: boolean;
  /** The text inside @default(…), if any. */
  defaultText?: string;
  /** Scalar or enum (stored in a column), as opposed to a relation. */
  scalar: boolean;
  /** @db.VarChar(n) length, if any. */
  maxLength?: number;
}

export interface SchemaModel {
  name: string;
  fields: SchemaField[];
}

export interface PrismaSchema {
  models: Map<string, SchemaModel>;
  enums: Map<string, string[]>;
}

const SCALARS = new Set([
  'String',
  'Int',
  'BigInt',
  'Float',
  'Decimal',
  'Boolean',
  'DateTime',
  'Json',
  'Bytes',
]);

function defaultOf(attributes: string): string | undefined {
  const start = attributes.indexOf('@default(');
  if (start < 0) return undefined;
  let depth = 0;
  for (let i = start + '@default'.length; i < attributes.length; i++) {
    const ch = attributes[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) {
        return attributes.slice(start + '@default('.length, i);
      }
    }
  }
  return undefined;
}

export function readPrismaSchema(
  path = join(__dirname, '..', '..', 'prisma', 'schema.prisma'),
): PrismaSchema {
  const text = readFileSync(path, 'utf8');
  const lines = text.split(/\r?\n/);

  const enums = new Map<string, string[]>();
  const rawModels: Array<{ name: string; lines: string[] }> = [];
  let block: { kind: 'model' | 'enum'; name: string; lines: string[] } | null =
    null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!block) {
      const words = line.split(/\s+/);
      if ((words[0] === 'model' || words[0] === 'enum') && words[2] === '{') {
        block = { kind: words[0], name: words[1], lines: [] };
      }
      continue;
    }
    if (line === '}') {
      if (block.kind === 'enum') {
        enums.set(block.name, block.lines);
      } else {
        rawModels.push({ name: block.name, lines: block.lines });
      }
      block = null;
      continue;
    }
    if (!line || line.startsWith('//') || line.startsWith('@@')) continue;
    if (block.kind === 'enum') {
      block.lines.push(line.split(/\s+/)[0]);
    } else {
      block.lines.push(line);
    }
  }

  const models = new Map<string, SchemaModel>();
  for (const raw of rawModels) {
    const fields: SchemaField[] = [];
    for (const line of raw.lines) {
      const commentAt = line.indexOf('//');
      const body = commentAt >= 0 ? line.slice(0, commentAt) : line;
      const [name, typeText, ...rest] = body.trim().split(/\s+/);
      if (!name || !typeText) continue;
      const attributes = rest.join(' ');
      const list = typeText.endsWith('[]');
      const optional = typeText.endsWith('?');
      const type = typeText.replace(/(\[\]|\?)$/, '');
      const scalar = SCALARS.has(type) || enums.has(type);
      const defaultText = defaultOf(attributes);
      const varchar = attributes.indexOf('@db.VarChar(');
      fields.push({
        name,
        type,
        list,
        optional,
        hasDefault:
          defaultText !== undefined || attributes.includes('@updatedAt'),
        defaultText,
        scalar,
        maxLength:
          varchar >= 0
            ? parseInt(attributes.slice(varchar + '@db.VarChar('.length), 10)
            : undefined,
      });
    }
    models.set(raw.name, { name: raw.name, fields });
  }
  return { models, enums };
}
