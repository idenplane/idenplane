/**
 * Utility for safe client-IP resolution behind a reverse proxy.
 *
 * Background
 * ----------
 * The `X-Forwarded-For` header is trivially spoofable by any client unless
 * we know that the immediate TCP peer that set the header is a trusted proxy.
 * Without that check an attacker can send:
 *
 *   X-Forwarded-For: 1.2.3.4
 *
 * and bypass per-IP rate limiting entirely.
 *
 * Resolution rules
 * ----------------
 * 1. If `TRUSTED_PROXIES` is not set (the default) we never consult
 *    `X-Forwarded-For` — we use the raw socket address instead.
 *
 * 2. If `TRUSTED_PROXIES=*` we accept `X-Forwarded-For` unconditionally
 *    (suitable for environments where the network layer already guarantees
 *    the header is clean, e.g. a managed cloud load-balancer with no
 *    direct public access to the app process).
 *
 * 3. If `TRUSTED_PROXIES` is a comma-separated list of IP addresses / CIDR
 *    blocks (e.g. `10.0.0.1,172.16.0.0/12`) we only honour the header when
 *    the immediate peer (socket address) is in that list.
 *
 * Usage
 * -----
 * Import `resolveClientIp` wherever a client IP is needed:
 *
 *   const ip = resolveClientIp(request);
 */

import type { Request } from 'express';

// ─── CIDR helper (IPv4 only) ────────────────────────────────────────────────

/**
 * Parse an IPv4 CIDR block into its numeric base address and mask.
 * Returns `null` when the input is not a valid IPv4 CIDR / address.
 */
function parseCidr(cidr: string): { base: number; mask: number } | null {
  const [addr, prefix] = cidr.split('/');
  const parts = addr?.split('.');
  if (!parts || parts.length !== 4) return null;

  let base = 0;
  for (const part of parts) {
    const octet = parseInt(part, 10);
    if (isNaN(octet) || octet < 0 || octet > 255) return null;
    base = (base << 8) | octet;
  }
  // Coerce to unsigned 32-bit integer
  base = base >>> 0;

  const prefixLen = prefix !== undefined ? parseInt(prefix, 10) : 32;
  if (isNaN(prefixLen) || prefixLen < 0 || prefixLen > 32) return null;

  const mask = prefixLen === 0 ? 0 : (~0 << (32 - prefixLen)) >>> 0;
  return { base: base & mask, mask };
}

/**
 * Return `true` when `ip` falls within the given CIDR block / host address.
 */
function ipInCidr(ip: string, cidr: string): boolean {
  const range = parseCidr(cidr);
  const host = parseCidr(ip);
  if (!range || !host) return false;
  return (host.base & range.mask) === range.base;
}

// ─── Trusted proxy list ─────────────────────────────────────────────────────

/**
 * Parsed representation of the `TRUSTED_PROXIES` environment variable.
 *
 * - `type: 'none'`  — variable unset; never trust X-Forwarded-For
 * - `type: 'all'`   — `TRUSTED_PROXIES=*`; always trust X-Forwarded-For
 * - `type: 'list'`  — comma-separated IPs/CIDRs; trust only when peer matches
 */
type TrustedProxyConfig =
  { type: 'none' } | { type: 'all' } | { type: 'list'; entries: string[] };

function parseTrustedProxies(raw: string | undefined): TrustedProxyConfig {
  if (!raw || raw.trim() === '') return { type: 'none' };
  if (raw.trim() === '*') return { type: 'all' };
  const entries = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return { type: 'list', entries };
}

/** Lazily-initialised so tests can set env vars before the first import. */
let _config: TrustedProxyConfig | null = null;

function getTrustedProxyConfig(): TrustedProxyConfig {
  if (_config === null) {
    _config = parseTrustedProxies(process.env['TRUSTED_PROXIES']);
  }
  return _config;
}

/**
 * Reset the cached config. Intended for use in tests only.
 */
export function resetTrustedProxyConfig(): void {
  _config = null;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Resolve the real client IP address from an Express request, taking the
 * `TRUSTED_PROXIES` environment variable into account.
 *
 * @param request - The Express `Request` object.
 * @returns The client IP string, or `'unknown'` if it cannot be determined.
 */
export function resolveClientIp(request: Request): string {
  const socketIp = request.socket?.remoteAddress ?? 'unknown';
  const config = getTrustedProxyConfig();

  if (config.type === 'none') {
    // No trusted proxy configured — always use the raw socket address to
    // prevent X-Forwarded-For spoofing.
    return socketIp;
  }

  const xff = request.headers['x-forwarded-for'] as string | undefined;
  if (!xff) {
    return socketIp;
  }

  const proxyTrusted =
    config.type === 'all' ||
    config.entries.some((cidr) => ipInCidr(socketIp, cidr));

  if (!proxyTrusted) {
    // The immediate peer is not a trusted proxy — ignore the header.
    return socketIp;
  }

  // Use the leftmost (original client) IP from the header.
  const clientIp = xff.split(',')[0]?.trim();
  return clientIp || socketIp;
}
