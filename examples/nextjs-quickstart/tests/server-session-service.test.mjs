import { test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { newSessionId } from '../lib/session/crypto.ts';
import { createServerSessionService } from '../lib/session/service.ts';

const originalFetch=globalThis.fetch,origin='https://app.example.com',issuer='https://auth.example.com/realms/test';
let privateKey,keys;
before(async()=>{const pair=await generateKeyPair('RS256');privateKey=pair.privateKey;keys=createLocalJWKSet({keys:[{...await exportJWK(pair.publicKey),kid:'test',alg:'RS256'}]});});
afterEach(()=>{globalThis.fetch=originalFetch;});
function fixture(){
  const transactions=new Map(),sessions=new Map(),flags={},calls=[];let nonce;
  const store={
    async createLogin(data,state){const id=newSessionId();transactions.set(id,{data,state});return id;},
    async consumeLogin(id,state){const found=transactions.get(id);if(!found||found.state!==state)return null;transactions.delete(id);return found.data;},
    async createSession(data){const id=newSessionId();sessions.set(id,data);return id;},
    async withSession(id,work){const data=sessions.get(id);if(!data)return null;const next=await work(data);if(next.data)sessions.set(id,next.data);return next.value;},
    async revokeSession(id){if(flags.databaseFailure)throw Error('database unavailable');const data=sessions.get(id);sessions.delete(id);return data??null;},
  };
  globalThis.fetch=async(url,init)=>{
    calls.push({url,body:init.body});
    if(url.endsWith('/logout'))return new Response(null,{status:flags.logoutFailure?503:204});
    if(init.body.get('grant_type')==='refresh_token'&&flags.refreshStatus)return Response.json({error:'provider_error'},{status:flags.refreshStatus});
    const now=Math.floor(Date.now()/1000),claims={iss:issuer,aud:'bff',azp:'bff',sub:'alice',iat:now,exp:now+3600};
    const sign=payload=>new SignJWT(payload).setProtectedHeader({alg:'RS256',kid:'test'}).sign(privateKey);
    return Response.json({token_type:'Bearer',access_token:await sign({...claims,typ:'Bearer',scope:'openid profile email',preferred_username:'alice'}),refresh_token:'private-refresh',...(flags.missingId?{}:{id_token:await sign({...claims,typ:'ID',sub:flags.otherSubject?'bob':'alice',nonce:flags.badNonce?'wrong-nonce':nonce})})});
  };
  const service=createServerSessionService({appOrigin:origin,issuer,internalIssuer:'https://internal.example.com/realms/test',clientId:'bff',clientSecret:'private-server-client-secret'},store,keys);
  const cookie=name=>name+'='+newSessionId();
  async function begin(){const response=await service.login(new Request(origin+'/api/session/login',{method:'POST',headers:{origin}}));assert.equal(response.status,303);const url=new URL(response.headers.get('location'));nonce=url.searchParams.get('nonce');return {state:url.searchParams.get('state'),cookie:response.headers.getSetCookie()[0].split(';')[0]};}
  const callback=(pending,extraCookie='')=>service.callback(new Request(origin+'/api/session/callback?code=private-code&state='+pending.state,{headers:{cookie:pending.cookie+(extraCookie?'; '+extraCookie:'')}}));
  async function authenticated(){const pending=await begin(),response=await callback(pending);assert.equal(response.headers.get('location'),origin+'/server-session');const value=response.headers.getSetCookie().find(c=>c.startsWith('__Host-idenplane_session=')).split(';')[0];return {value,id:value.split('=')[1]};}
  const profile=value=>service.profile(new Request(origin+'/api/session/profile',{headers:{cookie:value}}));
  const logout=value=>service.logout(new Request(origin+'/api/session/logout',{method:'POST',headers:{origin,cookie:value}}));
  return {service,store,flags,calls,transactions,sessions,begin,callback,authenticated,profile,logout,cookie};
}
test('wrong callback state neither exchanges credentials nor consumes the valid transaction',async()=>{
  const f=fixture(),pending=await f.begin();const failed=await f.callback({...pending,state:'wrong'});assert.match(failed.headers.get('location'),/login_failed/);assert.equal(f.calls.length,0);assert.equal(f.transactions.size,1);assert.equal((await f.callback(pending)).headers.get('location'),origin+'/server-session');
});
for(const flag of ['badNonce','otherSubject','missingId'])test('callback rejects invalid provider credentials: '+flag,async()=>{
  const f=fixture(),pending=await f.begin();f.flags[flag]=true;assert.match((await f.callback(pending)).headers.get('location'),/login_failed/);assert.equal(f.sessions.size,0);
});
test('successful callback replaces the previous session with a fresh identifier',async()=>{
  const f=fixture(),old=await f.store.createSession({subject:'bob'}),pending=await f.begin();const response=await f.callback(pending,'__Host-idenplane_session='+old);assert.equal(response.status,303);assert.equal(f.sessions.has(old),false);assert.equal(f.sessions.size,1);assert.ok(!response.headers.getSetCookie().join(';').includes('private-refresh'));assert.equal((await f.profile('__Host-idenplane_session='+old)).status,401);
});
test('transient refresh failure returns unavailable and preserves the session for retry',async()=>{
  const f=fixture(),session=await f.authenticated();f.sessions.get(session.id).accessExpiresAt=0;f.flags.refreshStatus=503;assert.equal((await f.profile(session.value)).status,503);assert.equal(f.sessions.has(session.id),true);f.flags.refreshStatus=undefined;assert.equal((await f.profile(session.value)).status,200);
});
test('rejected refresh credentials revoke the local session',async()=>{
  const f=fixture(),session=await f.authenticated();f.sessions.get(session.id).accessExpiresAt=0;f.flags.refreshStatus=400;const response=await f.profile(session.value);assert.equal(response.status,401);assert.equal(f.sessions.has(session.id),false);assert.match(response.headers.getSetCookie()[0],/Max-Age=0/);
});
test('logout never reports success when database revocation failed',async()=>{
  const f=fixture(),session=await f.authenticated();f.flags.databaseFailure=true;const response=await f.logout(session.value);assert.equal(response.status,503);assert.equal(response.headers.get('location'),null);assert.equal(f.sessions.has(session.id),true);
});
test('provider outage cannot resurrect a successfully revoked local session',async()=>{
  const f=fixture(),session=await f.authenticated();f.flags.logoutFailure=true;const response=await f.logout(session.value);assert.equal(response.status,303);assert.equal(f.sessions.has(session.id),false);assert.equal((await f.profile(session.value)).status,401);assert.match(response.headers.getSetCookie()[0],/Max-Age=0/);
});
