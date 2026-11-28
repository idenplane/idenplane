/**
 * Utility for safe client-IP resolution behind a reverse proxy.
 *
 * Background
 * ----------
 * `X-Forwarded-For` is a list each proxy *appends* to: a client can put any
 * value in it, and every proxy adds the address it saw on the right. So only
 * the entries added by proxies we trust are facts; everything to their left
 * may have been written by the client. Taking the leftmost entry lets an
 * attacker send
 *
 *   X-Forwarded-For: 1.2.3.4
 *
 * and be rate-limited, audited and risk-scored as 1.2.3.4.
 *
 * Resolution rules
 * ----------------
 * 1. `TRUSTED_PROXIES` not set (the default): `X-Forwarded-For` is never
 *    read; the socket address is the client.
 *
 * 2. `TRUSTED_PROXIES=*`: one trusted hop. The immediate peer is taken to be
 *    the (only) proxy, so the client is the rightmost `X-Forwarded-For`
 *    entry, the one that proxy appended. Suitable when the proxy is the only
 *    thing that can reach the app (the bundled TLS compose files). For a
 *    chain of proxies, list them instead.
 *
 * 3. `TRUSTED_PROXIES` is a comma-separated list of IPv4/IPv6 addresses and
 *    CIDR blocks (also `loopback`, `linklocal`, `uniquelocal`, as Express
 *    accepts): starting from the socket address and walking `X-Forwarded-For`
 *    from right to left, every hop in the list is skipped; the first one that
 *    is not is the client.
 *
 * Both match Express's `trust proxy` (set from the same variable in main.ts),
 * so `req.ip` (used by the rate limiter) and `resolveClientIp` agree.
 *
 * Usage
 * -----
 *   const ip = resolveClientIp(request);
 */

import { BlockList, isIP } from 'node:net';
import type { Request } from 'express';
import { normalizeIp } from '../../mtls/cidr.js';

/** The named ranges Express's `trust proxy` (proxy-addr) accepts. */
const NAMED_RANGES: Record<string, string[]> = {
  loopback: ['127.0.0.1/8', '::1/128'],
  linklocal: ['169.254.0.0/16', 'fe80::/10'],
  uniquelocal: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', 'fc00::/7'],
};

/**
 * Adds one address or CIDR block to `list`. Returns false (and adds nothing)
 * for an entry that is not one.
 */
function addEntry(list: BlockList, raw: string): boolean {
  const named = NAMED_RANGES[raw.toLowerCase()];
  if (named) {
    for (const r of named) addEntry(list, r);
    return true;
  }
  const slash = raw.indexOf('/');
  const address = normalizeIp(slash === -1 ? raw : raw.slice(0, slash));
  const family = isIP(address);
  if (family === 0) return false;
  const type = family === 4 ? 'ipv4' : 'ipv6';
  if (slash === -1) {
    list.addAddress(address, type);
    return true;
  }
  let prefix = Number(raw.slice(slash + 1));
  // A mapped prefix (::ffff:10.0.0.0/104) names its IPv4 network.
  if (family === 4 && raw.slice(0, slash).toLowerCase().startsWith('::ffff:'))
    prefix -= 96;
  const max = family === 4 ? 32 : 128;
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > max) return false;
  list.addSubnet(address, prefix, type);
  return true;
}

/**
 * Parsed representation of the `TRUSTED_PROXIES` environment variable.
 *
 * - `type: 'none'` — variable unset; never trust X-Forwarded-For
 * - `type: 'one-hop'` — `TRUSTED_PROXIES=*`; trust the immediate peer only
 * - `type: 'list'` — trust every hop inside the listed networks
 */
type TrustedProxyConfig =
  { type: 'none' } | { type: 'one-hop' } | { type: 'list'; list: BlockList };

function parseTrustedProxies(raw: string | undefined): TrustedProxyConfig {
  if (!raw || raw.trim() === '') return { type: 'none' };
  if (raw.trim() === '*') return { type: 'one-hop' };
  const list = new BlockList();
  // An entry that is not an address or CIDR block trusts nothing (Express
  // refuses it at startup when main.ts hands it the same list).
  for (const entry of raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean))
    addEntry(list, entry);
  return { type: 'list', list };
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

function isTrusted(list: BlockList, address: string): boolean {
  const ip = normalizeIp(address);
  const family = isIP(ip);
  if (family === 0) return false;
  return list.check(ip, family === 4 ? 'ipv4' : 'ipv6');
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
  const rawSocketIp = request.socket?.remoteAddress;
  const socketIp = rawSocketIp ? normalizeIp(rawSocketIp) : 'unknown';
  const config = getTrustedProxyConfig();

  if (config.type === 'none') {
    // No trusted proxy configured — always use the raw socket address to
    // prevent X-Forwarded-For spoofing.
    return socketIp;
  }

  const header = request.headers['x-forwarded-for'];
  const xff = Array.isArray(header) ? header.join(',') : header;
  if (!xff) return socketIp;
  const hops = xff
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (hops.length === 0) return socketIp;

  if (config.type === 'one-hop') {
    // The peer is the proxy; the entry it appended is the client.
    return normalizeIp(hops[hops.length - 1]);
  }

  // Walk from the socket leftwards while the hop is a trusted proxy.
  if (!isTrusted(config.list, socketIp)) return socketIp;
  for (let i = hops.length - 1; i >= 0; i--) {
    const hop = normalizeIp(hops[i]);
    if (!isTrusted(config.list, hop)) return hop;
  }
  // Every hop is a trusted proxy: the leftmost is as far as we can see.
  return normalizeIp(hops[0]);
}
