import { Prisma } from '@prisma/client';
import {
  readPrismaSchema,
  type SchemaField,
} from '../../../test/helpers/prisma-schema';
import {
  EXCLUDED_MODELS,
  EXPORT_MODELS,
  type ModelExportSpec,
} from './realm-export.fields';

/**
 * Fitness test: the realm export must account for every model and column of
 * the schema. A new column or model fails here until someone decides whether
 * it is exported (realm-export.fields.ts) or why it is not.
 */

const schema = readPrismaSchema();
const specs = EXPORT_MODELS as Record<string, ModelExportSpec>;

function literal(field: SchemaField): string {
  const modifier = field.list ? '[]' : field.optional ? '?' : '';
  return `${field.type}${modifier}${field.hasDefault ? ' @default' : ''}`;
}

describe('realm export allow-list (fitness)', () => {
  it('reads the schema', () => {
    expect(schema.models.size).toBeGreaterThan(50);
    expect(schema.models.get('Realm')?.fields.length).toBeGreaterThan(50);
  });

  it('classifies every model of the schema exactly once', () => {
    const problems: string[] = [];
    for (const name of schema.models.keys()) {
      const exported = name in specs;
      const excluded = name in EXCLUDED_MODELS;
      if (!exported && !excluded) {
        problems.push(
          `${name}: add it to EXPORT_MODELS or to EXCLUDED_MODELS with a reason`,
        );
      }
      if (exported && excluded) {
        problems.push(`${name}: listed as both exported and excluded`);
      }
    }
    for (const name of [
      ...Object.keys(specs),
      ...Object.keys(EXCLUDED_MODELS),
    ]) {
      if (!schema.models.has(name)) {
        problems.push(`${name}: no such model in prisma/schema.prisma`);
      }
    }
    for (const [name, reason] of Object.entries(EXCLUDED_MODELS)) {
      if (!reason.trim()) problems.push(`${name}: excluded without a reason`);
    }
    expect(problems).toEqual([]);
  });

  it('classifies every column of every exported model exactly once', () => {
    const problems: string[] = [];
    for (const [model, spec] of Object.entries(specs)) {
      const columns = schema.models
        .get(model)!
        .fields.filter((f) => f.scalar)
        .map((f) => f.name);
      const lists: Array<[string, string[]]> = [
        ['fields', Object.keys(spec.fields)],
        ['secrets', Object.keys(spec.secrets ?? {})],
        ['refs', Object.keys(spec.refs ?? {})],
        ['excluded', Object.keys(spec.excluded ?? {})],
      ];
      for (const column of columns) {
        const homes = lists.filter(([, names]) => names.includes(column));
        if (homes.length === 0) {
          problems.push(
            `${model}.${column}: neither exported nor excluded — add it to fields, secrets or refs, or to excluded with a reason`,
          );
        } else if (homes.length > 1) {
          problems.push(
            `${model}.${column}: listed in ${homes.map(([l]) => l).join(' and ')}`,
          );
        }
      }
      for (const [list, names] of lists) {
        for (const name of names) {
          if (!columns.includes(name)) {
            problems.push(`${model}.${list}.${name}: no such column`);
          }
        }
      }
      for (const [column, reason] of Object.entries(spec.excluded ?? {})) {
        if (!reason.trim()) {
          problems.push(`${model}.${column}: excluded without a reason`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('declares each exported column with the type the schema has', () => {
    const problems: string[] = [];
    for (const [model, spec] of Object.entries(specs)) {
      const byName = new Map(
        schema.models.get(model)!.fields.map((f) => [f.name, f]),
      );
      const declared: Array<[string, string]> = [
        ...Object.entries(spec.fields),
        ...Object.entries(spec.secrets ?? {}).map(
          ([name, s]) => [name, s.type] as [string, string],
        ),
      ];
      for (const [name, type] of declared) {
        const field = byName.get(name);
        if (field && literal(field) !== type) {
          problems.push(
            `${model}.${name}: declared '${type}', schema has '${literal(field)}'`,
          );
        }
      }
      for (const name of Object.keys(spec.jsonWithSecrets ?? {})) {
        if (!(name in spec.fields)) {
          problems.push(`${model}.${name}: jsonWithSecrets but not exported`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('agrees with the generated client (runtime DMMF)', () => {
    const problems: string[] = [];
    for (const [model, spec] of Object.entries(specs)) {
      const dmmf = Prisma.dmmf.datamodel.models.find((m) => m.name === model);
      if (!dmmf) {
        problems.push(`${model}: not in the generated client`);
        continue;
      }
      const columns = dmmf.fields
        .filter((f) => f.kind === 'scalar' || f.kind === 'enum')
        .map((f) => f.name)
        .sort();
      const classified = [
        ...Object.keys(spec.fields),
        ...Object.keys(spec.secrets ?? {}),
        ...Object.keys(spec.refs ?? {}),
        ...Object.keys(spec.excluded ?? {}),
      ].sort();
      if (JSON.stringify(columns) !== JSON.stringify(classified)) {
        problems.push(`${model}: columns differ from the generated client`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('never exports private keys, password hashes or tokens', () => {
    const forbidden = [
      'privateKey',
      'privateKeyPem',
      'passwordHash',
      'tokenHash',
      'keyHash',
      'codeHash',
    ];
    for (const spec of Object.values(specs)) {
      for (const name of [
        ...Object.keys(spec.fields),
        ...Object.keys(spec.secrets ?? {}),
      ]) {
        expect(forbidden).not.toContain(name);
      }
    }
  });
});
