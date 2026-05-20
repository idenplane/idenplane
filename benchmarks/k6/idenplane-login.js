/**
 * Authme Login Load Test
 *
 * Tests the OAuth2 password grant flow which represents the user login operation.
 * This script simulates users authenticating with username/password credentials
 * and receiving access tokens for subsequent API access.
 *
 * Usage:
 *   k6 run benchmarks/k6/idenplane-login.js
 *   k6 run benchmarks/k6/idenplane-login.js -e TARGET_URL=http://localhost:3000 -e REALM_NAME=my-realm
 *
 * Environment Variables:
 *   TARGET_URL         - Base URL of Authme server (default: http://localhost:3000)
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

const loginSuccessRate = new Rate('login_success_rate');
const loginDuration = new Trend('login_duration');
const failedLoginAttempts = new Counter('failed_login_attempts');
const tokenRotationCount = new Counter('token_rotation_count');

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
    'login_success_rate': ['rate>0.95'],
    'login_duration': ['p(95)<300'],
  },
  summaryTimeUnit: 'ms',
};

// ─── Test Scenarios ────────────────────────────────────────────────────────────

export default function () {
  const vuId = __VU;  // Virtual User ID from k6
  const urls = buildOAuthUrls(REALM_NAME, TARGET_URL);

  // ─── Scenario 1: Login with password grant ──────────────────────────────────

  group('OAuth Login - Password Grant', () => {
    const startTime = Date.now();

    const tokenResponse = requestPasswordToken(urls.token, vuId, {
      client_id: TEST_CLIENT_ID,
      client_secret: TEST_CLIENT_SECRET,
      username: TEST_USERNAME,
      password: TEST_PASSWORD,
      scope: 'openid',
    });

    loginDuration.add(Date.now() - startTime);

    if (tokenResponse) {
      loginSuccessRate.add(1);

      // Verify token structure
      check(tokenResponse, {
        'has access_token': () => tokenResponse.access_token !== undefined,
        'has refresh_token': () => tokenResponse.refresh_token !== undefined,
        'has id_token': () => tokenResponse.id_token !== undefined,
        'has token_type': () => tokenResponse.token_type === 'Bearer',
        'has expires_in': () => typeof tokenResponse.expires_in === 'number',
        'expires_in is reasonable': () => tokenResponse.expires_in > 0 && tokenResponse.expires_in <= 86400,
      });

      // Simulate immediate token use (e.g., fetching user profile)
      const userinfoRes = http.get(urls.userinfo, {
        headers: { 'Authorization': `Bearer ${tokenResponse.access_token}` },
      });

      checkResponse(userinfoRes, 'login_userinfo_check', { vu_id: vuId });

      if (userinfoRes.status === 200) {
        const userinfo = JSON.parse(userinfoRes.body);
        check(userinfo, {
          'has sub claim': () => userinfo.sub !== undefined,
          'has preferred_username': () => userinfo.preferred_username === TEST_USERNAME,
        });
      }
    } else {
      loginSuccessRate.add(0);
      failedLoginAttempts.add(1, { vu_id: String(vuId) });
    }
  });

  // ─── Scenario 2: Simulated token refresh ────────────────────────────────────

  // Only refresh tokens on a fraction of iterations to simulate realistic behavior
  if (vuId % 3 === 0) {
    group('Token Refresh Simulation', () => {
      const storedToken = tokenStore.get(String(vuId));
      if (storedToken && storedToken.refreshToken) {
        // Check if token needs refresh (simplified: just refresh every 3rd VU)
        const refreshRes = http.post(
          urls.token,
          new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: storedToken.refreshToken,
            client_id: TEST_CLIENT_ID,
            client_secret: TEST_CLIENT_SECRET,
          }).toString(),
          { headers: FORM_HEADERS }
        );

        if (checkResponse(refreshRes, 'token_refresh', { vu_id: vuId })) {
          tokenRotationCount.add(1);
        }
      }
    });
  }

  // ─── Scenario 3: Invalid login attempt (negative test) ────────────────────

  // Run invalid login test for a subset of VUs to simulate real-world auth failures
  if (vuId % 10 === 0) {
    group('Invalid Login Attempt', () => {
      const params = new URLSearchParams({
        grant_type: 'password',
        client_id: TEST_CLIENT_ID,
        client_secret: TEST_CLIENT_SECRET,
        username: TEST_USERNAME,
        password: 'WrongPassword123!',
        scope: 'openid',
      });

      const res = http.post(urls.token, params.toString(), { headers: FORM_HEADERS });

      // Expect 401 for invalid credentials
      check(res, {
        'invalid login returns 401': () => res.status === 401,
      });

      // Don't count this as an error - it's expected behavior
      if (res.status !== 401) {
        failedLoginAttempts.add(1, { vu_id: String(vuId), type: 'unexpected_status' });
      }
    });
  }

  // ─── Scenario 4: Missing credentials test ────────────────────────────────────

  // Test a subset of VUs for missing required fields
  if (vuId % 20 === 0) {
    group('Missing Credentials Test', () => {
      // Missing password
      const paramsMissingPassword = new URLSearchParams({
        grant_type: 'password',
        client_id: TEST_CLIENT_ID,
        client_secret: TEST_CLIENT_SECRET,
        username: TEST_USERNAME,
        // password intentionally missing
        scope: 'openid',
      });

      const res = http.post(urls.token, paramsMissingPassword.toString(), {
        headers: FORM_HEADERS,
      });

      // Expect 400 for missing required fields
      check(res, {
        'missing password returns 400': () => res.status === 400,
      });
    });
  }

  // ─── Think time between requests ─────────────────────────────────────────

  sleep(Math.random() * 2 + 0.5); // 0.5-2.5 seconds random delay
}

// ─── Setup/Teardown (Optional) ─────────────────────────────────────────────────

export function setup() {
  // Validate configuration before running tests
  const urls = buildOAuthUrls(REALM_NAME, TARGET_URL);

  // Verify the server is reachable
  const healthRes = http.get(`${TARGET_URL}/health`);
  if (healthRes.status !== 200) {
    console.warn(`Health check failed at ${TARGET_URL}/health. Server may not be running.`);
  }

  console.log(`Starting login load test against ${TARGET_URL}`);
  console.log(`Realm: ${REALM_NAME}`);
  console.log(`VUs: ${VUS}, Duration: ${DURATION}`);

  return { targetUrl: TARGET_URL, realmName: REALM_NAME };
}

export function teardown(data) {
  console.log('Login load test completed.');
  console.log(`Total active tokens tracked: ${tokenStore.size()}`);
}