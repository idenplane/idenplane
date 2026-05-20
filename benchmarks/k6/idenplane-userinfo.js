/**
 * Authme Userinfo Endpoint Load Test
 *
 * Tests the OAuth2/OIDC UserInfo endpoint which returns claims about the
 * authenticated user. This endpoint is typically called after token validation
 * to retrieve user profile information.
 *
 * This script simulates:
 * - Valid userinfo requests with Bearer token
 * - Userinfo requests with expired/revoked tokens
 * - Userinfo requests without Authorization header
 * - Concurrent userinfo requests
 *
 * Usage:
 *   k6 run benchmarks/k6/idenplane-userinfo.js
 *   k6 run benchmarks/k6/idenplane-userinfo.js -e VUS=100 -e DURATION=120s
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

import {
  buildOAuthUrls,
  requestPasswordToken,
  callUserinfo,
  checkResponse,
  getBearerHeaders,
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

const userinfoSuccessRate = new Rate('userinfo_success_rate');
const userinfoDuration = new Trend('userinfo_duration');

const userinfoRequests = new Counter('userinfo_requests_total');
const userinfoRequestsSuccess = new Counter('userinfo_requests_success');
const userinfoRequestsUnauthorized = new Counter('userinfo_requests_unauthorized');

const validClaimsReturned = new Counter('userinfo_valid_claims');
const missingClaims = new Counter('userinfo_missing_claims');

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
    'userinfo_success_rate': ['rate>0.95'],
    'userinfo_duration': ['p(95)<300'],
  },
  summaryTimeUnit: 'ms',
};

// ─── Userinfo Validation Helpers ─────────────────────────────────────────────

/**
 * Validate userinfo response contains expected OIDC claims
 */
function validateUserinfoClaims(userinfo, expectedUsername, expectedEmail) {
  let validClaimsCount = 0;
  let missingClaimsCount = 0;

  // Required OIDC claims
  const requiredClaims = ['sub'];

  // Optional but expected claims
  const expectedStandardClaims = [
    'sub',
    'preferred_username',
    'email',
  ];

  // Check required claims
  requiredClaims.forEach(claim => {
    if (userinfo[claim] !== undefined) {
      validClaimsReturned.add(1, { claim });
      validClaimsCount++;
    } else {
      missingClaims.add(1, { claim });
      missingClaimsCount++;
    }
  });

  // Check standard claims (don't fail, just track)
  expectedStandardClaims.forEach(claim => {
    if (userinfo[claim] !== undefined) {
      validClaimsReturned.add(1, { claim });
      validClaimsCount++;
    } else if (claim !== 'sub') {
      // sub is already counted in required
      missingClaims.add(1, { claim });
      missingClaimsCount++;
    }
  });

  // Validate specific claim values
  const checks = {
    'has sub claim': userinfo.sub !== undefined,
    'sub is non-empty': userinfo.sub && userinfo.sub.length > 0,
  };

  // Add optional claims if present
  if (userinfo.preferred_username) {
    checks['preferred_username matches'] = userinfo.preferred_username === expectedUsername;
  }
  if (userinfo.email) {
    checks['email matches expected'] = userinfo.email === expectedEmail;
  }

  check(userinfo, checks);

  return validClaimsCount;
}

/**
 * Validate userinfo error response
 */
function validateUserinfoError(res, expectedStatus) {
  check(res, {
    [`userinfo error returns ${expectedStatus}`]: () => res.status === expectedStatus,
  });

  if (res.status === 401) {
    userinfoRequestsUnauthorized.add(1);
  }
}

// ─── Test Scenarios ────────────────────────────────────────────────────────────

export default function () {
  const vuId = String(__VU);
  const urls = buildOAuthUrls(REALM_NAME, TARGET_URL);

  // ─── Scenario 1: Valid userinfo request ───────────────────────────────────

  group('Userinfo - Valid Request', () => {
    // First, obtain a valid access token
    const tokenResponse = requestPasswordToken(urls.token, `userinfo-${vuId}-1`, {
      client_id: TEST_CLIENT_ID,
      client_secret: TEST_CLIENT_SECRET,
      username: TEST_USERNAME,
      password: TEST_PASSWORD,
      scope: 'openid',
    });

    if (tokenResponse && tokenResponse.access_token) {
      const startTime = Date.now();

      // Call userinfo endpoint
      const userinfo = callUserinfo(
        urls.userinfo,
        tokenResponse.access_token,
        'valid_userinfo'
      );

      userinfoDuration.add(Date.now() - startTime);
      userinfoRequests.add(1);

      if (userinfo) {
        userinfoRequestsSuccess.add(1);
        userinfoSuccessRate.add(1);
        validateUserinfoClaims(userinfo, TEST_USERNAME, 'testuser@example.com');
      } else {
        userinfoSuccessRate.add(0);
      }
    }
  });

  // ─── Scenario 2: Userinfo with different scopes ──────────────────────────

  // Test different scope combinations
  const scopes = ['openid', 'openid profile', 'openid email'];
  const scopeToTest = scopes[vuId % scopes.length];

  group('Userinfo - Different Scopes', () => {
    const tokenResponse = requestPasswordToken(urls.token, `scope-${vuId}`, {
      client_id: TEST_CLIENT_ID,
      client_secret: TEST_CLIENT_SECRET,
      username: TEST_USERNAME,
      password: TEST_PASSWORD,
      scope: scopeToTest,
    });

    if (tokenResponse && tokenResponse.access_token) {
      const userinfo = callUserinfo(
        urls.userinfo,
        tokenResponse.access_token,
        `scope_${scopeToTest.replace(' ', '_')}`
      );

      userinfoRequests.add(1);

      if (userinfo) {
        userinfoRequestsSuccess.add(1);

        // Check scope-specific claims
        if (scopeToTest.includes('email')) {
          check(userinfo, {
            'email claim present with email scope': userinfo.email !== undefined,
          });
        }
        if (scopeToTest.includes('profile')) {
          check(userinfo, {
            'has name or given_name with profile scope': userinfo.name !== undefined || userinfo.given_name !== undefined,
          });
        }
      }
    }
  });

  // ─── Scenario 3: Userinfo without token (negative test) ────────────────

  if (vuId % 20 === 0) {
    group('Userinfo - No Token', () => {
      // Call userinfo without Authorization header
      const res = http.get(urls.userinfo);

      userinfoRequests.add(1);
      validateUserinfoError(res, 401);

      if (res.status === 401) {
        userinfoSuccessRate.add(0);
      }
    });
  }

  // ─── Scenario 4: Userinfo with invalid token ───────────────────────────

  if (vuId % 20 === 5) {
    group('Userinfo - Invalid Token', () => {
      const invalidTokens = [
        'invalid.access.token.here',
        'Bearer fake_token_123',
        '',
      ];

      const invalidToken = invalidTokens[vuId % invalidTokens.length];

      const res = http.get(urls.userinfo, {
        headers: getBearerHeaders(invalidToken),
      });

      userinfoRequests.add(1);
      validateUserinfoError(res, 401);

      if (res.status === 401) {
        userinfoSuccessRate.add(0);
      }
    });
  }

  // ─── Scenario 5: Userinfo with expired/revoked token ───────────────────

  // Simulate a subset of VUs testing with revoked tokens
  if (vuId % 30 === 0) {
    group('Userinfo - Revoked Token', () => {
      // Get a fresh token
      const tokenResponse = requestPasswordToken(urls.token, `revoked-userinfo-${vuId}`, {
        client_id: TEST_CLIENT_ID,
        client_secret: TEST_CLIENT_SECRET,
        username: TEST_USERNAME,
        password: TEST_PASSWORD,
        scope: 'openid',
      });

      if (tokenResponse && tokenResponse.access_token) {
        // Revoke the token first
        const params = new URLSearchParams({
          token: tokenResponse.access_token,
          client_id: TEST_CLIENT_ID,
          client_secret: TEST_CLIENT_SECRET,
        });

        http.post(urls.tokenRevoke, params.toString(), { headers: FORM_HEADERS });

        // Now try to use the revoked token
        const res = http.get(urls.userinfo, {
          headers: getBearerHeaders(tokenResponse.access_token),
        });

        userinfoRequests.add(1);

        // Revoked token should return 401
        check(res, {
          'revoked token returns 401': () => res.status === 401,
        });

        userinfoSuccessRate.add(0);
      }
    });
  }

  // ─── Scenario 6: Multiple sequential userinfo calls ────────────────────

  // Simulate real-world scenarios where userinfo might be called multiple times
  if (vuId % 10 === 0) {
    group('Userinfo - Sequential Calls', () => {
      // Get token once
      const tokenResponse = requestPasswordToken(urls.token, `sequential-${vuId}`, {
        client_id: TEST_CLIENT_ID,
        client_secret: TEST_CLIENT_SECRET,
        username: TEST_USERNAME,
        password: TEST_PASSWORD,
        scope: 'openid',
      });

      if (tokenResponse && tokenResponse.access_token) {
        // Make multiple sequential calls (simulating session refresh, etc.)
        for (let i = 0; i < 3; i++) {
          const startTime = Date.now();
          const userinfo = callUserinfo(
            urls.userinfo,
            tokenResponse.access_token,
            `sequential_call_${i}`
          );
          userinfoDuration.add(Date.now() - startTime);
          userinfoRequests.add(1);

          if (userinfo && i === 0) {
            userinfoRequestsSuccess.add(1);
          }
        }
      }
    });
  }

  // ─── Think time ─────────────────────────────────────────────────────────

  sleep(Math.random() * 1.5 + 0.5); // 0.5-2 seconds random delay
}

// ─── Setup/Teardown ─────────────────────────────────────────────────────────────

export function setup() {
  console.log(`Starting userinfo load test against ${TARGET_URL}`);
  console.log(`Realm: ${REALM_NAME}`);
  console.log(`VUs: ${VUS}, Duration: ${DURATION}`);

  return { targetUrl: TARGET_URL, realmName: REALM_NAME };
}

export function teardown(data) {
  console.log('Userinfo load test completed.');
  console.log(`Total userinfo requests: ${userinfoRequests}`);
  console.log(`Successful requests: ${userinfoRequestsSuccess}`);
  console.log(`Unauthorized requests: ${userinfoRequestsUnauthorized}`);
}