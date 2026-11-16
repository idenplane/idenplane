// Checks that what seed.mjs stored still works on the server now in front of
// the database: after a restore into a fresh database, or after an upgrade to
// a newer image. Run with the SAME WEBHOOK_SECRET_KEY / WEBHOOK_ENCRYPTION_SALT
// the data was written with.
//
//   IDENPLANE_URL, ADMIN_API_KEY, STATE_FILE   (as for seed.mjs)
//   VERIFY_LABEL   free text for the log, e.g. "after restore"
import { readFileSync, writeFileSync } from 'node:fs';
import { createPublicKey, verify as verifySig } from 'node:crypto';
import { Idenplane, env, log, assert, decodeJwt, markTotpStepUsed } from '../lib/idenplane.mjs';

const idp = new Idenplane(env('IDENPLANE_URL'), env('ADMIN_API_KEY'));
const stateFile = env('STATE_FILE');
const label = process.env.VERIFY_LABEL ?? 'verify';
const s = JSON.parse(readFileSync(stateFile, 'utf8'));
if (s.lastTotpStep) markTotpStepUsed(s.lastTotpStep);

const checks = [];
async function check(name, fn) {
  try {
    await fn();
    checks.push({ name, ok: true });
    log(`PASS ${name}`);
  } catch (e) {
    checks.push({ name, ok: false, error: e.message });
    log(`FAIL ${name}: ${e.message}`);
  }
}

/** Verifies a JWT's signature against the JWKS captured BEFORE the backup. */
function verifyWithKeys(token, jwks) {
  const { header } = decodeJwt(token);
  const jwk = jwks.find((k) => k.kid === header.kid);
  assert(jwk, `kid ${header.kid} is not one of the keys from before (${jwks.map((k) => k.kid).join(', ')})`);
  const [h, p, sig] = token.split('.');
  const alg = header.alg;
  const hash = { RS256: 'sha256', PS256: 'sha256', ES256: 'sha256', RS384: 'sha384', RS512: 'sha512', ES384: 'sha384' }[alg];
  assert(hash, `unsupported alg ${alg}`);
  const key = createPublicKey({ key: jwk, format: 'jwk' });
  const opts = alg.startsWith('PS')
    ? { key, padding: 6 /* RSA_PKCS1_PSS_PADDING */, saltLength: 32 }
    : alg.startsWith('ES')
      ? { key, dsaEncoding: 'ieee-p1363' }
      : key;
  const ok = verifySig(hash, Buffer.from(`${h}.${p}`), opts, Buffer.from(sig, 'base64url'));
  assert(ok, `signature of a ${alg} token does not verify with the key from before`);
}

await idp.waitReady();
log(`${label}: verifying realm ${s.realm} on ${idp.baseUrl}`);

let jwksNow = [];
await check('signing keys survived (same kids in JWKS)', async () => {
  jwksNow = await idp.jwks(s.realm);
  const now = jwksNow.map((k) => k.kid);
  for (const kid of s.kids) assert(now.includes(kid), `kid ${kid} missing; now ${now.join(', ')}`);
});

await check('client secret still authenticates (client_credentials)', async () => {
  const cc = await idp.clientCredentials(s.realm, s.clientId, s.clientSecret);
  assert(cc.status === 200, `${cc.status} ${cc.text.slice(0, 200)}`);
  verifyWithKeys(cc.json.access_token, jwksNow.filter((k) => s.kids.includes(k.kid)));
});

await check('a wrong client secret is still refused', async () => {
  const bad = await idp.clientCredentials(s.realm, s.clientId, `${s.clientSecret}x`);
  assert(bad.status === 401 || bad.status === 400, `expected 401, got ${bad.status}`);
});

await check('refresh token from before is accepted', async () => {
  const r = await idp.refresh(s.realm, s.clientId, s.clientSecret, s.refreshToken);
  assert(r.status === 200, `${r.status} ${r.text.slice(0, 200)}`);
  if (r.json.refresh_token) s.refreshToken = r.json.refresh_token;
});

await check('password sign-in (alice, hosted pages, code + PKCE)', async () => {
  const { tokens } = await idp.browserSignIn({ realm: s.realm, clientId: s.clientId, clientSecret: s.clientSecret, redirectUri: s.redirectUri, username: 'alice', password: s.users.alice.password });
  verifyWithKeys(tokens.id_token, jwksNow);
  const intro = await idp.introspect(s.realm, s.clientId, s.clientSecret, tokens.access_token);
  assert(intro.json?.active === true, `introspection: ${intro.text.slice(0, 200)}`);
});

await check('password + TOTP sign-in (bob; TOTP secret decrypts)', async () => {
  const { tokens } = await idp.browserSignIn({ realm: s.realm, clientId: s.clientId, clientSecret: s.clientSecret, redirectUri: s.redirectUri, username: 'bob', password: s.users.bob.password, totpSecret: s.users.bob.totpSecret });
  verifyWithKeys(tokens.id_token, jwksNow);
  const claims = decodeJwt(tokens.id_token).payload;
  assert(claims.preferred_username === 'bob' || claims.sub === s.users.bob.id, `id_token is not bob's: ${JSON.stringify(claims).slice(0, 200)}`);
});

await check('users are all there', async () => {
  for (const [name, u] of Object.entries(s.users)) {
    const got = await idp.admin('GET', `/realms/${s.realm}/users/${u.id}`);
    assert(got.username === name, `user ${name} (${u.id}) missing`);
  }
});

const { lastTotpStep } = await import('../lib/idenplane.mjs');
s.lastTotpStep = lastTotpStep();
writeFileSync(stateFile, JSON.stringify(s, null, 2));

const failed = checks.filter((c) => !c.ok);
if (process.env.GITHUB_STEP_SUMMARY) {
  const rows = checks.map((c) => `| ${c.ok ? 'PASS' : '**FAIL**'} | ${c.name} | ${c.error ? c.error.replace(/[\\|]/g, '\\$&').replace(/\r?\n/g, ' ').slice(0, 200) : ''} |`);
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${label}\n\n| Result | Check | Detail |\n|---|---|---|\n${rows.join('\n')}\n\n`, { flag: 'a' });
}
if (failed.length) {
  log(`${label}: ${failed.length} of ${checks.length} checks FAILED`);
  process.exit(1);
}
log(`${label}: all ${checks.length} checks passed`);
