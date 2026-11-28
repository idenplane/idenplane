/**
 * Where geo-IP lookups go, if anywhere.
 *
 * Looking an address up sends the user's IP to a third party, so it is off
 * unless the operator chooses a provider (`GEOIP_PROVIDER`):
 *
 * - unset / `none` (default): no lookups; geo signals (impossible travel,
 *   network context, sign-in locations) are simply unavailable.
 * - `ip-api-pro`: `https://pro.ip-api.com` with `GEOIP_API_KEY`, over TLS.
 * - `ip-api`: the free `http://ip-api.com` endpoint, which has no TLS: the
 *   address and the answer cross the network in clear text. Choose it only
 *   knowingly.
 *
 * Read per call so tests (and a restart-free config reload) see changes.
 */

export type GeoIpProvider = 'none' | 'ip-api' | 'ip-api-pro';

export function geoIpProvider(): GeoIpProvider {
  const raw = (process.env['GEOIP_PROVIDER'] ?? '').trim().toLowerCase();
  if (raw === 'ip-api' || raw === 'ip-api-pro') return raw;
  return 'none';
}

/**
 * The ip-api URL for one address and field list, or null when lookups are
 * off (or `ip-api-pro` is chosen without a key).
 */
export function ipApiUrl(ip: string, fields: string): string | null {
  const path = `/json/${encodeURIComponent(ip)}?fields=${fields}`;
  switch (geoIpProvider()) {
    case 'ip-api-pro': {
      const key = process.env['GEOIP_API_KEY']?.trim();
      if (!key) return null;
      return `https://pro.ip-api.com${path}&key=${encodeURIComponent(key)}`;
    }
    case 'ip-api':
      return `http://ip-api.com${path}`;
    default:
      return null;
  }
}
