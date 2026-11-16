// Seeds the data the restore drill and the upgrade test must carry across:
// a realm, a confidential client (its secret), two users, one of them with an
// authenticator app (TOTP secret, encrypted at rest with WEBHOOK_SECRET_KEY),
// and a refresh token for a live session. Proves every one of them works
// before the backup / upgrade, then writes what verify.mjs needs to STATE_FILE.
//
//   IDENPLANE_URL   e.g. http://idenplane:3000
//   ADMIN_API_KEY
//   STATE_FILE      where to write the state (throwaway secrets; never upload)
import { writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import {
  Idenplane,
  CookieJar,
  env,
  log,
  assert,
  decodeJwt,
  extractTotpSecret,
  freshTotp,
  lastTotpStep,
} from '../lib/idenplane.mjs';

const idp = new Idenplane(env('IDENPLANE_URL'), env('ADMIN_API_KEY'));
const stateFile = env('STATE_FILE');
const realm = process.env.DRILL_REALM ?? 'drill';
const clientId = 'drill-app';
const redirectUri = 'http://localhost/drill/callback';
const pw = () => `Drill-${randomBytes(9).toString('base64url')}-sample`;

await idp.waitReady();
log(`seeding realm ${realm} on ${idp.baseUrl}`);

await idp.admin('POST', '/realms', {
  name: realm,
  displayName: 'Restore drill',
  enabled: true,
  rateLimitEnabled: false,
  bruteForceEnabled: false,
});

const client = await idp.admin('POST', `/realms/${realm}/clients`, {
  clientId,
  name: 'Drill app',
  clientType: 'CONFIDENTIAL',
  enabled: true,
  requireConsent: false,
  redirectUris: [redirectUri],
  grantTypes: ['authorization_code', 'refresh_token', 'client_credentials'],
});
const clientSecret = client.clientSecret;
assert(clientSecret, 'client create returned no clientSecret');

const users = {
  alice: { password: pw() },
  bob: { password: pw() },
};
for (const [username, u] of Object.entries(users)) {
  const created = await idp.admin('POST', `/realms/${realm}/users`, {
    username,
    email: `${username}@example.com`,
    firstName: username,
    lastName: 'Drill',
    enabled: true,
    emailVerified: true,
    password: u.password,
  });
  u.id = created.id;
}

// bob enrols an authenticator app through the account page, the way a user does.
const bobJar = new CookieJar();
await idp.browserSignIn({ realm, clientId, clientSecret, redirectUri, username: 'bob', password: users.bob.password, jar: bobJar });
const setup = await idp.browse(bobJar, 'GET', `/realms/${realm}/account/totp-setup`);
assert(setup.status === 200, `totp-setup page returned ${setup.status}`);
const totpSecret = extractTotpSecret(setup.text);
assert(totpSecret, 'no TOTP secret on the setup page');
const csrf = /name="_csrf" value="([^"]+)"/.exec(setup.text.slice(setup.text.indexOf('account/totp-setup')))?.[1];
const activate = await idp.browse(bobJar, 'POST', `/realms/${realm}/account/totp-setup`, {
  _csrf: csrf,
  code: await freshTotp(totpSecret),
});
assert([200, 201, 302, 303].includes(activate.status), `TOTP activation returned ${activate.status}`);
assert(!/Invalid code/i.test(activate.text), 'TOTP activation rejected the code');
assert(!/error=/.test(activate.location ?? ''), `TOTP activation failed: ${activate.location}`);
users.bob.totpSecret = totpSecret;
log('bob enrolled TOTP');

// Everything the verifier will check, proven once here.
const jwks = await idp.jwks(realm);
const kids = jwks.map((k) => k.kid);
const cc = await idp.clientCredentials(realm, clientId, clientSecret);
assert(cc.status === 200, `client_credentials failed: ${cc.status} ${cc.text}`);
assert(kids.includes(decodeJwt(cc.json.access_token).header.kid), 'token kid not in JWKS');

const alice = await idp.browserSignIn({ realm, clientId, clientSecret, redirectUri, username: 'alice', password: users.alice.password });
assert(alice.tokens.refresh_token, 'alice got no refresh token');
const bob = await idp.browserSignIn({ realm, clientId, clientSecret, redirectUri, username: 'bob', password: users.bob.password, totpSecret });
assert(bob.tokens.id_token, 'bob got no id_token');
log('pre-backup sign-ins (password, password+TOTP, client_credentials) work');

writeFileSync(
  stateFile,
  JSON.stringify(
    {
      realm,
      clientId,
      clientSecret,
      redirectUri,
      users,
      kids,
      refreshToken: alice.tokens.refresh_token,
      lastTotpStep: lastTotpStep(),
    },
    null,
    2,
  ),
);
log(`state written to ${stateFile}`);
