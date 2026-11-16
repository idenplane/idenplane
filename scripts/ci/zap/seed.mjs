// Seeds what the ZAP scans need and writes it to /out for run-zap.sh:
//   - realm "zap" with self-registration on, a confidential client and a user;
//   - realm "zapapi", the realm the API scan's {realmName} paths point at;
//   - targets.env: the hosted-page URLs to scan (login, registration);
//   - session-cookie.txt: a signed-in session for the account page.
import { writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { Idenplane, CookieJar, env, log } from '../lib/idenplane.mjs';

const base = env('IDENPLANE_URL');
const idp = new Idenplane(base, env('ADMIN_API_KEY'));
const redirectUri = 'http://localhost/zap/callback';
const password = `Zap-${randomBytes(9).toString('base64url')}-sample`;

await idp.waitReady();
for (const name of ['zap', 'zapapi']) {
  await idp.admin('POST', '/realms', {
    name,
    displayName: `DAST ${name}`,
    enabled: true,
    registrationAllowed: true,
    rateLimitEnabled: false,
    bruteForceEnabled: false,
  });
}
const client = await idp.admin('POST', '/realms/zap/clients', {
  clientId: 'zap-app',
  name: 'DAST app',
  clientType: 'CONFIDENTIAL',
  enabled: true,
  requireConsent: false,
  redirectUris: [redirectUri],
  grantTypes: ['authorization_code', 'refresh_token'],
});
await idp.admin('POST', '/realms/zap/users', {
  username: 'zapuser',
  email: 'zapuser@example.com',
  firstName: 'Zap',
  lastName: 'User',
  enabled: true,
  emailVerified: true,
  password,
});

const oauth = new URLSearchParams({
  client_id: 'zap-app',
  redirect_uri: redirectUri,
  response_type: 'code',
  scope: 'openid profile email',
  state: 'zapstate',
});
const jar = new CookieJar();
await idp.browserSignIn({
  realm: 'zap',
  clientId: 'zap-app',
  clientSecret: client.clientSecret,
  redirectUri,
  username: 'zapuser',
  password,
  jar,
});
const session = jar.get('IDENPLANE_SESSION');
if (!session) throw new Error('no IDENPLANE_SESSION cookie after sign-in');

writeFileSync('/out/session-cookie.txt', `IDENPLANE_SESSION=${session}`);
writeFileSync(
  '/out/targets.env',
  [
    `LOGIN_URL='${base}/realms/zap/protocol/openid-connect/auth?${oauth}'`,
    `REGISTER_URL='${base}/realms/zap/register?${oauth}'`,
    `ACCOUNT_URL='${base}/realms/zap/account'`,
  ].join('\n') + '\n',
);
log('ZAP targets seeded');
