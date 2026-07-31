/**
 * SSRF guard: classifies IP addresses (and, eventually, hostname literals)
 * as "blocked" (private / loopback / link-local / reserved / cloud-metadata)
 * vs. public-routable.
 *
 * This module is intentionally dependency-free (uses only `node:net`) so it
 * can be safely reused both by DTO-time validation (no I/O, must stay fast)
 * and by the delivery-time safe HTTP client (see
 * `src/common/security/safe-http-client.ts`), which is the authoritative
 * enforcement point since DNS answers can change between webhook
 * configuration and delivery.
 *
 * IPv4 blocklist:
 *
 *   0.0.0.0/8         "this" network
 *   10.0.0.0/8        RFC1918 private
 *   100.64.0.0/10     CGNAT (RFC6598)
 *   127.0.0.0/8       loopback
 *   169.254.0.0/16    link-local (covers the 169.254.169.254 cloud
 *                     metadata endpoint used by AWS/GCP/Azure/etc.)
 *   172.16.0.0/12     RFC1918 private
 *   192.0.0.0/24      IETF protocol assignments
 *   192.0.2.0/24      TEST-NET-1 (RFC5737)
 *   192.168.0.0/16    RFC1918 private
 *   198.18.0.0/15     benchmarking (RFC2544)
 *   198.51.100.0/24   TEST-NET-2 (RFC5737)
 *   203.0.113.0/24    TEST-NET-3 (RFC5737)
 *   224.0.0.0/4       multicast
 *   240.0.0.0/4       reserved for future use
 *   255.255.255.255   limited broadcast
 *
 * IPv6 blocklist:
 *
 *   ::1/128           loopback
 *   ::/128            unspecified
 *   fc00::/7          unique local address (ULA)
 *   fe80::/10         link-local
 *   ff00::/8          multicast
 *   2001:db8::/32     documentation (RFC3849)
 *   64:ff9b::/96      NAT64 well-known prefix (RFC6052)
 *
 * In addition, IPv4-mapped (::ffff:0:0/96), IPv4-compatible (::/96,
 * deprecated) and 6to4 (2002::/16) addresses have their embedded IPv4
 * address extracted and re-checked against the IPv4 blocklist above, so
 * that mapped-address bypass tricks (e.g. ::ffff:127.0.0.1) cannot be used
 * to reach an otherwise-blocked IPv4 target.
 *
 * Non-IP hostname literals are also covered by `isBlockedHostnameLiteral`:
 *
 *   - `localhost`, `localhost.localdomain`, and any name ending in
 *     `.localhost` (loopback aliases that never require a DNS lookup).
 *   - Decimal / octal / hex IPv4 literal encodings that Node's URL/`net`
 *     parsing does not canonicalize, e.g. `2130706433` (decimal),
 *     `017700000001` (octal), `0x7f.0x0.0x0.0x1` (per-octet hex), and
 *     legacy short (`inet_aton`-style) dotted forms such as `0x7f.1`.
 */

import { isIP } from 'node:net';

/**
 * IPv4 CIDR blocks that must never be reachable via outbound webhook
 * delivery. Values are `[network, prefixLength]` pairs.
 */
const IPV4_BLOCKED_RANGES: ReadonlyArray<readonly [string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
  ['255.255.255.255', 32],
];

/**
 * Convert a dotted-quad IPv4 address into an unsigned 32-bit integer.
 * Returns `null` if `ip` is not a syntactically valid dotted-quad IPv4
 * literal (each octet 0-255, exactly four octets, no leading garbage).
 */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;

  let value = 0;
  for (const part of parts) {
    // Reject empty segments and anything that isn't a plain base-10
    // integer (e.g. leading '+', whitespace). This intentionally does not
    // accept octal/hex/decimal-integer encodings here -- those are handled
    // separately by the hostname-literal normalizer.
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = (value << 8) | octet;
  }
  return value >>> 0;
}

/**
 * Return `true` if the 32-bit unsigned integer `value` falls within the
 * CIDR block `network/prefixLength`.
 */
function ipv4IntInCidr(
  value: number,
  network: string,
  prefixLength: number,
): boolean {
  const base = ipv4ToInt(network);
  if (base === null) return false;
  const mask = prefixLength === 0 ? 0 : (~0 << (32 - prefixLength)) >>> 0;
  return (value & mask) === (base & mask);
}

/**
 * Return `true` if the given IPv4 literal falls within any blocked range
 * (private, loopback, link-local, reserved, cloud-metadata, etc).
 *
 * `ip` must already be known to be a valid IPv4 literal (e.g. checked via
 * `node:net`'s `isIP`); malformed input is treated as blocked (fail closed).
 */
export function isBlockedIpv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  if (value === null) {
    // Fail closed: an address we cannot confidently classify as public
    // must not be treated as safe to connect to.
    return true;
  }
  return IPV4_BLOCKED_RANGES.some(([network, prefixLength]) =>
    ipv4IntInCidr(value, network, prefixLength),
  );
}

/**
 * IPv6 CIDR blocks that must never be reachable via outbound webhook
 * delivery. Values are `[network, prefixLength]` pairs; `network` is
 * expressed as a normal IPv6 literal (parsed via `ipv6ToBigInt`).
 */
const IPV6_BLOCKED_RANGES: ReadonlyArray<readonly [string, number]> = [
  ['::1', 128], // loopback
  ['::', 128], // unspecified
  ['fc00::', 7], // unique local address (ULA)
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
  ['2001:db8::', 32], // documentation (RFC3849)
  ['64:ff9b::', 96], // NAT64 well-known prefix (RFC6052)
];

/** Full 128-bit all-ones mask, used to build IPv6 CIDR prefix masks. */
const FULL_128_MASK = (1n << 128n) - 1n;

/** Build a 128-bit prefix mask (top `prefixLength` bits set). */
function ipv6PrefixMask(prefixLength: number): bigint {
  if (prefixLength <= 0) return 0n;
  if (prefixLength >= 128) return FULL_128_MASK;
  return (FULL_128_MASK << BigInt(128 - prefixLength)) & FULL_128_MASK;
}

/**
 * Expand an IPv6 literal (as validated by `node:net`'s `isIP`) into its 8
 * constituent 16-bit hex groups, resolving `::` compression and any
 * trailing IPv4 dotted-quad tail (e.g. `::ffff:192.168.1.1`).
 *
 * Returns `null` if the address cannot be confidently parsed.
 */
function expandIpv6Groups(ip: string): string[] | null {
  let addr = ip;

  // Strip a zone index (e.g. `fe80::1%eth0`) if present -- not expected for
  // webhook URL hostnames, but strip defensively rather than fail to parse.
  const percentIdx = addr.indexOf('%');
  if (percentIdx !== -1) addr = addr.slice(0, percentIdx);

  // Handle a trailing IPv4 dotted-quad tail (e.g. `::ffff:192.168.1.1`) by
  // converting it into two hextets so the rest of the parser only ever
  // deals with plain colon-separated hex groups.
  const lastColon = addr.lastIndexOf(':');
  const tailCandidate = addr.slice(lastColon + 1);
  if (tailCandidate.includes('.')) {
    const v4 = ipv4ToInt(tailCandidate);
    if (v4 === null) return null;
    const hi = ((v4 >>> 16) & 0xffff).toString(16);
    const lo = (v4 & 0xffff).toString(16);
    addr = `${addr.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const firstDoubleColon = addr.indexOf('::');
  if (
    firstDoubleColon !== -1 &&
    addr.indexOf('::', firstDoubleColon + 1) !== -1
  ) {
    // More than one '::' is never valid.
    return null;
  }

  let groups: string[];
  if (firstDoubleColon === -1) {
    groups = addr.split(':');
    if (groups.length !== 8) return null;
  } else {
    const left = addr.slice(0, firstDoubleColon);
    const right = addr.slice(firstDoubleColon + 2);
    const leftParts = left.length > 0 ? left.split(':') : [];
    const rightParts = right.length > 0 ? right.split(':') : [];
    const missing = 8 - (leftParts.length + rightParts.length);
    if (missing < 0) return null;
    const zeroFill: string[] = new Array<string>(missing).fill('0');
    groups = [...leftParts, ...zeroFill, ...rightParts];
  }

  if (groups.length !== 8) return null;
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
  }
  return groups;
}

/**
 * Parse an IPv6 literal into its 128-bit unsigned integer representation.
 * Returns `null` if `ip` cannot be parsed as a valid IPv6 literal.
 */
function ipv6ToBigInt(ip: string): bigint | null {
  const groups = expandIpv6Groups(ip);
  if (!groups) return null;
  let value = 0n;
  for (const group of groups) {
    value = (value << 16n) | BigInt(parseInt(group, 16));
  }
  return value;
}

/**
 * Return `true` if the 128-bit unsigned integer `value` falls within the
 * CIDR block `network/prefixLength`.
 */
function ipv6InCidr(
  value: bigint,
  network: string,
  prefixLength: number,
): boolean {
  const base = ipv6ToBigInt(network);
  if (base === null) return false;
  const mask = ipv6PrefixMask(prefixLength);
  return (value & mask) === (base & mask);
}

/** Convert the low 32 bits of `value` into a dotted-quad IPv4 string. */
function bigIntToIpv4(value: bigint): string {
  const v = Number(value & 0xffffffffn);
  return [
    (v >>> 24) & 0xff,
    (v >>> 16) & 0xff,
    (v >>> 8) & 0xff,
    v & 0xff,
  ].join('.');
}

/**
 * Return `true` if the given IPv6 literal falls within any blocked range,
 * either directly (loopback, ULA, link-local, multicast, documentation,
 * NAT64) or indirectly by embedding a blocked IPv4 address via
 * IPv4-mapped (`::ffff:0:0/96`), IPv4-compatible (`::/96`, deprecated), or
 * 6to4 (`2002::/16`) encoding.
 *
 * `ip` must already be known to be a valid IPv6 literal (e.g. checked via
 * `node:net`'s `isIP`); malformed input is treated as blocked (fail closed).
 */
export function isBlockedIpv6(ip: string): boolean {
  const value = ipv6ToBigInt(ip);
  if (value === null) {
    // Fail closed: an address we cannot confidently classify as public
    // must not be treated as safe to connect to.
    return true;
  }

  if (
    IPV6_BLOCKED_RANGES.some(([network, prefixLength]) =>
      ipv6InCidr(value, network, prefixLength),
    )
  ) {
    return true;
  }

  const mask96 = ipv6PrefixMask(96);

  // IPv4-mapped (::ffff:0:0/96): low 32 bits carry the embedded IPv4
  // address, e.g. ::ffff:127.0.0.1 embeds 127.0.0.1.
  const mappedBase = ipv6ToBigInt('::ffff:0:0');
  if (mappedBase !== null && (value & mask96) === (mappedBase & mask96)) {
    return isBlockedIpv4(bigIntToIpv4(value & 0xffffffffn));
  }

  // IPv4-compatible (::/96, deprecated): low 32 bits carry the embedded
  // IPv4 address, e.g. ::127.0.0.1 embeds 127.0.0.1. Overlaps with `::` and
  // `::1` (already caught above) but harmless to re-check.
  if ((value & mask96) === 0n) {
    return isBlockedIpv4(bigIntToIpv4(value & 0xffffffffn));
  }

  // 6to4 (2002::/16): bits 16-47 (from the most-significant bit) carry the
  // embedded IPv4 address, e.g. 2002:7f00:0001:: embeds 127.0.0.1.
  const sixToFourBase = ipv6ToBigInt('2002::');
  const mask16 = ipv6PrefixMask(16);
  if (sixToFourBase !== null && (value & mask16) === (sixToFourBase & mask16)) {
    const embedded = (value >> 80n) & 0xffffffffn;
    return isBlockedIpv4(bigIntToIpv4(embedded));
  }

  return false;
}

/**
 * Classify an IP address literal (IPv4 or IPv6) as blocked (private /
 * loopback / link-local / reserved / cloud-metadata) or not.
 *
 * Fails closed: any input that is not recognised as a valid, public IPv4 or
 * IPv6 literal is treated as blocked.
 */
export function isBlockedIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    return isBlockedIpv4(ip);
  }
  if (family === 6) {
    return isBlockedIpv6(ip);
  }
  // Not a valid IP literal at all.
  return true;
}

/**
 * Loopback-alias hostnames that must never be treated as safe delivery
 * targets, even though they are not IP literals and would otherwise
 * require a DNS lookup to resolve. These are well-known conventions (not
 * exhaustive of every possible `/etc/hosts` entry an attacker controls),
 * used to close the most common non-IP SSRF bypass strings.
 */
const BLOCKED_HOSTNAME_LITERALS: ReadonlySet<string> = new Set([
  'localhost',
  'localhost.localdomain',
]);

/**
 * Parse a single dotted-segment of a numeric IPv4 literal (e.g. the `0x7f`
 * in `0x7f.0x0.0x0.0x1`, or the whole string when there is only one
 * segment, e.g. `2130706433`) and return its numeric value.
 *
 * Supports the three encodings historically accepted by C's `inet_aton`
 * (and, transitively, by many URL parsers/`curl`/browsers) that Node's
 * `net.isIP` does *not* recognise as IPv4 literals:
 *
 *   - decimal:   `2130706433`, `127`      (no leading zero, or exactly "0")
 *   - octal:     `017700000001`, `0177`   (leading zero, remaining digits 0-7)
 *   - hex:       `0x7f000001`, `0x7f`     (`0x`/`0X` prefix)
 *
 * Returns `null` if `segment` is empty or contains characters that don't
 * unambiguously match one of the above encodings (fail closed by refusing
 * to treat it as a numeric literal at all, rather than guessing).
 */
function parseNumericIpv4Segment(segment: string): number | null {
  if (segment.length === 0) return null;

  let value: number;
  if (/^0[xX][0-9a-fA-F]+$/.test(segment)) {
    value = parseInt(segment.slice(2), 16);
  } else if (/^0[0-7]+$/.test(segment)) {
    value = parseInt(segment, 8);
  } else if (segment === '0' || /^[1-9][0-9]*$/.test(segment)) {
    value = parseInt(segment, 10);
  } else {
    // Contains characters that don't cleanly match decimal/octal/hex
    // (e.g. "08", a mixed-radix or otherwise malformed segment, or a plain
    // non-numeric DNS label like "dev").
    return null;
  }

  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

/**
 * Attempt to normalize a numeric IPv4 literal -- expressed as a single
 * whole 32-bit number, or as 2-4 dotted segments using legacy
 * `inet_aton`-style combining rules -- into a canonical dotted-quad IPv4
 * string (e.g. `2130706433` -> `127.0.0.1`).
 *
 * Each segment may independently use decimal, octal (leading `0`), or hex
 * (`0x`/`0X` prefix) encoding, matching real-world parser behavior (this is
 * exactly why `0x7f.0x0.0x0.0x1` and `017700000001` are viable SSRF bypass
 * strings against naive hostname validation).
 *
 * Returns `null` if `hostname` is not a valid numeric IPv4 literal in any
 * of these forms (e.g. it's an ordinary DNS name).
 */
function normalizeNumericIpv4Literal(hostname: string): string | null {
  const segments = hostname.split('.');
  if (segments.length < 1 || segments.length > 4) return null;

  const values: number[] = [];
  for (const segment of segments) {
    const value = parseNumericIpv4Segment(segment);
    if (value === null) return null;
    values.push(value);
  }

  // Combine segments using inet_aton-style rules: the last segment absorbs
  // whatever bits remain after the preceding segments each claim one octet.
  let ipInt: number;
  switch (values.length) {
    case 1: {
      const [a] = values;
      if (a > 0xffffffff) return null;
      ipInt = a >>> 0;
      break;
    }
    case 2: {
      const [a, b] = values;
      if (a > 0xff || b > 0xffffff) return null;
      ipInt = ((a << 24) | b) >>> 0;
      break;
    }
    case 3: {
      const [a, b, c] = values;
      if (a > 0xff || b > 0xff || c > 0xffff) return null;
      ipInt = ((a << 24) | (b << 16) | c) >>> 0;
      break;
    }
    default: {
      const [a, b, c, d] = values;
      if (a > 0xff || b > 0xff || c > 0xff || d > 0xff) return null;
      ipInt = ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
      break;
    }
  }

  return [
    (ipInt >>> 24) & 0xff,
    (ipInt >>> 16) & 0xff,
    (ipInt >>> 8) & 0xff,
    ipInt & 0xff,
  ].join('.');
}

/**
 * Classify a hostname *literal* (as opposed to an IP address) as blocked
 * without performing any DNS lookup. Covers non-IP bypass strings that
 * resolve to loopback/local addresses via OS-level or library-level
 * shortcuts rather than a real DNS answer:
 *
 *   - `localhost`, `localhost.localdomain`, and any name ending in
 *     `.localhost`.
 *   - Numeric IPv4 literal encodings (decimal/octal/hex, whole-number or
 *     dotted) that many HTTP clients/parsers accept but that don't look
 *     like a "normal" dotted-quad IPv4 address, e.g. `2130706433`,
 *     `017700000001`, `0x7f.0x0.0x0.0x1`.
 *   - Ordinary IP literals (IPv4/IPv6) are also accepted here and deferred
 *     to `isBlockedIp`, so callers can run every hostname through this one
 *     function regardless of whether it turns out to be an IP literal.
 *
 * This function performs no I/O and is safe to call synchronously from
 * DTO-time validation. It is intentionally a *subset* of the delivery-time
 * checks in `safe-http-client.ts`: it cannot catch a hostname that merely
 * *resolves* to a private address via real DNS, since that requires an
 * actual lookup.
 */
export function isBlockedHostnameLiteral(hostname: string): boolean {
  let host = hostname.trim().toLowerCase();

  // Normalize a bracketed IPv6 literal (as it would appear in a URL, e.g.
  // "[::1]") and strip a trailing FQDN dot (e.g. "localhost.").
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
  }
  if (host.endsWith('.') && host.length > 1) {
    host = host.slice(0, -1);
  }

  if (host.length === 0) {
    // Fail closed: an empty/unparseable host is never a valid delivery
    // target.
    return true;
  }

  if (BLOCKED_HOSTNAME_LITERALS.has(host) || host.endsWith('.localhost')) {
    return true;
  }

  // If it's already a recognised IP literal (IPv4/IPv6), defer to the
  // canonical IP classifier.
  if (isIP(host) !== 0) {
    return isBlockedIp(host);
  }

  // Otherwise, check whether it's a numeric IPv4 literal in
  // decimal/octal/hex encoding that `net.isIP` doesn't recognise as an IP
  // at all (e.g. "2130706433", "017700000001", "0x7f.0x0.0x0.0x1").
  const normalized = normalizeNumericIpv4Literal(host);
  if (normalized !== null) {
    return isBlockedIpv4(normalized);
  }

  return false;
}
