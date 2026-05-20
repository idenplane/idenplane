import type {
  IdenplaneConfig,
  IdenplaneEventMap,
  OpenIDConfiguration,
  TokenClaims,
  TokenResponse,
  UserInfo,
} from './types.js';
import { generateCodeChallenge, generateCodeVerifier, generateState } from './pkce.js';
import { getTokenExpiresIn, isTokenExpired, parseJwt } from './token.js';
import { createStorage, type TokenStorage } from './storage.js';
import { EventEmitter } from './events.js';

const DEFAULT_SCOPES = ['openid', 'profile', 'email'];
const DEFAULT_REFRESH_BUFFER = 30; // seconds before expiry to trigger refresh
// For "eager" strategy, refresh this much earlier than the normal buffer
const EAGER_REFRESH_MULTIPLIER = 2;

/**
 * Call this function on the page that serves as the silent-refresh redirect URI.
 *
 * Bug #438-1 fix: the `silentRefresh()` iframe flow requires the redirect-URI
 * page to post an `idenplane:silent_callback` message back to the parent window.
 * Without this, the parent's `message` event listener never fires and every
 * silent refresh times out after 10 seconds.
 *
 * The redirect URI page (e.g. `/silent-callback.html`) must call this helper:
 *
 * ```html
 * <!-- public/silent-callback.html -->
 * <script type="module">
 *   import { handleSilentCallback } from '@idenplane/js';
 *   handleSilentCallback();
 * </script>
 * ```
 *
 * The function reads `code`, `state`, and `error` from the current URL's
 * search params and posts them to the parent window via `postMessage`.
 * It is a no-op outside of a browser iframe context.
 */
export function handleSilentCallback(): void {
  if (typeof window === 'undefined') return;
  // Only act when running inside an iframe
  if (window.parent === window) return;

  const params = new URL(window.location.href).searchParams;
  const code = params.get('code');
  const state = params.get('state');
  const error = params.get('error');
  const errorDescription = params.get('error_description');

  window.parent.postMessage(
    {
      type: 'idenplane:silent_callback',
      code,
      state,
      error: errorDescription ?? error,
    },
    window.location.origin,
  );
}

export class IdenplaneClient {
  private config: Required<
    Pick<IdenplaneConfig, 'url' | 'realm' | 'clientId' | 'redirectUri'>
  > & {
    scopes: string[];
    autoRefresh: boolean;
    refreshBuffer: number;
    refreshStrategy: 'silent' | 'rotation' | 'eager';
    silentRedirectUri?: string;
    postLogoutRedirectUri?: string;
    onLogin?: (tokens: TokenResponse) => void;
    onLogout?: () => void;
    onError?: (error: Error) => void;
    onTokenRefresh?: (tokens: TokenResponse) => void;
  };

  private storage: TokenStorage;
  private events = new EventEmitter<IdenplaneEventMap>();
  private oidcConfig: OpenIDConfiguration | null = null;
  // Bug #438-2 fix: the discovery document was cached forever.  If the IdP
  // returns an error (e.g. 5xx) and `oidcConfig` somehow already held a stale
  // value, that stale config would be served indefinitely.  More practically,
  // key-rotation events (IdP JWKS changes) would go undetected.
  // Fix: record the fetch timestamp and evict the cache after 1 hour so the
  // discovery document is periodically re-fetched.
  private oidcConfigFetchedAt: number | null = null;
  private static readonly DISCOVERY_TTL_MS = 60 * 60 * 1000; // 1 hour
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private cachedUserInfo: UserInfo | null = null;
  private initialized = false;
  // Bug #4 fix: guard against concurrent calls to init() (e.g. React StrictMode
  // double-mount, multiple components calling init simultaneously).
  private _initializing = false;
  private _initPromise: Promise<boolean> | null = null;
  private callbackPromise: Promise<boolean> | null = null;
  private silentRefreshIframe: HTMLIFrameElement | null = null;

  constructor(config: IdenplaneConfig) {
    this.config = {
      url: config.url.replace(/\/$/, ''),
      realm: config.realm,
      clientId: config.clientId,
      redirectUri: config.redirectUri,
      scopes: config.scopes ?? DEFAULT_SCOPES,
      autoRefresh: config.autoRefresh ?? true,
      refreshBuffer: config.refreshBuffer ?? DEFAULT_REFRESH_BUFFER,
      refreshStrategy: config.refreshStrategy ?? 'rotation',
      silentRedirectUri: config.silentRedirectUri,
      postLogoutRedirectUri: config.postLogoutRedirectUri,
      onLogin: config.onLogin,
      onLogout: config.onLogout,
      onError: config.onError,
      onTokenRefresh: config.onTokenRefresh,
    };
    // Default to in-memory storage to prevent XSS token theft.
    // sessionStorage/localStorage are accessible to any JS on the page.
    // Users can opt-in to persistent storage if they accept the risk.
    this.storage = createStorage(config.storage ?? 'memory');

    // Wire up callback-style config options to the event system
    if (config.onLogin) {
      this.events.on('login', config.onLogin);
    }
    if (config.onLogout) {
      this.events.on('logout', config.onLogout as () => void);
    }
    if (config.onError) {
      this.events.on('error', config.onError);
    }
    if (config.onTokenRefresh) {
      this.events.on('tokenRefresh', config.onTokenRefresh);
    }
  }

  // ── Initialization ──────────────────────────────────────────────

  /**
   * Initialize the client: fetch OIDC discovery document and restore any
   * existing session from storage. Must be called before other methods.
   */
  async init(): Promise<boolean> {
    // Bug #4 fix: if init() is already in flight, return the same promise so
    // concurrent callers coalesce onto a single initialization run.
    if (this._initializing && this._initPromise) return this._initPromise;
    if (this.initialized) return this.isAuthenticated();

    this._initializing = true;
    this._initPromise = this._init().finally(() => {
      this._initializing = false;
    });
    return this._initPromise;
  }

  private async _init(): Promise<boolean> {
    await this.fetchDiscovery();

    const accessToken = this.storage.get('access_token');
    if (accessToken) {
      try {
        const claims = parseJwt(accessToken);
        if (!isTokenExpired(claims)) {
          this.scheduleRefresh();
          this.initialized = true;
          this.events.emit('ready', true);
          return true;
        }
      } catch {
        // Token is malformed, try refresh
      }

      // Try to refresh if we have a refresh token
      const refreshToken = this.storage.get('refresh_token');
      if (refreshToken) {
        try {
          await this.refreshTokens();
          this.initialized = true;
          this.events.emit('ready', true);
          return true;
        } catch {
          this.clearTokens();
        }
      } else {
        this.clearTokens();
      }
    }

    // Attempt silent auth if strategy is 'silent'
    if (this.config.refreshStrategy === 'silent' && typeof window !== 'undefined') {
      try {
        const silentSuccess = await this.silentAuthenticate();
        this.initialized = true;
        this.events.emit('ready', silentSuccess);
        return silentSuccess;
      } catch {
        // Silent auth failed — user needs to login
      }
    }

    this.initialized = true;
    this.events.emit('ready', false);
    return false;
  }

  // ── Auth Flow ───────────────────────────────────────────────────

  /**
   * Redirect the user to the Idenplane login page.
   * Generates PKCE challenge and state parameter automatically.
   */
  async login(options?: { scope?: string[]; state?: string }): Promise<void> {
    if (typeof window === 'undefined') {
      throw new Error('login() is not supported in server-side environments');
    }

    const config = await this.getOidcConfig();
    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);
    const state = options?.state ?? generateState();
    const scopes = options?.scope ?? this.config.scopes;

    this.storage.set('pkce_verifier', verifier);
    this.storage.set('auth_state', state);

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: scopes.join(' '),
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });

    window.location.href = `${config.authorization_endpoint}?${params.toString()}`;
  }

  /**
   * Handle the callback after login redirect. Exchanges the authorization
   * code for tokens. Call this on your redirect URI page.
   * Returns true if tokens were obtained successfully.
   */
  async handleCallback(url?: string): Promise<boolean> {
    // Deduplicate concurrent calls (e.g. React StrictMode double-mount)
    if (this.callbackPromise) return this.callbackPromise;
    this.callbackPromise = this._handleCallback(url);
    try {
      return await this.callbackPromise;
    } finally {
      this.callbackPromise = null;
    }
  }

  private async _handleCallback(url?: string): Promise<boolean> {
    const currentUrl = url ?? (typeof window !== 'undefined' ? window.location.href : '');
    const params = new URL(currentUrl).searchParams;
    const code = params.get('code');
    const state = params.get('state');
    const error = params.get('error');

    if (error) {
      const description = params.get('error_description') ?? error;
      this.events.emit('error', new Error(description));
      return false;
    }

    if (!code) {
      return false;
    }

    // Verify state — fail-closed: reject if stored state is missing or mismatched
    const storedState = this.storage.get('auth_state');
    if (!storedState || state !== storedState) {
      this.events.emit('error', new Error('State mismatch — possible CSRF attack'));
      return false;
    }

    const verifier = this.storage.get('pkce_verifier');
    if (!verifier) {
      this.events.emit('error', new Error('Missing PKCE verifier'));
      return false;
    }

    const config = await this.getOidcConfig();
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.redirectUri,
      client_id: this.config.clientId,
      code_verifier: verifier,
    });

    const response = await fetch(config.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'token_exchange_failed' }));
      this.events.emit('error', new Error(err.error_description ?? err.error));
      return false;
    }

    const tokens: TokenResponse = await response.json();
    this.storeTokens(tokens);
    this.scheduleRefresh();

    // Clean up PKCE state
    this.storage.remove('pkce_verifier');
    this.storage.remove('auth_state');

    // Clean authorization code from URL
    if (typeof window !== 'undefined') {
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete('code');
      cleanUrl.searchParams.delete('state');
      cleanUrl.searchParams.delete('session_state');
      window.history.replaceState({}, '', cleanUrl.toString());
    }

    this.events.emit('login', tokens);
    // Backward compatibility alias
    this.events.emit('authenticated', tokens);
    return true;
  }

  /**
   * Log the user out. Clears local tokens and calls the server logout endpoint.
   */
  async logout(): Promise<void> {
    const refreshToken = this.storage.get('refresh_token');

    if (refreshToken) {
      try {
        const config = await this.getOidcConfig();
        if (config.end_session_endpoint) {
          // Bug #3 fix: OIDC end_session_endpoint expects form-urlencoded, not JSON.
          // Sending JSON causes the server to ignore the refresh_token parameter,
          // leaving the server-side session alive.
          const body = new URLSearchParams({
            client_id: this.config.clientId,
            refresh_token: refreshToken,
          });
          await fetch(config.end_session_endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
          });
        }
      } catch {
        // Best-effort server logout
      }
    }

    this.clearTokens();
    this.events.emit('logout');

    if (typeof window !== 'undefined' && this.config.postLogoutRedirectUri) {
      window.location.href = this.config.postLogoutRedirectUri;
    }
  }

  // ── Token Access ────────────────────────────────────────────────

  /**
   * Get the current access token string.
   * Returns null if not authenticated or the token is expired.
   */
  getAccessToken(): string | null {
    const token = this.storage.get('access_token');
    if (!token) return null;

    try {
      const claims = parseJwt(token);
      if (isTokenExpired(claims)) return null;
      return token;
    } catch {
      return null;
    }
  }

  /** Get the parsed claims from the current access token. */
  getTokenClaims(): TokenClaims | null {
    const token = this.storage.get('access_token');
    if (!token) return null;

    try {
      return parseJwt(token);
    } catch {
      return null;
    }
  }

  /** Get the parsed claims from the current ID token. */
  getIdTokenClaims(): TokenClaims | null {
    const token = this.storage.get('id_token');
    if (!token) return null;

    try {
      return parseJwt(token);
    } catch {
      return null;
    }
  }

  /** Check if the user is currently authenticated with a valid access token. */
  isAuthenticated(): boolean {
    return this.getAccessToken() !== null;
  }

  // ── User Info ───────────────────────────────────────────────────

  /**
   * Fetch fresh user info from the userinfo endpoint.
   * Caches the result — use getUserInfo() to retrieve cached data.
   */
  async fetchUserInfo(): Promise<UserInfo | null> {
    const token = this.getAccessToken();
    if (!token) return null;

    const config = await this.getOidcConfig();
    const response = await fetch(config.userinfo_endpoint, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) return null;

    this.cachedUserInfo = await response.json();
    return this.cachedUserInfo;
  }

  /**
   * Get user info from cached data or ID token claims.
   * Call fetchUserInfo() first for fresh server data.
   */
  getUserInfo(): UserInfo | null {
    if (this.cachedUserInfo) return this.cachedUserInfo;

    const idClaims = this.getIdTokenClaims();
    if (idClaims) {
      return {
        sub: idClaims.sub,
        preferred_username: idClaims.preferred_username,
        name: idClaims.name,
        given_name: idClaims.given_name,
        family_name: idClaims.family_name,
        email: idClaims.email,
        email_verified: idClaims.email_verified,
      };
    }

    return null;
  }

  // ── Role Helpers ────────────────────────────────────────────────

  /** Check if the user has a specific realm role. */
  hasRealmRole(role: string): boolean {
    const claims = this.getTokenClaims();
    return claims?.realm_access?.roles?.includes(role) ?? false;
  }

  /** Check if the user has a specific client role. */
  hasClientRole(clientId: string, role: string): boolean {
    const claims = this.getTokenClaims();
    return claims?.resource_access?.[clientId]?.roles?.includes(role) ?? false;
  }

  /** Get all realm roles for the current user. */
  getRealmRoles(): string[] {
    const claims = this.getTokenClaims();
    return claims?.realm_access?.roles ?? [];
  }

  /** Get all client roles for a specific client. */
  getClientRoles(clientId: string): string[] {
    const claims = this.getTokenClaims();
    return claims?.resource_access?.[clientId]?.roles ?? [];
  }

  /**
   * Check if the user has a specific permission.
   * Checks both realm roles and client roles for the configured clientId.
   */
  hasPermission(permission: string): boolean {
    return this.hasRealmRole(permission) || this.hasClientRole(this.config.clientId, permission);
  }

  // ── Token Refresh ───────────────────────────────────────────────

  /**
   * Manually refresh the access token using the refresh token.
   * This is called automatically when autoRefresh is enabled.
   */
  async refreshTokens(): Promise<TokenResponse> {
    const strategy = this.config.refreshStrategy;

    if (strategy === 'silent') {
      return this.silentRefresh();
    }

    return this.rotationRefresh();
  }

  /**
   * Refresh tokens using the rotation (refresh_token grant) strategy.
   */
  private async rotationRefresh(): Promise<TokenResponse> {
    const refreshToken = this.storage.get('refresh_token');
    if (!refreshToken) {
      throw new Error('No refresh token available');
    }

    const config = await this.getOidcConfig();
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.config.clientId,
    });

    const response = await fetch(config.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'refresh_failed' }));
      // Bug #2 fix: only discard stored tokens when the server definitively rejects
      // the refresh token (4xx — e.g. invalid_grant, token revoked).  On 5xx
      // (server errors, network hiccups) the tokens may still be valid; clearing
      // them would silently log the user out due to a transient server problem.
      if (response.status >= 400 && response.status < 500) {
        this.clearTokens();
      }
      throw new Error(err.error_description ?? err.error);
    }

    const tokens: TokenResponse = await response.json();
    this.storeTokens(tokens);
    this.scheduleRefresh();
    this.events.emit('tokenRefresh', tokens);
    // Backward compatibility alias
    this.events.emit('tokenRefreshed', tokens);
    return tokens;
  }

  /**
   * Attempt silent authentication using a hidden iframe.
   * The iframe will go through the authorization flow with prompt=none,
   * which succeeds only if the user has an active session at the IdP.
   */
  private async silentAuthenticate(): Promise<boolean> {
    if (typeof window === 'undefined') return false;

    try {
      const tokens = await this.silentRefresh();
      return !!tokens;
    } catch {
      return false;
    }
  }

  /**
   * Perform a silent token refresh via hidden iframe.
   * Requires the server to support prompt=none and check_session_iframe.
   */
  private silentRefresh(): Promise<TokenResponse> {
    // Fall back to rotation if not in a browser environment or no session endpoint
    if (typeof window === 'undefined') {
      return this.rotationRefresh();
    }

    return this._silentRefreshAsync();
  }

  private async _silentRefreshAsync(): Promise<TokenResponse> {
    const oidcConfig = await this.getOidcConfig();
    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);
    const state = generateState();
    const nonce = generateState();

    // Store PKCE state for callback
    this.storage.set('silent_pkce_verifier', verifier);
    this.storage.set('silent_auth_state', state);

    // Resolve the redirect URI for the silent-refresh iframe.  A dedicated
    // silentRedirectUri (pointing at a page that calls handleSilentCallback)
    // is strongly recommended.  Falling back to the main redirectUri works
    // only if that page also posts the idenplane:silent_callback message.
    let silentRedirectUri: string;
    if (this.config.silentRedirectUri) {
      silentRedirectUri = this.config.silentRedirectUri;
    } else {
      console.warn(
        '[idenplane] silentRedirectUri is not set. ' +
          'Falling back to redirectUri for the silent-refresh iframe. ' +
          'Set silentRedirectUri to a dedicated page that calls handleSilentCallback().',
      );
      silentRedirectUri = this.config.redirectUri;
    }

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: silentRedirectUri,
      scope: this.config.scopes.join(' '),
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      prompt: 'none',
    });

    const authUrl = `${oidcConfig.authorization_endpoint}?${params.toString()}`;

    // Remove old iframe if present
    if (this.silentRefreshIframe) {
      document.body.removeChild(this.silentRefreshIframe);
      this.silentRefreshIframe = null;
    }

    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.style.width = '0';
    iframe.style.height = '0';
    this.silentRefreshIframe = iframe;

    return new Promise<TokenResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Silent refresh timed out'));
      }, 10000);

      const onMessage = async (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;
        if (!event.data?.type || event.data.type !== 'idenplane:silent_callback') return;

        cleanup();

        const { code, state: returnedState, error } = event.data;

        if (error) {
          reject(new Error(error));
          return;
        }

        const storedState = this.storage.get('silent_auth_state');
        if (!storedState || returnedState !== storedState) {
          reject(new Error('Silent refresh state mismatch'));
          return;
        }

        const storedVerifier = this.storage.get('silent_pkce_verifier');
        if (!storedVerifier || !code) {
          reject(new Error('Missing silent refresh PKCE data'));
          return;
        }

        this.storage.remove('silent_pkce_verifier');
        this.storage.remove('silent_auth_state');

        try {
          const body = new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: silentRedirectUri,
            client_id: this.config.clientId,
            code_verifier: storedVerifier,
          });

          const response = await fetch(oidcConfig.token_endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
          });

          if (!response.ok) {
            const err = await response.json().catch(() => ({ error: 'silent_refresh_failed' }));
            reject(new Error(err.error_description ?? err.error));
            return;
          }

          const tokens: TokenResponse = await response.json();
          this.storeTokens(tokens);
          this.scheduleRefresh();
          this.events.emit('tokenRefresh', tokens);
          this.events.emit('tokenRefreshed', tokens);
          resolve(tokens);
        } catch (err) {
          reject(err);
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        window.removeEventListener('message', onMessage);
        if (this.silentRefreshIframe) {
          try {
            document.body.removeChild(this.silentRefreshIframe);
          } catch {
            // Ignore
          }
          this.silentRefreshIframe = null;
        }
      };

      window.addEventListener('message', onMessage);
      document.body.appendChild(iframe);
      iframe.src = authUrl;
    });
  }

  // ── Events ──────────────────────────────────────────────────────

  /** Subscribe to an event. Returns an unsubscribe function. */
  on<K extends keyof IdenplaneEventMap>(
    event: K,
    handler: IdenplaneEventMap[K] extends void ? () => void : (data: IdenplaneEventMap[K]) => void,
  ): () => void {
    this.events.on(event, handler);
    return () => this.events.off(event, handler);
  }

  /** Unsubscribe from an event. */
  off<K extends keyof IdenplaneEventMap>(
    event: K,
    handler: IdenplaneEventMap[K] extends void ? () => void : (data: IdenplaneEventMap[K]) => void,
  ): void {
    this.events.off(event, handler);
  }

  // ── Public Helpers ──────────────────────────────────────────────────────

  /**
   * Returns a snapshot of the client's current configuration.
   * Useful for SDK extensions that need the base URL and realm.
   */
  getConfig(): Readonly<{
    url: string;
    realm: string;
    clientId: string;
    redirectUri: string;
    scopes: string[];
    autoRefresh: boolean;
    refreshBuffer: number;
    refreshStrategy: 'silent' | 'rotation' | 'eager';
    silentRedirectUri?: string;
    postLogoutRedirectUri?: string;
  }> {
    return {
      url: this.config.url,
      realm: this.config.realm,
      clientId: this.config.clientId,
      redirectUri: this.config.redirectUri,
      scopes: this.config.scopes,
      autoRefresh: this.config.autoRefresh,
      refreshBuffer: this.config.refreshBuffer,
      refreshStrategy: this.config.refreshStrategy,
      silentRedirectUri: this.config.silentRedirectUri,
      postLogoutRedirectUri: this.config.postLogoutRedirectUri,
    };
  }

  // ── Internal ────────────────────────────────────────────────────

  private async fetchDiscovery(): Promise<void> {
    // SSR-safe: skip if no fetch available (edge case)
    const url = `${this.config.url}/realms/${this.config.realm}/.well-known/openid-configuration`;
    const response = await fetch(url);
    if (!response.ok) {
      // On error, evict any stale cached config so the next call retries.
      this.oidcConfig = null;
      this.oidcConfigFetchedAt = null;
      throw new Error(`Failed to fetch OIDC discovery document from ${url}`);
    }
    this.oidcConfig = await response.json();
    this.oidcConfigFetchedAt = Date.now();
  }

  private async getOidcConfig(): Promise<OpenIDConfiguration> {
    const now = Date.now();
    const isExpired =
      this.oidcConfigFetchedAt === null ||
      now - this.oidcConfigFetchedAt > IdenplaneClient.DISCOVERY_TTL_MS;

    if (!this.oidcConfig || isExpired) {
      await this.fetchDiscovery();
    }
    return this.oidcConfig!;
  }

  private storeTokens(tokens: TokenResponse): void {
    this.storage.set('access_token', tokens.access_token);
    if (tokens.refresh_token) {
      this.storage.set('refresh_token', tokens.refresh_token);
    }
    if (tokens.id_token) {
      this.storage.set('id_token', tokens.id_token);
    }
    // Clear cached user info so it's re-fetched with new token
    this.cachedUserInfo = null;
  }

  private clearTokens(): void {
    this.cancelRefreshTimer();
    this.storage.clear();
    this.cachedUserInfo = null;
  }

  private scheduleRefresh(): void {
    if (!this.config.autoRefresh) return;
    this.cancelRefreshTimer();

    const token = this.storage.get('access_token');
    if (!token) return;

    try {
      const claims = parseJwt(token);
      const expiresIn = getTokenExpiresIn(claims);

      // For eager strategy, refresh even sooner (2x the buffer)
      const buffer =
        this.config.refreshStrategy === 'eager'
          ? this.config.refreshBuffer * EAGER_REFRESH_MULTIPLIER
          : this.config.refreshBuffer;

      const refreshIn = Math.max(0, expiresIn - buffer) * 1000;

      this.refreshTimer = setTimeout(async () => {
        try {
          await this.refreshTokens();
        } catch (err) {
          this.events.emit('error', err instanceof Error ? err : new Error(String(err)));
        }
      }, refreshIn);
    } catch {
      // Token parse failure — don't schedule
    }
  }

  private cancelRefreshTimer(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }
}
