/**
 * Authme OpenID Discovery Load Test
 *
 * Tests the OpenID Connect Discovery endpoint which provides metadata
 * about the OAuth/OIDC provider configuration. This script simulates
 * clients discovering provider capabilities before initiating authentication.
 *
 * Usage:
 *   k6 run benchmarks/k6/authme-discovery.js
 *   k6 run benchmarks/k6/authme-discovery.js -e TARGET_URL=http://localhost:3000 -e REALM_NAME=my-realm
 *
 * Environment Variables:
 *   TARGET_URL         - Base URL of Authme server (default: http://localhost:3000)
 *   REALM_NAME         - Realm name to test against (default: test-realm)
 *   VUS                - Number of virtual users (default: 50)
 *   DURATION           - Test duration (default: 60s)
 *   RAMP_UP            - Ramp-up time (default: 10s)
 */

import http from 'k6/http';
import { Rate, Trend, Counter, Gauge } from 'k6/metrics';
import { check, group, sleep } from 'k6';
import {
  buildOAuthUrls,
  checkResponse,
  JSON_HEADERS,
  DEFAULT_TARGET_URL,
  DEFAULT_REALM,
  DEFAULT_VUS,
  DEFAULT_DURATION,
  DEFAULT_RAMP_UP,
  errorRate,
} from './shared-scenarios.js';

// ─── Custom Metrics ────────────────────────────────────────────────────────────

const discoverySuccessRate = new Rate('discovery_success_rate');
const discoveryDuration = new Trend('discovery_duration');
const failedDiscoveryAttempts = new Counter('failed_discovery_attempts');
const jwksFetchCount = new Counter('jwks_fetch_count');
const metadataValidationFailures = new Counter('metadata_validation_failures');

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
    'discovery_success_rate': ['rate>0.95'],
    'discovery_duration': ['p(95)<300'],
  },
  summaryTimeUnit: 'ms',
};

// ─── Required OIDC Discovery Fields ───────────────────────────────────────────

const REQUIRED_DISCOVERY_FIELDS = [
  'issuer',
  'authorization_endpoint',
  'token_endpoint',
  'userinfo_endpoint',
  'jwks_uri',
  'response_types_supported',
  'subject_types_supported',
  'id_token_signing_alg_values_supported',
];

const REQUIRED_TOKEN_ENDPOINT_AUTH_METHODS = [
  'client_secret_basic',
  'client_secret_post',
];

// ─── Test Scenarios ────────────────────────────────────────────────────────────

export default function () {
  const vuId = __VU;
  const urls = buildOAuthUrls(REALM_NAME, TARGET_URL);

  // ─── Scenario 1: OpenID Configuration Discovery ────────────────────────────

  group('OpenID Configuration Discovery', () => {
    const startTime = Date.now();

    const wellKnownRes = http.get(urls.wellKnown, {
      headers: JSON_HEADERS,
      tags: { operation: 'openid_discovery', vu_id: vuId },
    });

    discoveryDuration.add(Date.now() - startTime);

    if (checkResponse(wellKnownRes, 'openid_discovery', { vu_id: vuId })) {
      discoverySuccessRate.add(1);

      const metadata = JSON.parse(wellKnownRes.body);

      // Validate required fields
      let missingFields = [];
      for (const field of REQUIRED_DISCOVERY_FIELDS) {
        if (metadata[field] === undefined) {
          missingFields.push(field);
        }
      }

      check(metadata, {
        'has all required discovery fields': () => missingFields.length === 0,
        'has issuer matching realm': () => metadata.issuer && metadata.issuer.includes(REALM_NAME),
        'has valid authorization_endpoint': () => metadata.authorization_endpoint && metadata.authorization_endpoint.startsWith('http'),
        'has valid token_endpoint': () => metadata.token_endpoint && metadata.token_endpoint.startsWith('http'),
        'has valid jwks_uri': () => metadata.jwks_uri && metadata.jwks_uri.startsWith('http'),
        'has response_types_supported': () => Array.isArray(metadata.response_types_supported) && metadata.response_types_supported.length > 0,
        'has subject_types_supported': () => Array.isArray(metadata.subject_types_supported) && metadata.subject_types_supported.length > 0,
        'has id_token_signing_alg_values_supported': () => Array.isArray(metadata.id_token_signing_alg_values_supported) && metadata.id_token_signing_alg_values_supported.length > 0,
        'has grant_types_supported': () => Array.isArray(metadata.grant_types_supported) && metadata.grant_types_supported.length > 0,
        'has token_endpoint_auth_methods_supported': () => Array.isArray(metadata.token_endpoint_auth_methods_supported),
      });

      if (missingFields.length > 0) {
        metadataValidationFailures.add(1, { vu_id: String(vuId), missing_fields: missingFields.join(',') });
      }

      // Validate optional but important fields
      check(metadata, {
        'has scopes_supported': () => Array.isArray(metadata.scopes_supported),
        'has claims_supported': () => Array.isArray(metadata.claims_supported),
        'has code_challenge_method_supported': () => Array.isArray(metadata.code_challenge_methods_supported),
        'has revocation_endpoint': () => metadata.revocation_endpoint !== undefined,
        'has end_session_endpoint': () => metadata.end_session_endpoint !== undefined,
      });

      // Store metadata for subsequent requests
      __global.metadata = metadata;
    } else {
      discoverySuccessRate.add(0);
      failedDiscoveryAttempts.add(1, { vu_id: String(vuId) });
    }
  });

  // ─── Scenario 2: JWKS Fetch ──────────────────────────────────────────────────

  group('JWKS Fetch', () => {
    if (__global.metadata && __global.metadata.jwks_uri) {
      const jwksRes = http.get(__global.metadata.jwks_uri, {
        headers: JSON_HEADERS,
        tags: { operation: 'jwks_fetch', vu_id: vuId },
      });

      if (checkResponse(jwksRes, 'jwks_fetch', { vu_id: vuId })) {
        jwksFetchCount.add(1);

        const jwks = JSON.parse(jwksRes.body);

        check(jwks, {
          'has keys array': () => Array.isArray(jwks.keys),
          'has at least one key': () => jwks.keys && jwks.keys.length > 0,
        });

        // Validate key structure for first key
        if (jwks.keys && jwks.keys.length > 0) {
          const key = jwks.keys[0];
          check(key, {
            'key has kty': () => key.kty !== undefined,
            'key has use or key_ops': () => key.use !== undefined || key.key_ops !== undefined,
            'key has kid or alg': () => key.kid !== undefined || key.alg !== undefined,
          });

          if (key.kty === 'RSA') {
            check(key, {
              'RSA key has n (modulus)': () => key.n !== undefined,
              'RSA key has e (exponent)': () => key.e !== undefined,
            });
          } else if (key.kty === 'EC') {
            check(key, {
              'EC key has crv': () => key.crv !== undefined,
              'EC key has x': () => key.x !== undefined,
              'EC key has y': () => key.y !== undefined,
            });
          }
        }
      }
    }
  });

  // ─── Scenario 3: Userinfo Endpoint Discovery ────────────────────────────────

  group('Userinfo Endpoint Accessibility', () => {
    const userinfoRes = http.get(urls.userinfo, {
      headers: JSON_HEADERS,
      tags: { operation: 'userinfo_discovery', vu_id: vuId },
    });

    // Userinfo without token should return 401 (expected behavior)
    check(userinfoRes, {
      'userinfo without token returns 401': () => userinfoRes.status === 401,
      'userinfo response is fast': () => userinfoRes.timings.duration < 500,
    });

    // Also test with Bearer prefix (still should be unauthorized without valid token)
    const userinfoBearerRes = http.get(urls.userinfo, {
      headers: { 'Authorization': 'Bearer invalid-token' },
      tags: { operation: 'userinfo_bearer_test', vu_id: vuId },
    });

    check(userinfoBearerRes, {
      'userinfo with invalid token returns 401': () => userinfoBearerRes.status === 401,
    });
  });

  // ─── Scenario 4: Authorization Endpoint Accessibility ──────────────────────

  // Test authorization endpoint responds (doesn't redirect to login for public clients)
  if (vuId % 5 === 0) {
    group('Authorization Endpoint Check', () => {
      const authRes = http.get(urls.authorize, {
        params: {
          response_type: 'code',
          client_id: 'test-client',
          redirect_uri: 'http://localhost/callback',
          scope: 'openid',
          state: `test-state-${vuId}`,
        },
        tags: { operation: 'authorize_endpoint', vu_id: vuId },
        redirects: 0, // Don't follow redirects to capture the redirect location
      });

      // Authorization endpoint should return 302 redirect or 400 (missing params for auth code flow)
      check(authRes, {
        'authorize endpoint is accessible': () => authRes.status === 302 || authRes.status === 400,
        'authorize response is fast': () => authRes.timings.duration < 500,
      });
    });
  }

  // ─── Scenario 5: Negative test - Invalid realm ─────────────────────────────

  // Test a subset of VUs with invalid realm to verify proper error handling
  if (vuId % 15 === 0) {
    group('Invalid Realm Discovery', () => {
      const invalidUrls = buildOAuthUrls('nonexistent-realm', TARGET_URL);
      const res = http.get(invalidUrls.wellKnown, {
        headers: JSON_HEADERS,
        tags: { operation: 'invalid_realm_discovery', vu_id: vuId },
      });

      // Should return 404 for non-existent realm
      check(res, {
        'invalid realm returns 404': () => res.status === 404,
      });

      if (res.status !== 404) {
        failedDiscoveryAttempts.add(1, { vu_id: String(vuId), type: 'unexpected_invalid_realm_status' });
      }
    });
  }

  // ─── Think time between requests ─────────────────────────────────────────

  sleep(Math.random() * 2 + 0.5); // 0.5-2.5 seconds random delay
}

// ─── Global state for passing data between scenarios ─────────────────────────

// Initialize global storage
if (typeof __global === 'undefined') {
  __global = {};
}

// ─── Setup/Teardown ───────────────────────────────────────────────────────────

export function setup() {
  // Validate configuration before running tests
  const urls = buildOAuthUrls(REALM_NAME, TARGET_URL);

  // Verify the server is reachable
  const healthRes = http.get(`${TARGET_URL}/health`);
  if (healthRes.status !== 200) {
    console.warn(`Health check failed at ${TARGET_URL}/health. Server may not be running.`);
  }

  console.log(`Starting OpenID Discovery load test against ${TARGET_URL}`);
  console.log(`Realm: ${REALM_NAME}`);
  console.log(`VUs: ${VUS}, Duration: ${DURATION}`);

  return { targetUrl: TARGET_URL, realmName: REALM_NAME };
}

export function teardown(data) {
  console.log('OpenID Discovery load test completed.');
}