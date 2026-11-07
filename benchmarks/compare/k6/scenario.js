// One k6 scenario against any server that speaks Keycloak-style realm paths
// (/realms/{realm}/protocol/openid-connect/...), which Idenplane and Keycloak
// both serve. The same requests, checks and load shape for every target.
//
//   SCENARIO   discovery | jwks | client_credentials | password | introspect
//   BASE_URL   e.g. http://target:3000
//   REALM, CLIENT_ID, CLIENT_SECRET, USERNAME, PASSWORD
//   VUS, DURATION
import http from 'k6/http';
import { check } from 'k6';

const env = (name, fallback) => {
  const v = __ENV[name];
  if (v === undefined || v === '') {
    if (fallback === undefined) throw new Error(`${name} is required`);
    return fallback;
  }
  return v;
};

const SCENARIO = env('SCENARIO');
const BASE = `${env('BASE_URL')}/realms/${env('REALM', 'benchmark')}`;
const OIDC = `${BASE}/protocol/openid-connect`;
const CLIENT_ID = env('CLIENT_ID', 'benchmark-client');
const CLIENT_SECRET = __ENV.CLIENT_SECRET || '';

export const options = {
  vus: Number(env('VUS', '32')),
  duration: env('DURATION', '60s'),
  // Connection reuse is what real relying parties do; keep it on.
  noConnectionReuse: false,
  discardResponseBodies: false,
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
};

// k6's JavaScript runtime has no URLSearchParams.
const form = (fields) =>
  Object.keys(fields)
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(fields[k]))}`)
    .join('&');

const FORM = { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } };

const json = (res) => {
  try {
    return res.json();
  } catch {
    return null;
  }
};

const clientCredentials = () =>
  http.post(
    `${OIDC}/token`,
    form({ grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
    FORM,
  );

const passwordGrant = () =>
  http.post(
    `${OIDC}/token`,
    form({
      grant_type: 'password',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      username: env('USERNAME', 'benchuser'),
      password: env('PASSWORD'),
      scope: 'openid',
    }),
    FORM,
  );

const introspect = (token) =>
  http.post(
    `${OIDC}/token/introspect`,
    form({ token, client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
    FORM,
  );

// Introspects a user's access token (the common case for a resource server)
// and proves the request works once before any load, printing the response
// if it doesn't, so a misconfigured target fails loudly instead of being
// measured.
export function setup() {
  if (SCENARIO !== 'introspect') return {};
  const res = passwordGrant();
  const body = json(res);
  if (res.status !== 200 || !body || !body.access_token) {
    throw new Error(`setup: password grant failed (HTTP ${res.status}): ${String(res.body).slice(0, 300)}`);
  }
  const probe = introspect(body.access_token);
  if (probe.status !== 200 || (json(probe) || {}).active !== true) {
    throw new Error(`setup: introspection did not return active=true (HTTP ${probe.status}): ${String(probe.body).slice(0, 300)}`);
  }
  return { token: body.access_token };
}

const scenarios = {
  discovery: () => {
    const res = http.get(`${BASE}/.well-known/openid-configuration`);
    return check(res, {
      'discovery 200 with issuer': (r) => r.status === 200 && !!(json(r) || {}).issuer,
    });
  },

  jwks: () => {
    const res = http.get(`${OIDC}/certs`);
    return check(res, {
      'jwks 200 with keys': (r) => r.status === 200 && ((json(r) || {}).keys || []).length > 0,
    });
  },

  client_credentials: () =>
    check(clientCredentials(), {
      'client_credentials 200 with token': (r) => r.status === 200 && !!(json(r) || {}).access_token,
    }),

  password: () =>
    check(passwordGrant(), {
      'password 200 with token': (r) => r.status === 200 && !!(json(r) || {}).access_token,
    }),

  introspect: (data) =>
    check(introspect(data.token), {
      'introspect 200 active': (r) => r.status === 200 && (json(r) || {}).active === true,
    }),
};

if (!scenarios[SCENARIO]) {
  throw new Error(`Unknown SCENARIO "${SCENARIO}"; expected one of ${Object.keys(scenarios).join(', ')}`);
}

export default function (data) {
  scenarios[SCENARIO](data);
}
