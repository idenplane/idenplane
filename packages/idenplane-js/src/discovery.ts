import type { OpenIDConfiguration } from './types.js';

const DISCOVERY_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Fetches and caches a realm's OIDC discovery document.
 *
 * Bug #438-2 fix: the discovery document was cached forever. If the IdP
 * returns an error (e.g. 5xx) and the cache somehow already held a stale
 * value, that stale config would be served indefinitely. More practically,
 * key-rotation events (IdP JWKS changes) would go undetected. Fix: record
 * the fetch timestamp and evict the cache after `DISCOVERY_TTL_MS` so the
 * discovery document is periodically re-fetched.
 */
export class DiscoveryClient {
  private config: OpenIDConfiguration | null = null;
  private fetchedAt: number | null = null;

  constructor(
    private readonly serverUrl: string,
    private readonly realm: string,
  ) {}

  /** Unconditionally re-fetch the discovery document, replacing any cached value. */
  async fetchDiscovery(): Promise<void> {
    const url = `${this.serverUrl}/realms/${this.realm}/.well-known/openid-configuration`;
    const response = await fetch(url);
    if (!response.ok) {
      // On error, evict any stale cached config so the next call retries.
      this.config = null;
      this.fetchedAt = null;
      throw new Error(`Failed to fetch OIDC discovery document from ${url}`);
    }
    this.config = await response.json();
    this.fetchedAt = Date.now();
  }

  /** Get the discovery document, fetching (or re-fetching an expired one) as needed. */
  async getConfig(): Promise<OpenIDConfiguration> {
    const now = Date.now();
    const isExpired = this.fetchedAt === null || now - this.fetchedAt > DISCOVERY_TTL_MS;

    if (!this.config || isExpired) {
      await this.fetchDiscovery();
    }
    return this.config!;
  }
}
