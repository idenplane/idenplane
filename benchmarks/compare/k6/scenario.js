// One k6 scenario against any OpenID Connect server. The same requests,
// checks and load shape for every target; only where each endpoint lives and
// how the client authenticates differ, and both default to the Keycloak-style
// realm paths (/realms/{realm}/protocol/openid-connect/...) that Idenplane and
// Keycloak serve.
//
//   SCENARIO   discovery | jwks | client_credentials | password | introspect
//   BASE_URL   e.g. http://target:3000
//   REALM, CLIENT_ID, CLIENT_SECRET, USERNAME, PASSWORD
//   VUS, DURATION
//
// Per-server shape (all optional):
//   DISCOVERY_PATH, JWKS_PATH, TOKEN_PATH, INTROSPECT_PATH   paths on BASE_URL
//   CLIENT_AUTH        post (default) | basic: how the token endpoint gets the client's credentials
//   TOKEN_SCOPE        scope sent with client_credentials (default: none)
//   INTROSPECT_CLIENT_ID / INTROSPECT_CLIENT_SECRET   who calls introspection (default: the client)
//   INTROSPECT_AUTH    post | basic (default: CLIENT_AUTH)
//   INTROSPECT_TOKEN_GRANT  password (default) | client_credentials: which token introspection checks
import http from 'k6/http';
import { check } from 'k6';
import encoding from 'k6/encoding';

const env = (name, fallback) => {
  const v = __ENV[name];
  if (v === undefined || v === '') {
    if (fallback === undefined) throw new Error(`${name} is required`);
    return fallback;
  }
  return v;
};

const SCENARIO = env('SCENARIO');
const BASE_URL = env('BASE_URL');
const REALM_PATH = `/realms/${env('REALM', 'benchmark')}`;
const OIDC_PATH = `${REALM_PATH}/protocol/openid-connect`;
const URLS = {
  discovery: BASE_URL + env('DISCOVERY_PATH', `${REALM_PATH}/.well-known/openid-configuration`),
  jwks: BASE_URL + env('JWKS_PATH', `${OIDC_PATH}/certs`),
  token: BASE_URL + env('TOKEN_PATH', `${OIDC_PATH}/token`),
  introspect: BASE_URL + env('INTROSPECT_PATH', `${OIDC_PATH}/token/introspect`),
};
const CLIENT_ID = env('CLIENT_ID', 'benchmark-client');
const CLIENT_SECRET = __ENV.CLIENT_SECRET || '';
const CLIENT_AUTH = env('CLIENT_AUTH', 'post');
const TOKEN_SCOPE = __ENV.TOKEN_SCOPE || '';
const INTROSPECT_CLIENT_ID = env('INTROSPECT_CLIENT_ID', CLIENT_ID);
const INTROSPECT_CLIENT_SECRET = env('INTROSPECT_CLIENT_SECRET', CLIENT_SECRET);
const INTROSPECT_AUTH = env('INTROSPECT_AUTH', CLIENT_AUTH);
const INTROSPECT_TOKEN_GRANT = env('INTROSPECT_TOKEN_GRANT', 'password');
for (const [name, v] of [['CLIENT_AUTH', CLIENT_AUTH], ['INTROSPECT_AUTH', INTROSPECT_AUTH]]) {
  if (v !== 'post' && v !== 'basic') throw new Error(`${name} must be post or basic, not "${v}"`);
}

// PREFLIGHT: three requests from one VU, and the run fails unless all pass.
export const options = __ENV.PREFLIGHT ? {
  vus: 1,
  iterations: 3,
  thresholds: { checks: ['rate==1'] },
} : {
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

const FORM_TYPE = { 'Content-Type': 'application/x-www-form-urlencoded' };

// A form request authenticated as a client, the way the server expects it:
// credentials in the body (client_secret_post) or in an Authorization header
// (client_secret_basic, RFC 6749 §2.3.1: each part form-encoded first).
const clientPost = (url, fields, auth, id, secret) => {
  if (auth === 'basic') {
    const basic = encoding.b64encode(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`);
    return http.post(url, form(fields), { headers: { ...FORM_TYPE, Authorization: `Basic ${basic}` } });
  }
  return http.post(url, form({ ...fields, client_id: id, client_secret: secret }), { headers: FORM_TYPE });
};

const json = (res) => {
  try {
    return res.json();
  } catch {
    return null;
  }
};

const clientCredentials = () =>
  clientPost(
    URLS.token,
    { grant_type: 'client_credentials', ...(TOKEN_SCOPE ? { scope: TOKEN_SCOPE } : {}) },
    CLIENT_AUTH,
    CLIENT_ID,
    CLIENT_SECRET,
  );

const passwordGrant = () =>
  clientPost(
    URLS.token,
    {
      grant_type: 'password',
      username: env('USERNAME', 'benchuser'),
      password: env('PASSWORD'),
      scope: 'openid',
    },
    CLIENT_AUTH,
    CLIENT_ID,
    CLIENT_SECRET,
  );

const introspect = (token) =>
  clientPost(URLS.introspect, { token }, INTROSPECT_AUTH, INTROSPECT_CLIENT_ID, INTROSPECT_CLIENT_SECRET);

// Introspects an access token, by default a user's (the common case for a
// resource server; a server without a password grant uses a machine token,
// and the results say so), and proves the request works once before any
// load, printing the response if it doesn't, so a misconfigured target fails
// loudly instead of being measured.
export function setup() {
  if (SCENARIO !== 'introspect') return {};
  const res = INTROSPECT_TOKEN_GRANT === 'client_credentials' ? clientCredentials() : passwordGrant();
  const body = json(res);
  if (res.status !== 200 || !body || !body.access_token) {
    throw new Error(`setup: ${INTROSPECT_TOKEN_GRANT} grant failed (HTTP ${res.status}): ${String(res.body).slice(0, 300)}`);
  }
  const probe = introspect(body.access_token);
  if (probe.status !== 200 || (json(probe) || {}).active !== true) {
    throw new Error(`setup: introspection did not return active=true (HTTP ${probe.status}): ${String(probe.body).slice(0, 300)}`);
  }
  return { token: body.access_token };
}

const scenarios = {
  discovery: () => {
    const res = http.get(URLS.discovery);
    return check(res, {
      'discovery 200 with issuer': (r) => r.status === 200 && !!(json(r) || {}).issuer,
    });
  },

  jwks: () => {
    const res = http.get(URLS.jwks);
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
