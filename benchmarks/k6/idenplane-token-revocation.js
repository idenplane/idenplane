/**
 * Idenplane Token Revocation Load Test
 *
 * Tests the OAuth2 token revocation endpoint which allows clients to revoke
 * access tokens and refresh tokens. This script simulates users logging out
 * and revoking their tokens.
 *
 * Usage:
 *   k6 run benchmarks/k6/idenplane-token-revocation.js
 *   k6 run benchmarks/k6/idenplane-token-revocation.js -e TARGET_URL=http://localhost:3000 -e REALM_NAME=my-realm
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

import { Rate, Trend, Counter, Gauge } from 'k6/metrics';
import {
  buildOAuthUrls,
  requestPasswordToken,
  revokeToken,
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
import { check, group, sleep } from 'k6';

// ─── Custom Metrics ────────────────────────────────────────────────────────────

const revocationSuccessRate = new Rate('revocation_success_rate');
const revocationDuration = new Trend('revocation_duration');
const revocationAttempts = new Counter('revocation_attempts');
const tokenRevokedCount = new Counter('token_revoked_count');
const tokensInCirculation = new Gauge('tokens_in_circulation');

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
    'revocation_success_rate': ['rate>0.95'],
    'revocation_duration': ['p(95)<300'],
  },
  summaryTimeUnit: 'ms',
};

// ─── Test Scenarios ────────────────────────────────────────────────────────────

export default function () {
  const vuId = __VU;  // Virtual User ID from k6
  const urls = buildOAuthUrls(REALM_NAME, TARGET_URL);

  // ─── Scenario 1: Login first, then revoke access token ─────────────────────

  group('Token Revocation - Access Token', () => {
    const startTime = Date.now();

    // First, obtain a token through login
    const tokenResponse = requestPasswordToken(urls.token, vuId, {
      client_id: TEST_CLIENT_ID,
      client_secret: TEST_CLIENT_SECRET,
      username: TEST_USERNAME,
      password: TEST_PASSWORD,
      scope: 'openid',
    });

    if (tokenResponse) {
      // Immediately revoke the access token
      const revokeRes = http.post(
        urls.tokenRevoke,
        new URLSearchParams({
          token: tokenResponse.access_token,
          client_id: TEST_CLIENT_ID,
          client_secret: TEST_CLIENT_SECRET,
        }).toString(),
        { headers: FORM_HEADERS, tags: { operation: 'revoke_access_token' } }
      );

      revocationDuration.add(Date.now() - startTime);
      revocationAttempts.add(1, { vu_id: String(vuId), token_type: 'access_token' });

      if (checkResponse(revokeRes, 'access_token_revoke', { vu_id: vuId })) {
        revocationSuccessRate.add(1);
        tokenRevokedCount.add(1, { vu_id: String(vuId), token_type: 'access_token' });

        check(revokeRes, {
          'revocation returns 200': () => revokeRes.status === 200,
        });
      } else {
        revocationSuccessRate.add(0);
      }
    }
  });

  // ─── Scenario 2: Login and revoke refresh token ────────────────────────────

  group('Token Revocation - Refresh Token', () => {
    const startTime = Date.now();

    // First, obtain a token with refresh token
    const tokenResponse = requestPasswordToken(urls.token, vuId, {
      client_id: TEST_CLIENT_ID,
      client_secret: TEST_CLIENT_SECRET,
      username: TEST_USERNAME,
      password: TEST_PASSWORD,
      scope: 'openid',
    });

    if (tokenResponse && tokenResponse.refresh_token) {
      // Revoke the refresh token
      const revokeRes = http.post(
        urls.tokenRevoke,
        new URLSearchParams({
          token: tokenResponse.refresh_token,
          client_id: TEST_CLIENT_ID,
          client_secret: TEST_CLIENT_SECRET,
        }).toString(),
        { headers: FORM_HEADERS, tags: { operation: 'revoke_refresh_token' } }
      );

      revocationDuration.add(Date.now() - startTime);
      revocationAttempts.add(1, { vu_id: String(vuId), token_type: 'refresh_token' });

      if (checkResponse(revokeRes, 'refresh_token_revoke', { vu_id: vuId })) {
        revocationSuccessRate.add(1);
        tokenRevokedCount.add(1, { vu_id: String(vuId), token_type: 'refresh_token' });

        check(revokeRes, {
          'refresh token revocation returns 200': () => revokeRes.status === 200,
        });
      } else {
        revocationSuccessRate.add(0);
      }
    }
  });

  // ─── Scenario 3: Revoke non-existent token (negative test) ────────────────

  // Test a subset of VUs for invalid token revocation
  if (vuId % 5 === 0) {
    group('Token Revocation - Invalid Token', () => {
      const revokeRes = http.post(
        urls.tokenRevoke,
        new URLSearchParams({
          token: 'invalid-token-that-does-not-exist',
          client_id: TEST_CLIENT_ID,
          client_secret: TEST_CLIENT_SECRET,
        }).toString(),
        { headers: FORM_HEADERS, tags: { operation: 'revoke_invalid_token' } }
      );

      // According to RFC 7000, revocation endpoint should return 200 even for invalid tokens
      check(revokeRes, {
        'invalid token revocation returns 200': () => revokeRes.status === 200,
      });
    });
  }

  // ─── Scenario 4: Revoke token without client credentials (negative test) ──

  if (vuId % 7 === 0) {
    group('Token Revocation - Missing Client Auth', () => {
      const revokeRes = http.post(
        urls.tokenRevoke,
        new URLSearchParams({
          token: 'some-token-to-revoke',
          // client_id and client_secret intentionally missing
        }).toString(),
        { headers: FORM_HEADERS, tags: { operation: 'revoke_no_auth' } }
      );

      // Expect 401 for missing client credentials
      check(revokeRes, {
        'missing client auth returns 401': () => revokeRes.status === 401,
      });
    });
  }

  // ─── Scenario 5: Concurrent token revocation stress test ─────────────────

  // Simulate a user logging out from multiple sessions
  if (vuId % 3 === 0) {
    group('Token Revocation - Multiple Sessions', () => {
      const tokenResponse = requestPasswordToken(urls.token, vuId, {
        client_id: TEST_CLIENT_ID,
        client_secret: TEST_CLIENT_SECRET,
        username: TEST_USERNAME,
        password: TEST_PASSWORD,
        scope: 'openid',
      });

      if (tokenResponse && tokenResponse.access_token) {
        // Revoke the same access token twice (second should succeed but be idempotent)
        const firstRevoke = http.post(
          urls.tokenRevoke,
          new URLSearchParams({
            token: tokenResponse.access_token,
            client_id: TEST_CLIENT_ID,
            client_secret: TEST_CLIENT_SECRET,
          }).toString(),
          { headers: FORM_HEADERS, tags: { operation: 'revoke_first' } }
        );

        const secondRevoke = http.post(
          urls.tokenRevoke,
          new URLSearchParams({
            token: tokenResponse.access_token,
            client_id: TEST_CLIENT_ID,
            client_secret: TEST_CLIENT_SECRET,
          }).toString(),
          { headers: FORM_HEADERS, tags: { operation: 'revoke_second' } }
        );

        check(firstRevoke, {
          'first revocation succeeds': () => firstRevoke.status === 200,
        });

        check(secondRevoke, {
          'second revocation (idempotent) succeeds': () => secondRevoke.status === 200,
        });
      }
    });
  }

  // ─── Scenario 6: Use shared token storage for revocation ──────────────────

  // Store tokens for some VUs and revoke them on subsequent iterations
  if (vuId % 2 === 0) {
    group('Token Revocation - Stored Token', () => {
      const storedToken = tokenStore.get(String(vuId));

      if (storedToken && storedToken.accessToken) {
        const revokeRes = http.post(
          urls.tokenRevoke,
          new URLSearchParams({
            token: storedToken.accessToken,
            client_id: storedToken.clientId || TEST_CLIENT_ID,
            client_secret: TEST_CLIENT_SECRET,
          }).toString(),
          { headers: FORM_HEADERS, tags: { operation: 'revoke_stored_token' } }
        );

        if (checkResponse(revokeRes, 'stored_token_revoke', { vu_id: vuId })) {
          tokenRevokedCount.add(1, { vu_id: String(vuId), token_type: 'stored_access_token' });

          // Remove from token store after revocation
          tokenStore.delete(String(vuId));
        }
      } else {
        // No stored token, perform login first
        const tokenResponse = requestPasswordToken(urls.token, vuId, {
          client_id: TEST_CLIENT_ID,
          client_secret: TEST_CLIENT_SECRET,
          username: TEST_USERNAME,
          password: TEST_PASSWORD,
          scope: 'openid',
        });

        if (tokenResponse) {
          // Revoke and remove from store
          if (revokeToken(urls.tokenRevoke, tokenResponse.access_token)) {
            tokenStore.delete(String(vuId));
          }
        }
      }
    });
  }

  // ─── Think time between requests ─────────────────────────────────────────

  sleep(Math.random() * 2 + 0.5); // 0.5-2.5 seconds random delay
}

// ─── Setup/Teardown ──────────────────────────────────────────────────────────────

export function setup() {
  // Validate configuration before running tests
  const urls = buildOAuthUrls(REALM_NAME, TARGET_URL);

  // Verify the server is reachable
  const healthRes = http.get(`${TARGET_URL}/health`);
  if (healthRes.status !== 200) {
    console.warn(`Health check failed at ${TARGET_URL}/health. Server may not be running.`);
  }

  console.log(`Starting token revocation load test against ${TARGET_URL}`);
  console.log(`Realm: ${REALM_NAME}`);
  console.log(`VUs: ${VUS}, Duration: ${DURATION}`);

  return { targetUrl: TARGET_URL, realmName: REALM_NAME };
}

export function teardown(data) {
  console.log('Token revocation load test completed.');
  console.log(`Total tokens remaining in store: ${tokenStore.size()}`);

  // Clean up: revoke all remaining tokens at end of test
  const urls = buildOAuthUrls(REALM_NAME, TARGET_URL);
  let cleanedUp = 0;

  tokenStore.tokens.forEach((token, vuId) => {
    if (token.accessToken) {
      http.post(
        urls.tokenRevoke,
        new URLSearchParams({
          token: token.accessToken,
          client_id: token.clientId || TEST_CLIENT_ID,
          client_secret: TEST_CLIENT_SECRET,
        }).toString(),
        { headers: FORM_HEADERS }
      );
      cleanedUp++;
    }
  });

  console.log(`Cleaned up ${cleanedUp} tokens in teardown.`);
  tokenStore.clear();
}
