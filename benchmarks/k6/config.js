import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const authFlowDuration = new Trend('auth_flow_duration');
const apiResponseTime = new Trend('api_response_time');

// Environment variables with defaults
const TARGET_URL = __ENV.TARGET_URL || 'http://localhost:3000';
const ADMIN_API_KEY = __ENV.ADMIN_API_KEY || '';
const VUS = parseInt(__ENV.VUS || '50', 10);
const DURATION = __ENV.DURATION || '60s';
const RAMP_UP = __ENV.RAMP_UP || '10s';

// Export configuration
export const options = {
  stages: [
    { duration: RAMP_UP, target: VUS },
    { duration: DURATION, target: VUS },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    'http_req_duration': ['p(95)<500'],
    'http_req_failed': ['rate<0.05'],
    'errors': ['rate<0.1'],
  },
  summaryTimeUnit: 'ms',
  insecureSkipTLSVerify: false,
};

// Default headers
const headers = {
  'Content-Type': 'application/json',
};

// API key header helper
function getAuthHeaders() {
  return {
    ...headers,
    'X-API-Key': ADMIN_API_KEY,
  };
}

// Check response helper
function checkResponse(res, context = '') {
  const success = res.status >= 200 && res.status < 400;
  errorRate.add(!success, { context });

  check(res, {
    [`${context}: status is 2xx`]: () => success,
    [`${context}: response time < 500ms`]: () => res.timings.duration < 500,
  });

  return success;
}

export default function () {
  // Health check endpoint
  group('Health Check', () => {
    const res = http.get(`${TARGET_URL}/health`, headers);
    checkResponse(res, 'health_check');
    sleep(1);
  });

  // API health endpoint
  group('API Health', () => {
    const res = http.get(`${TARGET_URL}/api/health`, getAuthHeaders());
    checkResponse(res, 'api_health');
    sleep(1);
  });

  // Simulate auth flow timing
  group('Auth Flow', () => {
    const start = Date.now();
    // Placeholder for auth flow test
    const res = http.get(`${TARGET_URL}/api/v1/realms`, getAuthHeaders());
    checkResponse(res, 'realms_list');
    authFlowDuration.add(Date.now() - start);
  });

  // Metrics endpoint
  group('Metrics', () => {
    const res = http.get(`${TARGET_URL}/metrics`, headers);
    checkResponse(res, 'metrics');
  });

  sleep(2);
}