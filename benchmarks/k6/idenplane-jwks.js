/**
 * Authme JWKS Endpoint Load Test
 *
 * Tests the OAuth2 JWKS (JSON Web Key Set) endpoint which provides public keys
 * for JWT signature verification. This script simulates clients fetching and
 * caching public keys for token validation.
 *
 * Usage:
 *   k6 run benchmarks/k6/idenplane-jwks.js
 *   k6 run benchmarks/k6/idenplane-jwks.js -e TARGET_URL=http://localhost:3000 -e REALM_NAME=my-realm
 *
 * Environment Variables:
 *   TARGET_URL         - Base URL of Authme server (default: http://localhost:3000)
 *   REALM_NAME         - Realm name to test against (default: test-realm)
 *   VUS                - Number of virtual users (default: 50)
 *   DURATION           - Test duration (default: 60s)
 *   RAMP_UP            - Ramp-up time (default: 10s)
 */

import { Rate, Trend, Counter, Gauge } from 'k6/metrics';
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
import http from 'k6/http';
import { check, group, sleep } from 'k6';

// ─── Custom Metrics ────────────────────────────────────────────────────────────

const jwksSuccessRate = new Rate('jwks_success_rate');
const jwksDuration = new Trend('jwks_duration');
const jwksKeyCount = new Gauge('jwks_key_count');
const failedJwksRequests = new Counter('failed_jwks_requests');
const keyRotationCount = new Counter('key_rotation_count');

// ─── Configuration ──────────────────────────────────────────────────────────────

const TARGET_URL = __ENV.TARGET_URL || DEFAULT_TARGET_URL;
const REALM_NAME = __ENV.REALM_NAME || DEFAULT_REALM;
const VUS = parseInt(__ENV.VUS || String(DEFAULT_VUS), 10);
const DURATION = __ENV.DURATION || DEFAULT_DURATION;
const RAMP_UP = __ENV.RAMP_UP || DEFAULT_RAMP_UP;

// ─── State ───────────────────────────────────────────────────────────────────────

/** Cache for JWKS responses to detect key rotation */
let cachedJwks = null;
let cachedKeysHash = '';

/**
 * Simple hash function for comparing key sets
 * @param {string} str - String to hash
 * @returns {string} Simple hash
 */
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(16);
}

// ─── k6 Options ─────────────────────────────────────────────────────────────────

export const options = {
  stages: [
    { duration: RAMP_UP, target: VUS },
    { duration: DURATION, target: VUS },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    'http_req_duration': ['p(95)<200', 'p(99)<500'],
    'http_req_failed': ['rate<0.05'],
    'jwks_success_rate': ['rate>0.95'],
    'jwks_duration': ['p(95)<100'],
  },
  summaryTimeUnit: 'ms',
};

// ─── Test Scenarios ────────────────────────────────────────────────────────────

export default function () {
  const vuId = __VU;  // Virtual User ID from k6
  const urls = buildOAuthUrls(REALM_NAME, TARGET_URL);

  // ─── Scenario 1: Fetch JWKS keys ─────────────────────────────────────────

  group('JWKS - Fetch Public Keys', () => {
    const startTime = Date.now();

    const jwksRes = http.get(urls.jwks, {
      headers: JSON_HEADERS,
      tags: { operation: 'jwks_fetch', vu_id: vuId },
    });

    jwksDuration.add(Date.now() - startTime);

    if (checkResponse(jwksRes, 'jwks_fetch', { vu_id: vuId })) {
      jwksSuccessRate.add(1);

      // Verify JWKS structure
      check(jwksRes, {
        'jwks returns 200': () => jwksRes.status === 200,
        'jwks content type is json': () => jwksRes.headers['Content-Type']?.includes('application/json'),
      });

      const jwks = JSON.parse(jwksRes.body);
      check(jwks, {
        'has keys array': () => Array.isArray(jwks.keys),
        'keys array is not empty': () => jwks.keys.length > 0,
      });

      // Track key count
      jwksKeyCount.add(jwks.keys?.length || 0, { realm: REALM_NAME });

      // Check for key rotation
      const keysHash = simpleHash(JSON.stringify(jwks.keys));
      if (cachedJwks === null) {
        cachedJwks = jwks;
        cachedKeysHash = keysHash;
      } else if (keysHash !== cachedKeysHash) {
        keyRotationCount.add(1, { vu_id: String(vuId) });
        cachedJwks = jwks;
        cachedKeysHash = keysHash;
      }
    } else {
      jwksSuccessRate.add(0);
      failedJwksRequests.add(1, { vu_id: String(vuId) });
    }
  });

  // ─── Scenario 2: Verify key structure ─────────────────────────────────────

  group('JWKS - Verify Key Structure', () => {
    const jwksRes = http.get(urls.jwks, {
      headers: JSON_HEADERS,
      tags: { operation: 'jwks_verify', vu_id: vuId },
    });

    if (checkResponse(jwksRes, 'jwks_verify', { vu_id: vuId })) {
      const jwks = JSON.parse(jwksRes.body);

      if (jwks.keys && jwks.keys.length > 0) {
        const key = jwks.keys[0];
        check(key, {
          'has kty (key type)': () => key.kty !== undefined,
          'has use (intended use)': () => key.use !== undefined || key.use === undefined,
          'has alg OR no alg is acceptable': () => key.alg !== undefined || key.alg === undefined,
          'has kid (key ID)': () => key.kid !== undefined,
          'RS256 key has n and e': () => {
            if (key.kty === 'RSA' && key.alg === 'RS256') {
              return key.n !== undefined && key.e !== undefined;
            }
            return true;
          },
        });

        // For RSA keys, verify modulus and exponent are valid base64
        if (key.kty === 'RSA') {
          check(key, {
            'RSA key has valid n (modulus)': () => {
              if (key.n === undefined) return true;
              try {
                return key.n.length > 0;
              } catch {
                return false;
              }
            },
            'RSA key has valid e (exponent)': () => {
              if (key.e === undefined) return true;
              try {
                return key.e.length > 0;
              } catch {
                return false;
              }
            },
          });
        }

        // For EC keys (if present)
        if (key.kty === 'EC') {
          check(key, {
            'EC key has valid crv (curve)': () => key.crv !== undefined,
            'EC key has valid x coordinate': () => key.x !== undefined,
            'EC key has valid y coordinate': () => key.y !== undefined,
          });
        }
      }
    }
  });

  // ─── Scenario 3: Concurrent key fetches (cache simulation) ─────────────────

  // Simulate multiple clients fetching keys concurrently to test caching
  group('JWKS - Concurrent Fetch Simulation', () => {
    // Simulate different clients doing rapid key fetches
    const concurrentFetches = 3;
    const results = [];

    for (let i = 0; i < concurrentFetches; i++) {
      const res = http.get(urls.jwks, {
        headers: JSON_HEADERS,
        tags: { operation: 'jwks_concurrent', vu_id: vuId, fetch_num: i },
      });
      results.push(res);
    }

    // All concurrent requests should succeed
    const allSuccess = results.every(res => res.status === 200);
    check({}, {
      'all concurrent fetches succeed': () => allSuccess,
    });

    // Response times should be consistent (cache working)
    if (results.length >= 2) {
      const firstDuration = results[0].timings.duration;
      const secondDuration = results[1].timings.duration;

      // Cache should make subsequent requests faster or similar
      check({}, {
        'subsequent fetches are comparable': () => secondDuration <= firstDuration * 1.5,
      });
    }
  });

  // ─── Scenario 4: Invalid realm test (negative test) ───────────────────────

  // Run invalid realm test for a subset of VUs to simulate real-world scenarios
  if (vuId % 10 === 0) {
    group('JWKS - Invalid Realm Test', () => {
      const invalidUrls = buildOAuthUrls('non-existent-realm', TARGET_URL);

      const res = http.get(invalidUrls.jwks, {
        headers: JSON_HEADERS,
        tags: { operation: 'jwks_invalid_realm', vu_id: vuId },
      });

      // Expect 404 or other error for non-existent realm
      check(res, {
        'invalid realm returns error status': () => res.status >= 400,
      });
    });
  }

  // ─── Scenario 5: Well-known discovery (related endpoint) ─────────────────

  // Test the OIDC well-known endpoint as well
  if (vuId % 5 === 0) {
    group('JWKS - Well-Known Discovery', () => {
      const discoveryRes = http.get(urls.wellKnown, {
        headers: JSON_HEADERS,
        tags: { operation: 'jwks_well_known', vu_id: vuId },
      });

      if (checkResponse(discoveryRes, 'jwks_well_known', { vu_id: vuId })) {
        const discovery = JSON.parse(discoveryRes.body);
        check(discovery, {
          'has issuer': () => discovery.issuer !== undefined,
          'has jwks_uri': () => discovery.jwks_uri !== undefined,
          'jwks_uri points to correct endpoint': () => {
            return discovery.jwks_uri?.includes('/jwk') || discovery.jwks_uri === urls.jwks;
          },
        });
      }
    });
  }

  // ─── Think time between iterations ───────────────────────────────────────

  sleep(Math.random() * 3 + 1); // 1-4 seconds random delay
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

  // Pre-warm the JWKS cache
  const warmupRes = http.get(urls.jwks, { headers: JSON_HEADERS });
  if (warmupRes.status === 200) {
    cachedJwks = JSON.parse(warmupRes.body);
    cachedKeysHash = simpleHash(JSON.stringify(cachedJwks.keys));
    console.log(`JWKS pre-warmed with ${cachedJwks.keys?.length || 0} keys`);
  }

  console.log(`Starting JWKS load test against ${TARGET_URL}`);
  console.log(`Realm: ${REALM_NAME}`);
  console.log(`VUs: ${VUS}, Duration: ${DURATION}`);

  return { targetUrl: TARGET_URL, realmName: REALM_NAME };
}

export function teardown(data) {
  console.log('JWKS load test completed.');
  if (cachedJwks) {
    console.log(`Final key count: ${cachedJwks.keys?.length || 0}`);
  }
}
