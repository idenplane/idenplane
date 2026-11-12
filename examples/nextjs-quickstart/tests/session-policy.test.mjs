import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { SessionCipher, newSessionId } from '../lib/session/crypto.ts';
import { browserSessionPolicy, sameOriginPost, readSessionCookie, sessionCookie, clearSessionCookie } from '../lib/session/browser-policy.ts';

const policy = browserSessionPolicy('https://app.example.com');
test('production cookies are opaque, host-only, HttpOnly and Secure',()=>{
  const id=newSessionId(),cookie=sessionCookie(policy,'session',id,3600);
  assert.match(cookie,/^__Host-idenplane_session=/);assert.match(cookie,/; Secure/);assert.match(cookie,/; HttpOnly/);assert.match(cookie,/; Path=\//);assert.match(cookie,/; SameSite=Lax/);assert.doesNotMatch(cookie,/Domain=/);
  const request=new Request(policy.origin,{headers:{cookie:policy.sessionName+'='+id}});assert.equal(readSessionCookie(request,policy.sessionName),id);
});
test('HTTP is denied unless loopback development is explicitly enabled',()=>{
  assert.throws(()=>browserSessionPolicy('http://localhost:3001'));
  assert.equal(browserSessionPolicy('http://localhost:3001',true).secure,false);
  assert.equal(browserSessionPolicy('http://[::1]:3001',true).secure,false);
  assert.throws(()=>browserSessionPolicy('http://example.com',true));
});
for(const origin of ['https://user:password@app.example.com','https://app.example.com/path','https://app.example.com/?x=1','https://app.example.com/#fragment'])test('rejects ambiguous application origin '+origin,()=>{assert.throws(()=>browserSessionPolicy(origin));});
test('cookie clearing uses the same host-bound name and security attributes',()=>{
  const cleared=clearSessionCookie(policy,'session');assert.match(cleared,/^__Host-idenplane_session=/);assert.match(cleared,/Max-Age=0/);assert.match(cleared,/HttpOnly/);assert.match(cleared,/Secure/);assert.doesNotMatch(cleared,/Domain=/);
});
test('duplicate cookies cannot choose a different session',()=>{
  const id=newSessionId();assert.equal(readSessionCookie(new Request(policy.origin,{headers:{cookie:`${policy.sessionName}=${id}; ${policy.sessionName}=${newSessionId()}`}}),policy.sessionName),null);
});
test('session IDs in headers or URL parameters are ignored',()=>{
  const id=newSessionId();assert.equal(readSessionCookie(new Request(policy.origin+'/?session='+id,{headers:{authorization:'Bearer '+id,'x-session-id':id}}),policy.sessionName),null);
});
test('malformed cookie and header injection inputs are rejected',()=>{
  assert.equal(readSessionCookie(new Request(policy.origin,{headers:{cookie:policy.sessionName+'=not-a-session'}}),policy.sessionName),null);
  assert.throws(()=>sessionCookie(policy,'session','x\r\nInjected: y',3600));
});
test('login and logout require same-origin POST',()=>{
  assert.equal(sameOriginPost(new Request(policy.origin,{method:'POST',headers:{origin:policy.origin,'sec-fetch-site':'same-origin'}}),policy),true);
  for(const headers of [{},{origin:'null'},{origin:'https://attacker.example.com'},{origin:policy.origin,'sec-fetch-site':'cross-site'}])assert.equal(sameOriginPost(new Request(policy.origin,{method:'POST',headers}),policy),false);
  assert.equal(sameOriginPost(new Request(policy.origin,{headers:{origin:policy.origin}}),policy),false);
});
test('encryption uses a fresh nonce and binds credentials to their session',()=>{
  const cipher=new SessionCipher(randomBytes(32)),value={refreshToken:'private'},first=cipher.seal(value,'session:a'),second=cipher.seal(value,'session:a');assert.notEqual(first,second);assert.deepEqual(cipher.open(first,'session:a'),value);assert.throws(()=>cipher.open(first,'session:b'));assert.throws(()=>cipher.open(first,'login:a'));
});
test('wrong keys and tampered ciphertext fail closed',()=>{
  const cipher=new SessionCipher(randomBytes(32)),value=cipher.seal({accessToken:'private'},'session:a');
  assert.throws(()=>new SessionCipher(randomBytes(32)).open(value,'session:a'));
  const bytes=Buffer.from(value,'base64url');bytes[bytes.length-1]^=1;assert.throws(()=>cipher.open(bytes.toString('base64url'),'session:a'));assert.throws(()=>new SessionCipher(randomBytes(16)));
});
