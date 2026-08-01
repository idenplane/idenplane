import type { TokenResponse } from './types.js';
import type { TokenStorage } from './storage.js';
import type { EventEmitter } from './events.js';
import type { IdenplaneEventMap } from './types.js';
import { getTokenExpiresIn, parseJwt } from './token.js';
import { performSilentRefresh } from './silent-refresh.js';

// For "eager" strategy, refresh this much earlier than the normal buffer
const EAGER_REFRESH_MULTIPLIER = 2;

export interface TokenRefresherDeps {
  storage: TokenStorage;
  events: EventEmitter<IdenplaneEventMap>;
  getOidcConfig: () => Promise<{ authorization_endpoint: string; token_endpoint: string }>;
  /** Persists newly-obtained tokens (and invalidates any caches keyed on them). */
  storeTokens: (tokens: TokenResponse) => void;
  /** Discards all stored tokens, e.g. after the server definitively rejects a refresh. */
  clearTokens: () => void;
  clientId: string;
  scopes: string[];
  redirectUri: string;
  silentRedirectUri?: string;
  refreshStrategy: 'silent' | 'rotation' | 'eager';
  refreshBuffer: number;
  autoRefresh: boolean;
}

/**
 * Owns the token-refresh lifecycle: dispatching to the configured strategy
 * (rotation grant, or a silent-iframe re-authentication), and scheduling the
 * next automatic refresh before the current access token expires.
 */
export class TokenRefresher {
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly silentRefreshIframeBox: { current: HTMLIFrameElement | null } = { current: null };

  constructor(private readonly deps: TokenRefresherDeps) {}

  /** Refresh using the configured strategy. */
  async refresh(): Promise<TokenResponse> {
    if (this.deps.refreshStrategy === 'silent') {
      return this.silentRefresh();
    }
    return this.rotationRefresh();
  }

  /** Refresh tokens using the rotation (refresh_token grant) strategy. */
  async rotationRefresh(): Promise<TokenResponse> {
    const refreshToken = this.deps.storage.get('refresh_token');
    if (!refreshToken) {
      throw new Error('No refresh token available');
    }

    const config = await this.deps.getOidcConfig();
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.deps.clientId,
    });

    const response = await fetch(config.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'refresh_failed' }));
      // Bug #2 fix: only discard stored tokens when the server definitively rejects
      // the refresh token (4xx — e.g. invalid_grant, token revoked). On 5xx
      // (server errors, network hiccups) the tokens may still be valid; clearing
      // them would silently log the user out due to a transient server problem.
      if (response.status >= 400 && response.status < 500) {
        this.deps.clearTokens();
      }
      throw new Error(err.error_description ?? err.error);
    }

    const tokens: TokenResponse = await response.json();
    this.finishRefresh(tokens);
    return tokens;
  }

  /**
   * Attempt silent authentication using a hidden iframe. The iframe goes
   * through the authorization flow with prompt=none, which succeeds only if
   * the user has an active session at the IdP.
   */
  async silentAuthenticate(): Promise<boolean> {
    if (typeof window === 'undefined') return false;

    try {
      await this.silentRefresh();
      return true;
    } catch {
      return false;
    }
  }

  /** Perform a silent token refresh via hidden iframe (falls back to rotation off-browser). */
  private async silentRefresh(): Promise<TokenResponse> {
    if (typeof window === 'undefined') {
      return this.rotationRefresh();
    }

    const tokens = await performSilentRefresh(this.deps, this.silentRefreshIframeBox);
    this.finishRefresh(tokens);
    return tokens;
  }

  private finishRefresh(tokens: TokenResponse): void {
    this.deps.storeTokens(tokens);
    this.scheduleRefresh();
    this.deps.events.emit('tokenRefresh', tokens);
    // Backward compatibility alias
    this.deps.events.emit('tokenRefreshed', tokens);
  }

  /** Schedule the next automatic refresh before the current access token expires. */
  scheduleRefresh(): void {
    if (!this.deps.autoRefresh) return;
    this.cancelRefreshTimer();

    const token = this.deps.storage.get('access_token');
    if (!token) return;

    try {
      const claims = parseJwt(token);
      const expiresIn = getTokenExpiresIn(claims);

      // For eager strategy, refresh even sooner (2x the buffer)
      const buffer =
        this.deps.refreshStrategy === 'eager'
          ? this.deps.refreshBuffer * EAGER_REFRESH_MULTIPLIER
          : this.deps.refreshBuffer;

      const refreshIn = Math.max(0, expiresIn - buffer) * 1000;

      this.refreshTimer = setTimeout(async () => {
        try {
          await this.refresh();
        } catch (err) {
          this.deps.events.emit('error', err instanceof Error ? err : new Error(String(err)));
        }
      }, refreshIn);
    } catch {
      // Token parse failure — don't schedule
    }
  }

  cancelRefreshTimer(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }
}
