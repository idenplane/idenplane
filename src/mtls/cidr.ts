import { BlockList, isIP } from 'node:net';

/**
 * CIDR blocks that would trust every peer. A certificate header is only as
 * trustworthy as the proxy that set it, so "anyone" is never an acceptable
 * answer.
 */
const MATCH_ALL = new Set(['*', '0.0.0.0/0', '::/0', '::ffff:0:0/96']);

export class CidrListError extends Error {}

/** `::ffff:10.0.0.1` → `10.0.0.1`; any other address is returned unchanged. */
export function normalizeIp(address: string): string {
  const trimmed = address.trim();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(trimmed);
  return mapped ? mapped[1] : trimmed;
}

/**
 * A fixed set of IPv4 and IPv6 networks, matched with `net.BlockList`.
 * IPv4-mapped IPv6 addresses (`::ffff:a.b.c.d`) match their IPv4 network,
 * which is how a dual-stack socket reports an IPv4 peer.
 */
export class CidrMatcher {
  private constructor(
    private readonly list: BlockList,
    readonly entries: readonly string[],
  ) {}

  /**
   * Parses a comma-separated list of addresses and CIDR blocks. Throws
   * {@link CidrListError} on an empty list, an invalid entry, or one that
   * matches every address.
   */
  static parse(value: string): CidrMatcher {
    const entries = value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '');
    if (entries.length === 0) {
      throw new CidrListError('the list is empty');
    }
    const list = new BlockList();
    for (const entry of entries) {
      addEntry(list, entry);
    }
    return new CidrMatcher(list, entries);
  }

  /** True when `address` (a socket's remote address) is inside the list. */
  contains(address: string | undefined): boolean {
    if (!address) return false;
    const ip = normalizeIp(address);
    const family = isIP(ip);
    if (family === 0) return false;
    return this.list.check(ip, family === 4 ? 'ipv4' : 'ipv6');
  }
}

function addEntry(list: BlockList, raw: string): void {
  if (MATCH_ALL.has(raw.toLowerCase()) || raw.includes('*')) {
    throw new CidrListError(`"${raw}" would trust every address`);
  }
  const slash = raw.indexOf('/');
  const address = normalizeIp(slash === -1 ? raw : raw.slice(0, slash));
  const family = isIP(address);
  if (family === 0) {
    throw new CidrListError(`"${raw}" is not an IP address or CIDR block`);
  }
  const type = family === 4 ? 'ipv4' : 'ipv6';
  if (slash === -1) {
    list.addAddress(address, type);
    return;
  }
  const prefixText = raw.slice(slash + 1);
  const max = family === 4 ? 32 : 128;
  // A mapped address with an IPv6-sized prefix (::ffff:10.0.0.0/104) is
  // rewritten to its IPv4 network.
  const mappedOffset =
    family === 4 && raw.slice(0, slash).toLowerCase().startsWith('::ffff:')
      ? 96
      : 0;
  if (!/^\d{1,3}$/.test(prefixText)) {
    throw new CidrListError(`"${raw}" has an invalid prefix length`);
  }
  const prefix = Number(prefixText) - mappedOffset;
  if (prefix < 0 || prefix > max) {
    throw new CidrListError(`"${raw}" has an invalid prefix length`);
  }
  if (prefix === 0) {
    throw new CidrListError(`"${raw}" would trust every address`);
  }
  list.addSubnet(address, prefix, type);
}
