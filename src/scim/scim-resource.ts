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
  const base = (process.env['BASE_URL'] ?? 'http://localhost:3000').replace(
    /\/+$/,
    '',
  );
  return `${base}/scim/v2/${encodeURIComponent(realm.name)}/${resource}/${encodeURIComponent(id)}`;
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
