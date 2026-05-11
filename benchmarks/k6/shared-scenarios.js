/**
 * Shared scenarios and utilities for Authme OAuth k6 load tests.
 *
 * This module provides common functionality shared across all OAuth flow test scripts:
 * - Custom metrics (error rates, trends)
 * - Response checking helpers
 * - Token storage management
 * - Common configuration
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend, Gauge, Counter } from 'k6/metrics';

// ─── Custom Metrics ────────────────────────────────────────────────────────────

/** Error rate metric for tracking failed requests */
export const errorRate = new Rate('oauth_errors');

/** Token issuance duration trend */
export const tokenIssuanceDuration = new Trend('token_issuance_duration');

/** Introspection duration trend */
export const introspectionDuration = new Trend('introspection_duration');

/** Userinfo endpoint duration trend */
export const userinfoDuration = new Trend('userinfo_duration');

/** Active tokens gauge (tracks current valid tokens) */
export const activeTokensGauge = new Gauge('active_tokens_count');

/** Token refresh counter */
export const tokenRefreshCounter = new Counter('token_refresh_total');

/** Token validation errors counter */
export const tokenValidationErrors = new Counter('token_validation_errors');

// ─── Configuration ─────────────────────────────────────────────────────────────

/** Default target URL - override with TARGET_URL env var */
export const DEFAULT_TARGET_URL = __ENV.TARGET_URL || 'http://localhost:3000';

/** Default realm for tests - override with REALM_NAME env var */
export const DEFAULT_REALM = __ENV.REALM_NAME || 'test-realm';

/** Virtual users - override with VUS env var */
export const DEFAULT_VUS = parseInt(__ENV.VUS || '50', 10);

/** Test duration - override with DURATION env var */
export const DEFAULT_DURATION = __ENV.DURATION || '60s';

/** Ramp-up time - override with RAMP_UP env var */
export const DEFAULT_RAMP_UP = __ENV.RAMP_UP || '10s';

/** Admin API key - override with ADMIN_API_KEY env var */
export const ADMIN_API_KEY = __ENV.ADMIN_API_KEY || '';

/** Test client credentials */
export const TEST_CLIENT_ID = __ENV.TEST_CLIENT_ID || 'test-client';
export const TEST_CLIENT_SECRET = __ENV.TEST_CLIENT_SECRET || 'test-client-secret';

/** Test user credentials */
export const TEST_USERNAME = __ENV.TEST_USERNAME || 'testuser';
export const TEST_PASSWORD = __ENV.TEST_PASSWORD || 'TestPassword123!';

// ─── URL Helpers ───────────────────────────────────────────────────────────────

/**
 * Build OAuth endpoint URLs for a given realm.
 * @param {string} realmName - The realm name
 * @param {string} baseUrl - The base URL of the Authme server
 * @returns {Object} Object containing all OAuth endpoint URLs
 */
export function buildOAuthUrls(realmName = DEFAULT_REALM, baseUrl = DEFAULT_TARGET_URL) {
  const realmPath = `/realms/${realmName}/protocol/openid-connect`;
  return {
    token: `${baseUrl}${realmPath}/token`,
    tokenIntrospect: `${baseUrl}${realmPath}/token/introspect`,
    tokenRevoke: `${baseUrl}${realmPath}/token/revoke`,
    userinfo: `${baseUrl}${realmPath}/userinfo`,
    authorize: `${baseUrl}${realmPath}/authorize`,
    logout: `${baseUrl}${realmPath}/logout`,
    jwks: `${baseUrl}${realmPath}/jwk`,
    wellKnown: `${baseUrl}${realmPath}/.well-known/openid-configuration`,
  };
}

// ─── Token Storage ─────────────────────────────────────────────────────────────

/**
 * Shared token state for simulating realistic token lifecycle.
 * Uses a simple in-memory Map keyed by VU ID.
 */
class TokenStore {
  constructor() {
    this.tokens = new Map();
  }

  /**
   * Store a token for a VU
   * @param {string} vuId - Virtual user identifier
   * @param {Object} tokenData - Token data to store
   */
  set(vuId, tokenData) {
    this.tokens.set(vuId, {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + (tokenData.expires_in || 300) * 1000,
      clientId: tokenData.client_id || TEST_CLIENT_ID,
    });
    activeTokensGauge.add(this.tokens.size);
  }

  /**
   * Get a token for a VU
   * @param {string} vuId - Virtual user identifier
   * @returns {Object|null} Token data or null if not found/expired
   */
  get(vuId) {
    const token = this.tokens.get(vuId);
    if (!token) return null;

    // Check if token is expired (with 30 second buffer)
    if (Date.now() > token.expiresAt - 30000) {
      this.tokens.delete(vuId);
      return null;
    }

    return token;
  }

  /**
   * Get a valid access token for a VU, refreshing if necessary
   * @param {string} vuId - Virtual user identifier
   * @returns {string|null} Access token or null
   */
  getValidToken(vuId) {
    const token = this.get(vuId);
    return token ? token.accessToken : null;
  }

  /**
   * Delete a token for a VU
   * @param {string} vuId - Virtual user identifier
   */
  delete(vuId) {
    this.tokens.delete(vuId);
    activeTokensGauge.add(this.tokens.size);
  }

  /**
   * Clear all tokens
   */
  clear() {
    this.tokens.clear();
    activeTokensGauge.add(0);
  }

  /**
   * Get current token count
   * @returns {number} Number of stored tokens
   */
  size() {
    return this.tokens.size;
  }
}

/** Global token store instance */
export const tokenStore = new TokenStore();

// ─── Response Helpers ─────────────────────────────────────────────────────────

/**
 * Content-Type for form data (OAuth standard)
 */
export const FORM_HEADERS = {
  'Content-Type': 'application/x-www-form-urlencoded',
};

/**
 * Content-Type for JSON data
 */
export const JSON_HEADERS = {
  'Content-Type': 'application/json',
};

/**
 * Get Authorization headers with Bearer token
 * @param {string} accessToken - The access token
 * @returns {Object} Headers object with Authorization header
 */
export function getBearerHeaders(accessToken) {
  return {
    'Authorization': `Bearer ${accessToken}`,
  };
}

/**
 * Get admin API key headers
 * @returns {Object} Headers object with API key
 */
export function getAdminHeaders() {
  const headers = { ...JSON_HEADERS };
  if (ADMIN_API_KEY) {
    headers['X-API-Key'] = ADMIN_API_KEY;
  }
  return headers;
}

/**
 * Check and handle HTTP response, tracking errors and metrics.
 * @param {Object} res - k6 HTTP response object
 * @param {string} context - Context label for metrics
 * @param {Object} tags - Additional tags for metrics
 * @returns {boolean} True if response was successful (2xx)
 */
export function checkResponse(res, context = '', tags = {}) {
  const success = res.status >= 200 && res.status < 400;

  if (!success) {
    errorRate.add(1, { context, status: res.status, ...tags });
    tokenValidationErrors.add(1, { context, status: res.status });
  } else {
    errorRate.add(0, { context, ...tags });
  }

  check(res, {
    [`${context}: status is 2xx`]: () => success,
    [`${context}: response time < 500ms`]: () => res.timings.duration < 500,
  });

  return success;
}

/**
 * Parse form-encoded response body.
 * @param {string} body - Response body string
 * @returns {Object} Parsed key-value object
 */
export function parseFormBody(body) {
  const params = new URLSearchParams(body);
  const result = {};
  for (const [key, value] of params) {
    result[key] = value;
  }
  return result;
}

// ─── OAuth Operations ─────────────────────────────────────────────────────────

/**
 * Request a new token using password grant.
 * @param {string} tokenUrl - Token endpoint URL
 * @param {string} vuId - Virtual user identifier
 * @param {Object} options - Additional options (scope, client_id, etc.)
 * @returns {Object|null} Token response or null on failure
 */
export function requestPasswordToken(tokenUrl, vuId, options = {}) {
  const params = new URLSearchParams({
    grant_type: 'password',
    client_id: options.client_id || TEST_CLIENT_ID,
    client_secret: options.client_secret || TEST_CLIENT_SECRET,
    username: options.username || TEST_USERNAME,
    password: options.password || TEST_PASSWORD,
    scope: options.scope || 'openid',
  });

  const startTime = Date.now();
  const res = http.post(tokenUrl, params.toString(), {
    headers: FORM_HEADERS,
    tags: { operation: 'password_grant', vu_id: vuId },
  });

  tokenIssuanceDuration.add(Date.now() - startTime);

  if (checkResponse(res, 'password_grant', { vu_id: vuId })) {
    const body = JSON.parse(res.body);
    tokenStore.set(vuId, {
      access_token: body.access_token,
      refresh_token: body.refresh_token,
      expires_in: body.expires_in,
      client_id: options.client_id || TEST_CLIENT_ID,
    });
    return body;
  }

  return null;
}

/**
 * Request a new token using client credentials grant.
 * @param {string} tokenUrl - Token endpoint URL
 * @param {string} vuId - Virtual user identifier
 * @param {Object} options - Additional options
 * @returns {Object|null} Token response or null on failure
 */
export function requestClientCredentialsToken(tokenUrl, vuId, options = {}) {
  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: options.client_id || TEST_CLIENT_ID,
    client_secret: options.client_secret || TEST_CLIENT_SECRET,
    scope: options.scope || 'openid',
  });

  const startTime = Date.now();
  const res = http.post(tokenUrl, params.toString(), {
    headers: FORM_HEADERS,
    tags: { operation: 'client_credentials', vu_id: vuId },
  });

  tokenIssuanceDuration.add(Date.now() - startTime);

  if (checkResponse(res, 'client_credentials_grant', { vu_id: vuId })) {
    const body = JSON.parse(res.body);
    tokenStore.set(vuId, {
      access_token: body.access_token,
      refresh_token: null,
      expires_in: body.expires_in,
      client_id: options.client_id || TEST_CLIENT_ID,
    });
    return body;
  }

  return null;
}

/**
 * Refresh an access token using a refresh token.
 * @param {string} tokenUrl - Token endpoint URL
 * @param {string} vuId - Virtual user identifier
 * @param {string} refreshToken - The refresh token
 * @returns {Object|null} Token response or null on failure
 */
export function refreshToken(tokenUrl, vuId, refreshToken) {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: TEST_CLIENT_ID,
    client_secret: TEST_CLIENT_SECRET,
  });

  const startTime = Date.now();
  const res = http.post(tokenUrl, params.toString(), {
    headers: FORM_HEADERS,
    tags: { operation: 'refresh_token', vu_id: vuId },
  });

  tokenIssuanceDuration.add(Date.now() - startTime);

  if (checkResponse(res, 'refresh_token_grant', { vu_id: vuId })) {
    const body = JSON.parse(res.body);
    tokenStore.set(vuId, {
      access_token: body.access_token,
      refresh_token: body.refresh_token,
      expires_in: body.expires_in,
      client_id: TEST_CLIENT_ID,
    });
    tokenRefreshCounter.add(1, { vu_id: vuId });
    return body;
  }

  return null;
}

/**
 * Introspect a token to check its validity.
 * @param {string} introspectUrl - Introspection endpoint URL
 * @param {string} token - The token to introspect
 * @param {string} context - Context label for metrics
 * @returns {Object|null} Introspection response or null on failure
 */
export function introspectToken(introspectUrl, token, context = 'introspection') {
  const params = new URLSearchParams({
    token: token,
    client_id: TEST_CLIENT_ID,
    client_secret: TEST_CLIENT_SECRET,
  });

  const startTime = Date.now();
  const res = http.post(introspectUrl, params.toString(), {
    headers: FORM_HEADERS,
    tags: { operation: 'token_introspection' },
  });

  introspectionDuration.add(Date.now() - startTime);

  if (checkResponse(res, context)) {
    return JSON.parse(res.body);
  }

  return null;
}

/**
 * Call the userinfo endpoint with an access token.
 * @param {string} userinfoUrl - Userinfo endpoint URL
 * @param {string} accessToken - The access token
 * @param {string} context - Context label for metrics
 * @returns {Object|null} Userinfo response or null on failure
 */
export function callUserinfo(userinfoUrl, accessToken, context = 'userinfo') {
  const startTime = Date.now();
  const res = http.get(userinfoUrl, {
    headers: getBearerHeaders(accessToken),
    tags: { operation: 'userinfo' },
  });

  userinfoDuration.add(Date.now() - startTime);

  if (checkResponse(res, context)) {
    return JSON.parse(res.body);
  }

  return null;
}

/**
 * Get a valid token for a VU, refreshing if expired.
 * @param {string} tokenUrl - Token endpoint URL
 * @param {string} vuId - Virtual user identifier
 * @param {Object} refreshData - Token data with refresh_token if available
 * @returns {Object|null} Token response or null on failure
 */
export function getOrRefreshToken(tokenUrl, vuId, refreshData) {
  const token = tokenStore.get(vuId);

  // If we have a valid token, return it directly
  if (token) {
    return {
      access_token: token.accessToken,
      refresh_token: token.refreshToken,
      expires_at: token.expiresAt,
    };
  }

  // If we have refresh data, try to refresh
  if (refreshData && refreshData.refresh_token) {
    const refreshed = refreshToken(tokenUrl, vuId, refreshData.refresh_token);
    if (refreshed) return refreshed;
  }

  // Otherwise, request a new password token
  return requestPasswordToken(tokenUrl, vuId);
}

/**
 * Revoke a token and clean up from token store.
 * @param {string} revokeUrl - Revocation endpoint URL
 * @param {string} vuId - Virtual user identifier
 * @param {string} token - The token to revoke
 * @param {string} context - Context label for metrics
 * @returns {boolean} True if successful
 */
export function revokeToken(revokeUrl, token, context = 'token_revoke') {
  const params = new URLSearchParams({
    token: token,
    client_id: TEST_CLIENT_ID,
    client_secret: TEST_CLIENT_SECRET,
  });

  const res = http.post(revokeUrl, params.toString(), {
    headers: FORM_HEADERS,
    tags: { operation: 'token_revoke' },
  });

  return checkResponse(res, context);
}

// ─── Default k6 Options ───────────────────────────────────────────────────────

/**
 * Standard k6 options for OAuth load tests.
 * Can be merged with additional thresholds or stages as needed.
 */
export const defaultOptions = {
  stages: [
    { duration: DEFAULT_RAMP_UP, target: DEFAULT_VUS },
    { duration: DEFAULT_DURATION, target: DEFAULT_VUS },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    'http_req_duration': ['p(95)<500', 'p(99)<1000'],
    'http_req_failed': ['rate<0.05'],
    'oauth_errors': ['rate<0.1'],
    'token_issuance_duration': ['p(95)<300'],
    'introspection_duration': ['p(95)<200'],
    'userinfo_duration': ['p(95)<200'],
  },
  summaryTimeUnit: 'ms',
};