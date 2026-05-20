/**
 * Authme Token Introspection Load Test
 *
 * Tests the OAuth2 token introspection endpoint which allows resource servers
 * to validate tokens and retrieve claims.
 *
 * This script simulates:
 * - Valid token introspection
 * - Invalid/expired token introspection
 * - Introspection with missing parameters
 * - Concurrent introspection requests
 *
 * Usage:
 *   k6 run benchmarks/k6/authme-token-introspection.js
 *   k6 run benchmarks/k6/authme-token-introspection.js -e VUS=100 -e DURATION=120s
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
  requestClientCredentialsToken,
  introspectToken,
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
import { Rate, Trend, Counter, Gauge } from 'k6/metrics';
import { check, group, sleep } from 'k6';

// ─── Custom Metrics ────────────────────────────────────────────────────────────

const validTokenIntrospectionRate = new Rate('valid_token_introspection_rate');
const invalidTokenIntrospectionRate = new Rate('invalid_token_introspection_rate');
const revokedTokenIntrospectionRate = new Rate('revoked_token_introspection_rate');

const introspectionDuration = new Trend('introspection_duration');
const tokenValidationDuration = new Trend('token_validation_duration');

const introspectionRequests = new Counter('introspection_requests_total');
const introspectionActiveTrue = new Counter('introspection_active_true');
const introspectionActiveFalse = new Counter('introspection_active_false');

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
    'valid_token_introspection_rate': ['rate>0.95'],
    'introspection_duration': ['p(95)<200'],
  },
  summaryTimeUnit: 'ms',
};

// ─── Introspection Validation Helpers ─────────────────────────────────────────

/**
 * Validate active token introspection response
 */
function validateActiveIntrospection(introspection, token) {
  const checks = {
    'active is true': introspection.active === true,
    'has sub claim': introspection.sub !== undefined,
    'has iss claim': introspection.iss !== undefined,
    'has token_type': introspection.token_type !== undefined,
  };

  check(introspection, checks);

  if (introspection.active) {
    introspectionActiveTrue.add(1);
  }

  return Object.values(checks).every(v => v);
}

/**
 * Validate inactive token introspection response
 */
function validateInactiveIntrospection(introspection) {
  const checks = {
    'active is false': introspection.active === false,
  };

  check(introspection, checks);

  if (introspection.active === false) {
    introspectionActiveFalse.add(1);
  }

  return Object.values(checks).every(v => v);
}

// ─── Test Scenarios ────────────────────────────────────────────────────────────

export default function () {
  const vuId = String(__VU);
  const urls = buildOAuthUrls(REALM_NAME, TARGET_URL);

  // ─── Scenario 1: Introspect valid token ────────────────────────────────────

  group('Valid Token Introspection', () => {
    // Obtain a fresh token
    const tokenResponse = requestPasswordToken(urls.token, `introspect-${vuId}-1`, {
      client_id: TEST_CLIENT_ID,
      client_secret: TEST_CLIENT_SECRET,
      username: TEST_USERNAME,
      password: TEST_PASSWORD,
      scope: 'openid',
    });

    if (tokenResponse && tokenResponse.access_token) {
      const startTime = Date.now();

      const introspection = introspectToken(
        urls.tokenIntrospect,
        tokenResponse.access_token,
        'valid_introspection'
      );

      introspectionDuration.add(Date.now() - startTime);
      introspectionRequests.add(1);

      if (introspection) {
        const isValid = validateActiveIntrospection(introspection, tokenResponse.access_token);
        validTokenIntrospectionRate.add(isValid ? 1 : 0);
      } else {
        validTokenIntrospectionRate.add(0);
      }
    }
  });

  // ─── Scenario 2: Introspect client credentials token ─────────────────────

  group('Client Credentials Token Introspection', () => {
    const tokenResponse = requestClientCredentialsToken(urls.token, `introspect-cc-${vuId}`, {
      client_id: TEST_CLIENT_ID,
      client_secret: TEST_CLIENT_SECRET,
    });

    if (tokenResponse && tokenResponse.access_token) {
      const introspection = introspectToken(
        urls.tokenIntrospect,
        tokenResponse.access_token,
        'client_credentials_introspection'
      );

      introspectionRequests.add(1);

      if (introspection) {
        check(introspection, {
          'client credentials token is active': introspection.active === true,
          'client credentials has scope claim': introspection.scope !== undefined,
        });
      }
    }
  });

  // ─── Scenario 3: Introspect revoked token ─────────────────────────────────

  // Simulate a small percentage of VUs testing revoked tokens
  if (vuId % 10 === 0) {
    group('Revoked Token Introspection', () => {
      // Get a token
      const tokenResponse = requestPasswordToken(urls.token, `revoked-${vuId}`, {
        client_id: TEST_CLIENT_ID,
        client_secret: TEST_CLIENT_SECRET,
        username: TEST_USERNAME,
        password: TEST_PASSWORD,
        scope: 'openid',
      });

      if (tokenResponse && tokenResponse.access_token) {
        // Revoke the token
        const revoked = revokeToken(
          urls.tokenRevoke,
          tokenResponse.access_token,
          'token_revoke'
        );

        if (revoked) {
          // Now introspect the revoked token
          const introspection = introspectToken(
            urls.tokenIntrospect,
            tokenResponse.access_token,
            'revoked_token_introspection'
          );

          introspectionRequests.add(1);

          if (introspection) {
            const isInactive = introspection.active === false;
            revokedTokenIntrospectionRate.add(isInactive ? 1 : 0);
            validateInactiveIntrospection(introspection);
          }
        }
      }
    });
  }

  // ─── Scenario 4: Introspect malformed token ──────────────────────────────

  // Test a subset of VUs with malformed tokens
  if (vuId % 15 === 0) {
    group('Malformed Token Introspection', () => {
      const malformedTokens = [
        'not-a-valid-jwt',
        'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.invalid.signature',
        'Bearer xyz123',
        '',
      ];

      const tokenToTest = malformedTokens[vuId % malformedTokens.length];

      const params = new URLSearchParams({
        token: tokenToTest,
        client_id: TEST_CLIENT_ID,
        client_secret: TEST_CLIENT_SECRET,
      });

      const res = http.post(urls.tokenIntrospect, params.toString(), {
        headers: FORM_HEADERS,
      });

      check(res, {
        'malformed token returns active=false': () => {
          if (res.status === 200) {
            const body = JSON.parse(res.body);
            return body.active === false;
          }
          return res.status >= 400; // Also accept error response
        },
      });

      introspectionRequests.add(1);
    });
  }

  // ─── Scenario 5: Introspect with invalid client credentials ─────────────

  if (vuId % 25 === 0) {
    group('Introspection with Invalid Client', () => {
      // Get a valid token first
      const tokenResponse = requestPasswordToken(urls.token, `invalid-client-${vuId}`, {
        client_id: TEST_CLIENT_ID,
        client_secret: TEST_CLIENT_SECRET,
        username: TEST_USERNAME,
        password: TEST_PASSWORD,
        scope: 'openid',
      });

      if (tokenResponse && tokenResponse.access_token) {
        // Try to introspect with wrong client credentials
        const params = new URLSearchParams({
          token: tokenResponse.access_token,
          client_id: TEST_CLIENT_ID,
          client_secret: 'wrong-secret',
        });

        const res = http.post(urls.tokenIntrospect, params.toString(), {
          headers: FORM_HEADERS,
        });

        // Should return 401 for invalid client credentials
        check(res, {
          'invalid client credentials returns 401': () => res.status === 401,
        });

        introspectionRequests.add(1);
      }
    });
  }

  // ─── Scenario 6: Concurrent introspection simulation ────────────────────

  // Some VUs simulate multiple concurrent introspection calls
  if (vuId % 5 === 0) {
    group('Multiple Introspection Calls', () => {
      // Get multiple tokens
      const tokens = [];
      for (let i = 0; i < 3; i++) {
        const token = requestPasswordToken(urls.token, `multi-${vuId}-${i}`, {
          client_id: TEST_CLIENT_ID,
          client_secret: TEST_CLIENT_SECRET,
          username: TEST_USERNAME,
          password: TEST_PASSWORD,
          scope: 'openid',
        });
        if (token && token.access_token) {
          tokens.push(token.access_token);
        }
      }

      // Introspect all tokens
      tokens.forEach((token, index) => {
        const introspection = introspectToken(
          urls.tokenIntrospect,
          token,
          `multi_introspection_${index}`
        );

        introspectionRequests.add(1);

        if (introspection && introspection.active) {
          // Token is valid, no additional action needed
        }
      });
    });
  }

  // ─── Think time ────────────────────────────────────────────────────────────

  sleep(Math.random() * 1.5 + 0.5); // 0.5-2 seconds random delay
}

// ─── Setup/Teardown ─────────────────────────────────────────────────────────────

export function setup() {
  console.log(`Starting token introspection load test against ${TARGET_URL}`);
  console.log(`Realm: ${REALM_NAME}`);
  console.log(`VUs: ${VUS}, Duration: ${DURATION}`);

  return { targetUrl: TARGET_URL, realmName: REALM_NAME };
}

export function teardown(data) {
  console.log('Token introspection load test completed.');
  console.log(`Total introspection requests tracked: ${introspectionRequests}`);
}