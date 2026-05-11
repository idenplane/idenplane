import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend, Counter, Gauge } from 'k6/metrics';

// ─── Custom Metrics ──────────────────────────────────────────────────────────────

/** Error rate metric for tracking failed requests */
const errorRate = new Rate('errors');

/** Auth flow duration trend */
const authFlowDuration = new Trend('auth_flow_duration');

/** API response time trend */
const apiResponseTime = new Trend('api_response_time');

/** Request counter for throughput calculation */
const requestCounter = new Counter('total_requests');

/** Successful request counter */
const successCounter = new Counter('successful_requests');

/** Failed request counter */
const failedCounter = new Counter('failed_requests');

/** Active VUs gauge */
const activeVUsGauge = new Gauge('active_vus');

// ─── Environment Variables ───────────────────────────────────────────────────────

const TARGET_URL = __ENV.TARGET_URL || 'http://localhost:3000';
const ADMIN_API_KEY = __ENV.ADMIN_API_KEY || '';
const VUS = parseInt(__ENV.VUS || '10', 10);
const DURATION = __ENV.DURATION || '30s';
const RAMP_UP = __ENV.RAMP_UP || '5s';

// ─── k6 Configuration ───────────────────────────────────────────────────────────

export const options = {
  stages: [
    { duration: RAMP_UP, target: VUS },
    { duration: DURATION, target: VUS },
    { duration: '15s', target: 0 },
  ],
  thresholds: {
    // Latency percentiles (lenient for local dev)
    'http_req_duration': ['p(50)<500', 'p(95)<1000', 'p(99)<2000'],
    // Request failure rate
    'http_req_failed': ['rate<0.10'],
    // Custom error rate
    'errors': ['rate<0.15'],
    // Auth flow duration
    'auth_flow_duration': ['p(95)<1000', 'p(99)<2000'],
    // API response time
    'api_response_time': ['p(95)<500'],
  },
  summaryTimeUnit: 'ms',
  // Enable metrics aggregation for JSON output
  discardResponseBodies: false,
  // TLS settings
  insecureSkipTLSVerify: true,
};

// ─── Default Headers ────────────────────────────────────────────────────────────

const headers = {
  'Content-Type': 'application/json',
};

// ─── Header Helpers ─────────────────────────────────────────────────────────────

/**
 * Get headers with optional API key authentication.
 * @returns {Object} Headers object
 */
function getAuthHeaders() {
  const authHeaders = {
    'Content-Type': 'application/json',
  };
  if (ADMIN_API_KEY) {
    authHeaders['X-API-Key'] = ADMIN_API_KEY;
  }
  return authHeaders;
}

/**
 * Get form-encoded headers for OAuth requests.
 * @returns {Object} Headers object
 */
function getFormHeaders() {
  return {
    'Content-Type': 'application/x-www-form-urlencoded',
  };
}

/**
 * Get headers with Bearer token for OAuth endpoints.
 * @param {string} accessToken - The access token
 * @returns {Object} Headers object
 */
function getBearerHeaders(accessToken) {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
  };
}

// ─── Response Helper ─────────────────────────────────────────────────────────────

/**
 * Check HTTP response and update metrics.
 * @param {Object} res - k6 HTTP response
 * @param {string} context - Context label for metrics
 * @param {Object} tags - Additional tags for metrics
 * @returns {boolean} True if response was successful (2xx)
 */
function checkResponse(res, context = '', tags = {}) {
  const success = res.status >= 200 && res.status < 400;

  // Update counters
  requestCounter.add(1, { context });
  if (success) {
    successCounter.add(1, { context });
  } else {
    failedCounter.add(1, { context, status: res.status });
  }

  // Track error rate
  errorRate.add(!success, { context, ...tags });

  // k6 built-in checks
  check(res, {
    [`${context}: status is 2xx`]: () => success,
    [`${context}: response time < 500ms`]: () => res.timings.duration < 500,
    [`${context}: response time < 1s`]: () => res.timings.duration < 1000,
  });

  return success;
}

// ─── OAuth Endpoints ────────────────────────────────────────────────────────────

/**
 * Build OAuth endpoint URLs for a realm.
 * @param {string} realmName - The realm name
 * @returns {Object} Object containing all OAuth endpoint URLs
 */
function buildOAuthUrls(realmName = 'test-realm') {
  const realmPath = `/realms/${realmName}/protocol/openid-connect`;
  return {
    token: `${TARGET_URL}${realmPath}/token`,
    tokenIntrospect: `${TARGET_URL}${realmPath}/token/introspect`,
    userinfo: `${TARGET_URL}${realmPath}/userinfo`,
    authorize: `${TARGET_URL}${realmPath}/authorize`,
    logout: `${TARGET_URL}${realmPath}/logout`,
    jwks: `${TARGET_URL}${realmPath}/jwk`,
    wellKnown: `${TARGET_URL}${realmPath}/.well-known/openid-configuration`,
  };
}

// ─── Test Client Credentials ────────────────────────────────────────────────────

const TEST_CLIENT_ID = __ENV.TEST_CLIENT_ID || 'test-client';
const TEST_CLIENT_SECRET = __ENV.TEST_CLIENT_SECRET || 'test-client-secret';
const TEST_USERNAME = __ENV.TEST_USERNAME || 'testuser';
const TEST_PASSWORD = __ENV.TEST_PASSWORD || 'TestPassword123!';
const TEST_REALM = __ENV.TEST_REALM || 'test-realm';

// ─── Main Test Function ─────────────────────────────────────────────────────────

export default function () {
  const vuId = String(__VU);

  // Update active VUs gauge
  activeVUsGauge.add(__VU);

  const oauthUrls = buildOAuthUrls(TEST_REALM);

  // ─── Group 1: Health Check Endpoints ──────────────────────────────────────

  group('Health Endpoints', () => {
    // Root health endpoint
    const healthStart = Date.now();
    const healthRes = http.get(`${TARGET_URL}/health`, headers);
    checkResponse(healthRes, 'health_check');
    apiResponseTime.add(Date.now() - healthStart, { endpoint: 'health' });

    sleep(0.5);

    // API health endpoint
    const apiHealthStart = Date.now();
    const apiHealthRes = http.get(`${TARGET_URL}/api/health`, getAuthHeaders());
    checkResponse(apiHealthRes, 'api_health');
    apiResponseTime.add(Date.now() - apiHealthStart, { endpoint: 'api_health' });
  });

  // ─── Group 2: OAuth Discovery ──────────────────────────────────────────────

  group('OAuth Discovery', () => {
    // OpenID Connect discovery document
    const discoveryStart = Date.now();
    const discoveryRes = http.get(oauthUrls.wellKnown, headers);
    if (checkResponse(discoveryRes, 'openid_discovery')) {
      const discovery = JSON.parse(discoveryRes.body);
      check(discovery, {
        'has issuer': () => discovery.issuer !== undefined,
        'has token_endpoint': () => discovery.token_endpoint !== undefined,
        'has authorization_endpoint': () => discovery.authorization_endpoint !== undefined,
      });
    }
    apiResponseTime.add(Date.now() - discoveryStart, { endpoint: 'discovery' });

    sleep(0.5);

    // JWKS endpoint
    const jwksStart = Date.now();
    const jwksRes = http.get(oauthUrls.jwks, headers);
    if (checkResponse(jwksRes, 'jwks')) {
      const jwks = JSON.parse(jwksRes.body);
      check(jwks, {
        'has keys': () => jwks.keys && Array.isArray(jwks.keys),
      });
    }
    apiResponseTime.add(Date.now() - jwksStart, { endpoint: 'jwks' });
  });

  // ─── Group 3: Token Issuance (Client Credentials) ─────────────────────────

  group('Token Issuance', () => {
    const tokenStart = Date.now();

    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: TEST_CLIENT_ID,
      client_secret: TEST_CLIENT_SECRET,
      scope: 'openid',
    });

    const tokenRes = http.post(oauthUrls.token, params.toString(), {
      headers: getFormHeaders(),
      tags: { operation: 'token_issuance' },
    });

    authFlowDuration.add(Date.now() - tokenStart);
    apiResponseTime.add(Date.now() - tokenStart, { endpoint: 'token' });

    if (checkResponse(tokenRes, 'token_issuance')) {
      const tokenData = JSON.parse(tokenRes.body);
      check(tokenData, {
        'has access_token': () => tokenData.access_token !== undefined,
        'has token_type': () => tokenData.token_type === 'Bearer',
        'has expires_in': () => typeof tokenData.expires_in === 'number',
      });

      // Use token for subsequent requests
      const accessToken = tokenData.access_token;

      // ─── Token Introspection ─────────────────────────────────────────────

      sleep(0.5);

      const introspectStart = Date.now();
      const introspectParams = new URLSearchParams({
        token: accessToken,
        client_id: TEST_CLIENT_ID,
        client_secret: TEST_CLIENT_SECRET,
      });

      const introspectRes = http.post(oauthUrls.tokenIntrospect, introspectParams.toString(), {
        headers: getFormHeaders(),
        tags: { operation: 'token_introspection' },
      });

      apiResponseTime.add(Date.now() - introspectStart, { endpoint: 'introspection' });

      if (checkResponse(introspectRes, 'token_introspection')) {
        const introspectData = JSON.parse(introspectRes.body);
        check(introspectData, {
          'is active': () => introspectData.active === true,
        });
      }

      // ─── Userinfo Endpoint ─────────────────────────────────────────────

      sleep(0.5);

      const userinfoStart = Date.now();
      const userinfoRes = http.get(oauthUrls.userinfo, {
        headers: getBearerHeaders(accessToken),
        tags: { operation: 'userinfo' },
      });

      apiResponseTime.add(Date.now() - userinfoStart, { endpoint: 'userinfo' });
      checkResponse(userinfoRes, 'userinfo');
    }
  });

  // ─── Group 4: Password Grant (Login Flow) ──────────────────────────────────

  group('Login Flow', () => {
    const loginStart = Date.now();

    const loginParams = new URLSearchParams({
      grant_type: 'password',
      client_id: TEST_CLIENT_ID,
      client_secret: TEST_CLIENT_SECRET,
      username: TEST_USERNAME,
      password: TEST_PASSWORD,
      scope: 'openid',
    });

    const loginRes = http.post(oauthUrls.token, loginParams.toString(), {
      headers: getFormHeaders(),
      tags: { operation: 'password_grant' },
    });

    authFlowDuration.add(Date.now() - loginStart);
    apiResponseTime.add(Date.now() - loginStart, { endpoint: 'login' });

    if (checkResponse(loginRes, 'login')) {
      const loginData = JSON.parse(loginRes.body);
      check(loginData, {
        'has access_token': () => loginData.access_token !== undefined,
        'has refresh_token': () => loginData.refresh_token !== undefined,
        'has id_token': () => loginData.id_token !== undefined,
      });
    }
  });

  // ─── Group 5: Metrics Endpoint ────────────────────────────────────────────

  group('Metrics', () => {
    const metricsStart = Date.now();
    const metricsRes = http.get(`${TARGET_URL}/metrics`, headers);
    checkResponse(metricsRes, 'metrics');
    apiResponseTime.add(Date.now() - metricsStart, { endpoint: 'metrics' });
  });

  // ─── Think Time ─────────────────────────────────────────────────────────────

  sleep(2);
}

// ─── Setup/Teardown ─────────────────────────────────────────────────────────────

export function setup() {
  console.log(`AuthMe Local Benchmark Configuration:`);
  console.log(`  Target URL: ${TARGET_URL}`);
  console.log(`  VUs: ${VUS}`);
  console.log(`  Duration: ${DURATION}`);
  console.log(`  Ramp-up: ${RAMP_UP}`);
  console.log(`  Environment: local development`);

  // Verify server is reachable
  try {
    const healthRes = http.get(`${TARGET_URL}/health`);
    console.log(`  Server health: ${healthRes.status === 200 ? 'OK' : 'WARNING'}`);
  } catch (e) {
    console.warn('  Warning: Server may not be reachable');
  }

  return { targetUrl: TARGET_URL, vus: VUS, duration: DURATION };
}

export function teardown(data) {
  console.log('Local benchmark run completed.');
  console.log(`  Total requests tracked via metrics`);
}
