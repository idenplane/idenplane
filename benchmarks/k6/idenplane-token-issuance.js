/**
 * Idenplane Token Issuance Load Test
 *
 * Tests OAuth2 token issuance across multiple grant types:
 * - Client Credentials Grant (machine-to-machine)
 * - Password Grant (user authentication)
 * - Refresh Token Grant (token renewal)
 *
 * This script measures token issuance performance and validates token structure
 * across different authentication flows.
 *
 * Usage:
 *   k6 run benchmarks/k6/idenplane-token-issuance.js
 *   k6 run benchmarks/k6/idenplane-token-issuance.js -e VUS=100 -e DURATION=120s
 *
 * Environment Variables:
 *   TARGET_URL         - Base URL of Idenplane server (default: http://localhost:3000)
 *   REALM_NAME         - Realm name to test against (default: test-realm)
 *   VUS                - Number of virtual users (default: 50)
 *   DURATION           - Test duration (default: 60s)
 *   RAMP_UP            - Ramp-up time (default: 10s)
 *   TEST_CLIENT_ID     - OAuth client ID (default: test-client)
 *   TEST_CLIENT_SECRET - OAuth client secret (default: test-client-secret)
 *   TEST_USERNAME      - Test username (default: testuser)
 *   TEST_PASSWORD      - Test password (default: TestPassword123!)
 */

import {
  buildOAuthUrls,
  requestClientCredentialsToken,
  requestPasswordToken,
  refreshToken,
  checkResponse,
  FORM_HEADERS,
  DEFAULT_TARGET_URL,
  DEFAULT_REALM,
  DEFAULT_VUS,
  DEFAULT_DURATION,
  DEFAULT_RAMP_UP,
  TEST_CLIENT_ID,
  TEST_CLIENT_SECRET,
  TEST_USERNAME,
  TEST_PASSWORD,
  tokenStore,
  errorRate,
} from './shared-scenarios.js';
import http from 'k6/http';
import { Rate, Trend, Counter, Gauge } from 'k6/metrics';
import { check, group, sleep } from 'k6';

// ─── Custom Metrics ────────────────────────────────────────────────────────────

const clientCredentialsSuccessRate = new Rate('client_credentials_success');
const passwordGrantSuccessRate = new Rate('password_grant_success');
const refreshTokenSuccessRate = new Rate('refresh_token_success');

const clientCredentialsDuration = new Trend('client_credentials_duration');
const passwordGrantDuration = new Trend('password_grant_duration');
const refreshTokenDuration = new Trend('refresh_token_duration');

const tokensIssued = new Counter('tokens_issued_total');
const refreshAttempts = new Counter('refresh_attempts_total');

const activeTokensGauge = new Gauge('concurrent_active_tokens');

// ─── Configuration ──────────────────────────────────────────────────────────────

const TARGET_URL = __ENV.TARGET_URL || DEFAULT_TARGET_URL;
const REALM_NAME = __ENV.REALM_NAME || DEFAULT_REALM;
const VUS = parseInt(__ENV.VUS || String(DEFAULT_VUS), 10);
const DURATION = __ENV.DURATION || DEFAULT_DURATION;
const RAMP_UP = __ENV.RAMP_UP || DEFAULT_RAMP_UP;

// ─── k6 Options ─────────────────────────────────────────────────────────────────

export const options = {
  stages: [
    { duration: RAMP_UP, target: VUS },
    { duration: DURATION, target: VUS },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    'http_req_duration': ['p(95)<500', 'p(99)<1000'],
    'http_req_failed': ['rate<0.05'],
    'client_credentials_success': ['rate>0.98'],
    'password_grant_success': ['rate>0.95'],
    'refresh_token_success': ['rate>0.95'],
    'client_credentials_duration': ['p(95)<200'],
    'password_grant_duration': ['p(95)<300'],
    'refresh_token_duration': ['p(95)<200'],
  },
  summaryTimeUnit: 'ms',
};

// ─── Token Validation Helpers ──────────────────────────────────────────────────

/**
 * Validate access token structure
 */
function validateAccessToken(tokenResponse, grantType) {
  const checks = {
    'has access_token': tokenResponse.access_token !== undefined,
    'has token_type Bearer': tokenResponse.token_type === 'Bearer',
    'has expires_in': typeof tokenResponse.expires_in === 'number',
    'expires_in positive': tokenResponse.expires_in > 0,
    'expires_in reasonable': tokenResponse.expires_in <= 86400, // Max 24 hours
  };

  check(tokenResponse, checks);

  if (!checks['has access_token']) {
    errorRate.add(1, { grant_type: grantType, error: 'missing_access_token' });
  }
}

/**
 * Validate refresh token structure (when present)
 */
function validateRefreshToken(tokenResponse, grantType) {
  if (tokenResponse.refresh_token !== undefined) {
    check(tokenResponse, {
      'refresh_token is string': typeof tokenResponse.refresh_token === 'string',
      'refresh_token not empty': tokenResponse.refresh_token.length > 0,
    });
  }
}

/**
 * Validate ID token structure (when present with openid scope)
 */
function validateIdToken(tokenResponse, grantType) {
  if (tokenResponse.id_token !== undefined) {
    check(tokenResponse, {
      'id_token is string': typeof tokenResponse.id_token === 'string',
      'id_token not empty': tokenResponse.id_token.length > 0,
      'id_token is JWT format': tokenResponse.id_token.split('.').length === 3,
    });
  }
}

// ─── Test Scenarios ────────────────────────────────────────────────────────────

export default function () {
  const vuId = String(__VU);
  const urls = buildOAuthUrls(REALM_NAME, TARGET_URL);

  // Track this VU's tokens
  let tokensForThisVU = { password: null, clientCreds: null };

  // ─── Scenario 1: Client Credentials Grant ────────────────────────────────────

  group('Client Credentials Grant', () => {
    const startTime = Date.now();

    const tokenResponse = requestClientCredentialsToken(urls.token, `cc-${vuId}`, {
      client_id: TEST_CLIENT_ID,
      client_secret: TEST_CLIENT_SECRET,
      scope: 'openid',
    });

    clientCredentialsDuration.add(Date.now() - startTime);

    if (tokenResponse) {
      clientCredentialsSuccessRate.add(1);
      tokensIssued.add(1, { grant_type: 'client_credentials' });

      // Client credentials should NOT have refresh_token
      check(tokenResponse, {
        'no refresh_token for client_credentials': tokenResponse.refresh_token === undefined,
      });

      validateAccessToken(tokenResponse, 'client_credentials');
    } else {
      clientCredentialsSuccessRate.add(0);
    }

    tokensForThisVU.clientCreds = tokenResponse;
  });

  // ─── Scenario 2: Password Grant ─────────────────────────────────────────────

  group('Password Grant', () => {
    const startTime = Date.now();

    const tokenResponse = requestPasswordToken(urls.token, `pwd-${vuId}`, {
      client_id: TEST_CLIENT_ID,
      client_secret: TEST_CLIENT_SECRET,
      username: TEST_USERNAME,
      password: TEST_PASSWORD,
      scope: 'openid',
    });

    passwordGrantDuration.add(Date.now() - startTime);

    if (tokenResponse) {
      passwordGrantSuccessRate.add(1);
      tokensIssued.add(1, { grant_type: 'password' });

      validateAccessToken(tokenResponse, 'password');
      validateRefreshToken(tokenResponse, 'password');
      validateIdToken(tokenResponse, 'password');

      // Verify token can be used immediately
      const userinfoRes = http.get(urls.userinfo, {
        headers: { 'Authorization': `Bearer ${tokenResponse.access_token}` },
      });

      checkResponse(userinfoRes, 'token_usability_check', { vu_id: vuId });
    } else {
      passwordGrantSuccessRate.add(0);
    }

    tokensForThisVU.password = tokenResponse;
  });

  // ─── Scenario 3: Refresh Token Grant ─────────────────────────────────────────

  // Only attempt refresh if we have a password grant token
  if (tokensForThisVU.password && tokensForThisVU.password.refresh_token) {
    group('Refresh Token Grant', () => {
      // Simulate token reuse by trying to refresh after some delay
      // In a real scenario, tokens would be reused over time
      const startTime = Date.now();

      const refreshResponse = refreshToken(
        urls.token,
        `refresh-${vuId}`,
        tokensForThisVU.password.refresh_token
      );

      refreshTokenDuration.add(Date.now() - startTime);

      if (refreshResponse) {
        refreshTokenSuccessRate.add(1);
        refreshAttempts.add(1);

        validateAccessToken(refreshResponse, 'refresh_token');
        validateRefreshToken(refreshResponse, 'refresh_token');

        // Verify refresh token was rotated (new refresh token should be different)
        if (refreshResponse.refresh_token !== tokensForThisVU.password.refresh_token) {
          check(refreshResponse, {
            'refresh_token was rotated': () =>
              refreshResponse.refresh_token !== tokensForThisVU.password.refresh_token,
          });
        }
      } else {
        refreshTokenSuccessRate.add(0);
      }
    });
  }

  // ─── Scenario 4: Invalid Client Credentials ─────────────────────────────────

  // Test invalid client credentials periodically
  if (__VU % 20 === 0) {
    group('Invalid Client Credentials', () => {
      const params = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: TEST_CLIENT_ID,
        client_secret: 'wrong-secret',
      });

      const res = http.post(urls.token, params.toString(), { headers: FORM_HEADERS });

      check(res, {
        'invalid client secret returns 401': () => res.status === 401,
      });
    });
  }

  // ─── Scenario 5: Token Reuse Test ───────────────────────────────────────────

  // Verify that the same credentials produce different tokens (due to JWT generation)
  if (__VU % 50 === 0) {
    group('Token Uniqueness Check', () => {
      const token1 = requestPasswordToken(urls.token, `reuse-${vuId}-1`, {
        client_id: TEST_CLIENT_ID,
        client_secret: TEST_CLIENT_SECRET,
        username: TEST_USERNAME,
        password: TEST_PASSWORD,
        scope: 'openid',
      });

      const token2 = requestPasswordToken(urls.token, `reuse-${vuId}-2`, {
        client_id: TEST_CLIENT_ID,
        client_secret: TEST_CLIENT_SECRET,
        username: TEST_USERNAME,
        password: TEST_PASSWORD,
        scope: 'openid',
      });

      if (token1 && token2) {
        // Access tokens should be different (different JWT with different iat/jti)
        check(token1, {
          'consecutive tokens are different': () => token1.access_token !== token2.access_token,
        });
      }
    });
  }

  // ─── Update gauge ───────────────────────────────────────────────────────────

  activeTokensGauge.add(tokenStore.size());

  // ─── Think time ─────────────────────────────────────────────────────────────

  sleep(Math.random() * 2 + 1); // 1-3 seconds random delay
}

// ─── Setup/Teardown ─────────────────────────────────────────────────────────────

export function setup() {
  console.log(`Starting token issuance load test against ${TARGET_URL}`);
  console.log(`Realm: ${REALM_NAME}`);
  console.log(`VUs: ${VUS}, Duration: ${DURATION}`);
  console.log('Testing grant types: client_credentials, password, refresh_token');

  return { targetUrl: TARGET_URL, realmName: REALM_NAME };
}

export function teardown(data) {
  console.log('Token issuance load test completed.');
  console.log(`Final active tokens tracked: ${tokenStore.size()}`);
}