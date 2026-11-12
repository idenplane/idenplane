import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createProfileHandler } from '../lib/server-profile.ts';

const issuer = 'https://auth.example.com/realms/example', audience = 'profile-app';
let privateKey, otherKey, handler;
before(async () => {
  const pair = await generateKeyPair('RS256'); privateKey = pair.privateKey;
  otherKey = (await generateKeyPair('RS256')).privateKey;
  handler = createProfileHandler({ issuer, audience }, createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), kid: 'profile-test', alg: 'RS256' }] }));
});
async function token(overrides = {}, signingKey = privateKey) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ iss: issuer, aud: audience, sub: 'alice', azp: audience, typ: 'Bearer', scope: 'openid profile email', iat: now, exp: now + 300, preferred_username: 'alice', name: 'Alice', email: 'alice@example.com', sid: 'private-session', private_claim: 'never-return', ...overrides })
    .setProtectedHeader({ alg: 'RS256', kid: 'profile-test' }).sign(signingKey);
}
async function request(value, userId = 'alice', extra = {}) {
  return handler(new Request('https://app.example.com/api/users/'+userId+'/profile', { headers: { ...extra, ...(value ? { authorization: 'Bearer '+value } : {}) } }), userId);
}
test('returns only allowlisted claims for the verified owner, without caching', async () => {
  const response = await request(await token()); assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{ profile: { id: 'alice', username: 'alice', name: 'Alice', email: 'alice@example.com' } });
  assert.equal(response.headers.get('cache-control'),'private, no-store');
  assert.equal(response.headers.get('vary'),'Authorization');
});
test('rejects reading another user even with a valid signature', async () => {
  const response=await request(await token(), 'bob');assert.equal(response.status,403);
  assert.deepEqual(await response.json(),{error:'forbidden'});
  assert.match(response.headers.get('cache-control'),/no-store/);
});
test('does not treat cookies or identity headers as authentication', async () => {
  const response=await request(undefined,'alice',{cookie:'idenplane_access_token='+await token(),'x-user-id':'alice'});
  assert.equal(response.status,401);assert.equal(response.headers.get('www-authenticate'),'Bearer');
});
test('rejects a token signed with another key', async () => { assert.equal((await request(await token({},otherKey))).status,401); });
for (const [name,claims] of Object.entries({
  issuer:{iss:'https://auth.example.com/realms/other'},audience:{aud:'other-app'},authorizedParty:{azp:'other-app'},idToken:{typ:'ID'},
  expired:{exp:1},missingExpiry:{exp:undefined},missingIssuedAt:{iat:undefined},missingSubject:{sub:undefined},emptySubject:{sub:''},missingParty:{azp:undefined},futureNotBefore:{nbf:Math.floor(Date.now()/1000)+3600},
})) test('rejects invalid claim: '+name, async () => {
  const response=await request(await token(claims));assert.equal(response.status,401);
  assert.deepEqual(await response.json(),{error:'unauthorized'});
});
test('requires profile scope even for the owner', async()=>{ assert.equal((await request(await token({scope:'openid'}))).status,403); });
test('omits email when email scope was not granted',async()=>{
  const response=await request(await token({scope:'openid profile'}));assert.equal(response.status,200);
  assert.equal((await response.json()).profile.email,undefined);
});
for(const value of ['broken-token','eyJhbGciOiJub25lIn0.eyJzdWIiOiJhbGljZSJ9.']) test('rejects malformed/unsigned JWT: '+value.slice(0,12),async()=>{assert.equal((await request(value)).status,401);});
test('does not accept a token in the URL',async()=>{
  const response=await handler(new Request('https://app.example.com/api/users/alice/profile?access_token='+await token()),'alice');
  assert.equal(response.status,401);
});
