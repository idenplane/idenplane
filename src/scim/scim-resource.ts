/**
 * Helpers shared by the SCIM resource services.
 */

import type { ScimRealmRef } from './types/scim.types.js';

/** Largest page a list request returns (ServiceProviderConfig maxResults). */
export const SCIM_MAX_PAGE_SIZE = 100;

/**
 * The resource's URI for `meta.location` and the `Location` header
 * (RFC 7643 §3.1): absolute, under the realm's SCIM base URL.
 */
export function scimLocation(
  realm: ScimRealmRef,
  resource: 'Users' | 'Groups',
  id: string,
): string {
  return `${scimBaseUrl(realm.name)}/${resource}/${encodeURIComponent(id)}`;
}

/**
 * The SCIM base URL: the realm's (`/scim/v2/{realm}`), or the realm-less
 * one discovery is also served at.
 */
export function scimBaseUrl(realmName?: string): string {
  const base = (process.env['BASE_URL'] ?? 'http://localhost:3000').replace(
    /\/+$/,
    '',
  );
  return realmName === undefined
    ? `${base}/scim/v2`
    : `${base}/scim/v2/${encodeURIComponent(realmName)}`;
}

/**
 * RFC 7644 §3.4.2.4: `startIndex` below 1 is read as 1, a negative `count`
 * as 0. Anything unreadable falls back to the defaults.
 */
export function normalizePagination(
  startIndex: number | undefined,
  count: number | undefined,
): { startIndex: number; count: number } {
  const start =
    typeof startIndex === 'number' && Number.isFinite(startIndex)
      ? Math.max(1, Math.floor(startIndex))
      : 1;
  const size =
    typeof count === 'number' && Number.isFinite(count)
      ? Math.min(Math.max(0, Math.floor(count)), SCIM_MAX_PAGE_SIZE)
      : SCIM_MAX_PAGE_SIZE;
  return { startIndex: start, count: size };
}

/** A copy of `value` with any `password` key removed, for the audit log. */
export function withoutPassword<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v: unknown) => withoutPassword(v)) as T;
  }
  if (typeof value !== 'object' || value === null) return value;
  const copy: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (key.toLowerCase() === 'password') continue;
    if (
      key.toLowerCase() === 'path' &&
      typeof val === 'string' &&
      /password/i.test(val)
    ) {
      // A PATCH operation on the password: keep the op, drop the value.
      return { op: (value as { op?: unknown }).op, path: val } as T;
    }
    copy[key] = withoutPassword(val);
  }
  return copy as T;
}

/** `attributes` / `excludedAttributes` of a request (RFC 7644 §3.4.2.5). */
export interface ScimProjection {
  attributes?: string[];
  excludedAttributes?: string[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * An attribute path as the keys of a resource: `name.givenName` →
 * [name, givenName]; `urn:...:core:2.0:User:userName` → [userName];
 * `urn:...:enterprise:2.0:User:department` → [<that URN>, department].
 * `schemaUrns` are the resource's schemas, core first.
 */
function attributePath(raw: string, schemaUrns: string[]): string[] {
  const text = raw.trim();
  const lower = text.toLowerCase();
  for (const [index, urn] of schemaUrns.entries()) {
    const prefix = urn.toLowerCase();
    if (lower === prefix) return index === 0 ? [] : [urn];
    if (lower.startsWith(`${prefix}:`)) {
      const rest = text.slice(prefix.length + 1).split('.');
      return index === 0 ? rest : [urn, ...rest];
    }
  }
  return text.split('.');
}

/** The key of `obj` equal to `name`, ignoring case (SCIM names are). */
function findKey(obj: Record<string, unknown>, name: string) {
  const lower = name.toLowerCase();
  return Object.keys(obj).find((k) => k.toLowerCase() === lower);
}

/** The part of `value` at `path`, keeping its shape; undefined if absent. */
function pick(value: unknown, path: string[]): unknown {
  if (path.length === 0) return value;
  if (Array.isArray(value)) {
    return value.map((v) => pick(v, path) ?? {});
  }
  if (!isRecord(value)) return undefined;
  const key = findKey(value, path[0]);
  if (key === undefined) return undefined;
  const inner = pick(value[key], path.slice(1));
  return inner === undefined ? undefined : { [key]: inner };
}

/** Deep-merges `source` into `target` (arrays element by element). */
function merge(target: unknown, source: unknown): unknown {
  if (Array.isArray(target) && Array.isArray(source)) {
    return source.map((v, i) => merge(target[i], v));
  }
  if (isRecord(target) && isRecord(source)) {
    const out: Record<string, unknown> = { ...target };
    for (const [k, v] of Object.entries(source)) {
      out[k] = k in out ? merge(out[k], v) : v;
    }
    return out;
  }
  return source;
}

function omit(value: unknown, path: string[]): void {
  if (Array.isArray(value)) {
    for (const v of value) omit(v, path);
    return;
  }
  if (!isRecord(value) || path.length === 0) return;
  const key = findKey(value, path[0]);
  if (key === undefined) return;
  if (path.length === 1) delete value[key];
  else omit(value[key], path.slice(1));
}

/**
 * Applies `attributes` or `excludedAttributes` to a resource. Names are
 * case-insensitive and may carry a schema URN. `always` are the top-level
 * attributes returned whatever the request asks (RFC 7643 `returned:
 * "always"`): `schemas`, `id`, `meta` and the resource's own (`userName`,
 * `displayName`). `attributes` wins when both are given.
 */
export function projectResource<T extends object>(
  resource: T,
  projection: ScimProjection,
  schemaUrns: string[],
  always: string[],
): T {
  const attributes = projection.attributes?.filter((a) => a.trim() !== '');
  if (attributes && attributes.length > 0) {
    const source = resource as Record<string, unknown>;
    let out: unknown = {};
    for (const name of [...always, ...attributes]) {
      const path = attributePath(name, schemaUrns);
      if (path.length === 0) continue;
      const picked = pick(source, path);
      if (picked !== undefined) out = merge(out, picked);
    }
    return out as T;
  }
  const excluded = projection.excludedAttributes?.filter(
    (a) => a.trim() !== '',
  );
  if (!excluded || excluded.length === 0) return resource;
  const copy = structuredClone(resource) as Record<string, unknown>;
  const keep = new Set(always.map((a) => a.toLowerCase()));
  for (const name of excluded) {
    const path = attributePath(name, schemaUrns);
    if (
      path.length === 0 ||
      (path.length === 1 && keep.has(path[0].toLowerCase()))
    ) {
      continue;
    }
    omit(copy, path);
  }
  return copy as T;
}

/**
 * Whether a projection returns `attribute` (or part of it), so the
 * service can skip loading it (a group's members).
 */
export function projectionIncludes(
  projection: ScimProjection,
  attribute: string,
): boolean {
  const lower = attribute.toLowerCase();
  const names = (list: string[] | undefined) =>
    (list ?? [])
      .map((a) =>
        a
          .trim()
          .toLowerCase()
          .replace(/^urn:.*:/, ''),
      )
      .filter((a) => a !== '');
  const attributes = names(projection.attributes);
  if (attributes.length > 0) {
    return attributes.some((a) => a === lower || a.startsWith(`${lower}.`));
  }
  return !names(projection.excludedAttributes).includes(lower);
}
