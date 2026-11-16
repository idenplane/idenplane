// Seeds Idenplane for the OpenID conformance suite and writes the suite's
// configuration to /work/config.json:
//   realm "conformance", two confidential clients (offline_access optional),
//   one user, and the browser automation the suite drives the hosted pages
//   with (sign-in, consent, the error pages it must screenshot).
import { writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { Idenplane, env, log, assert } from '../lib/idenplane.mjs';

const ISSUER_HOST = 'https://idp.conformance.test';
const REALM = 'conformance';
const CALLBACK = 'https://localhost.emobix.co.uk:8443/test/a/idenplane/callback';
const USER = 'conformance-user';
const PASSWORD = `Conf-${randomBytes(9).toString('base64url')}-sample1!`;

const idp = new Idenplane(ISSUER_HOST, env('ADMIN_API_KEY'));
await idp.waitReady(300_000);

await idp.admin('POST', '/realms', { name: REALM, displayName: 'Conformance', enabled: true });
let scopes = await idp.admin('GET', `/realms/${REALM}/client-scopes`);
if (!Array.isArray(scopes)) scopes = scopes?.data ?? scopes?.items ?? [];
const offline = scopes.find((s) => s.name === 'offline_access');
assert(offline, 'realm has no offline_access client scope');

const secrets = {};
for (const clientId of ['conformance-client-1', 'conformance-client-2']) {
  const c = await idp.admin('POST', `/realms/${REALM}/clients`, {
    clientId,
    name: clientId,
    clientType: 'CONFIDENTIAL',
    enabled: true,
    requireConsent: false,
    redirectUris: [CALLBACK],
    grantTypes: ['authorization_code', 'refresh_token'],
  });
  assert(c.clientSecret, `no secret returned for ${clientId}`);
  secrets[clientId] = c.clientSecret;
  // Newer versions assign offline_access to new clients already (409).
  await idp.admin('POST', `/realms/${REALM}/clients/${clientId}/optional-client-scopes`, { clientScopeId: offline.id }, { expect: [200, 201, 204, 409] });
}
await idp.admin('POST', `/realms/${REALM}/users`, {
  username: USER,
  email: 'conformance.user@example.com',
  firstName: 'Conny',
  lastName: 'Formance',
  enabled: true,
  emailVerified: true,
  password: PASSWORD,
});

const realmUrl = `${ISSUER_HOST}/realms/${REALM}`;
const authUrl = `${realmUrl}/protocol/openid-connect/auth*`;
const verifyComplete = { task: 'Verify Complete', match: '*/test/*/callback*', commands: [['wait', 'id', 'submission_complete', 10]] };
const login = (waitForPage) => ({
  task: 'Login',
  optional: true,
  match: `${realmUrl}/*`,
  commands: [
    ...(waitForPage ? [['wait', 'xpath', '//*', 10, '(?i)sign in', 'update-image-placeholder-optional']] : []),
    ['text', 'id', 'username', USER, 'optional'],
    ['text', 'id', 'password', PASSWORD, 'optional'],
    ['click', 'css', 'button.btn-primary'],
  ],
});
// Shown when the client asks for a scope the user has not granted yet
// (e.g. offline_access): the suite must press "Allow".
const consent = { task: 'Consent', optional: true, match: `${realmUrl}/consent*`, commands: [['click', 'css', 'button[value=grant]']] };
const errorPage = {
  browser: [
    {
      comment: 'expect an immediate error page',
      match: authUrl,
      tasks: [
        {
          task: 'Expect an error page',
          match: authUrl,
          commands: [['wait', 'xpath', '//*', 10, 'sign-in request', 'update-image-placeholder']],
        },
      ],
    },
  ],
};
const secondLogin = { browser: [{ match: authUrl, tasks: [login(true), consent, verifyComplete] }] };

const config = {
  alias: 'idenplane',
  description: 'Idenplane (scheduled conformance run)',
  server: { discoveryUrl: `${realmUrl}/.well-known/openid-configuration` },
  client: { client_id: 'conformance-client-1', client_secret: secrets['conformance-client-1'] },
  client2: { client_id: 'conformance-client-2', client_secret: secrets['conformance-client-2'] },
  client_secret_post: { client_id: 'conformance-client-1', client_secret: secrets['conformance-client-1'] },
  browser: [{ match: authUrl, tasks: [login(false), consent, verifyComplete] }],
  override: {
    'oidcc-prompt-login': secondLogin,
    'oidcc-max-age-1': secondLogin,
    'oidcc-ensure-registered-redirect-uri': errorPage,
    'oidcc-ensure-redirect-uri-in-authorization-request': errorPage,
    'oidcc-redirect-uri-query-added': errorPage,
    'oidcc-redirect-uri-query-mismatch': errorPage,
    'oidcc-response-type-missing': errorPage,
    'oidcc-ensure-request-object-with-redirect-uri': errorPage,
  },
};
writeFileSync('/work/config.json', JSON.stringify(config, null, 2));
log('conformance realm seeded; suite config written');
