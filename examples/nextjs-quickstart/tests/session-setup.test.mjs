import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve, join } from 'node:path';
import { createServerSessionEnvironment } from '../scripts/setup-server-session.mjs';

function folder(){const dir=mkdtempSync(join(tmpdir(),'idenplane-bff-setup-'));return {dir,cleanup(){const target=resolve(dir);assert.equal(dirname(target),resolve(tmpdir()));assert.ok(basename(target).startsWith('idenplane-bff-setup-'));rmSync(target,{recursive:true,force:true});}};}
const base={localDemo:true,appOrigin:'http://localhost:3001',serverOrigin:'http://localhost:3000',adminKey:'disposable-test-key'};
test('bootstrap registers a confidential client, creates fresh private keys, and refuses overwrite',async()=>{
  const temp=folder();try{let calls=0;const fetcher=async(url,request)=>{calls++;const body=JSON.parse(request.body);assert.equal(body.clientType,'CONFIDENTIAL');assert.deepEqual(body.redirectUris,['http://localhost:3001/api/session/callback']);return Response.json({clientSecret:'a'.repeat(48)});};
    const file=await createServerSessionEnvironment({...base,directory:temp.dir,fetcher}),before=readFileSync(file,'utf8');assert.match(before,/SESSION_ENCRYPTION_KEY=[a-f0-9]{64}/);assert.match(before,/SESSION_POSTGRES_PASSWORD=[a-f0-9]{64}/);assert.match(before,/SESSION_ALLOW_INSECURE_LOCALHOST=true/);
    if(process.platform!=='win32')assert.equal(statSync(file).mode&0o777,0o600);
    await assert.rejects(createServerSessionEnvironment({...base,directory:temp.dir,fetcher}),/Refusing to overwrite/);assert.equal(calls,1);assert.equal(readFileSync(file,'utf8'),before);
  }finally{temp.cleanup();}
});
test('bootstrap refuses existing files before creating a client',async()=>{
 const temp=folder();try{writeFileSync(join(temp.dir,'.env.server-session'),'keep');await assert.rejects(createServerSessionEnvironment({...base,directory:temp.dir,fetcher:()=>{throw Error('must not call');}}),/Refusing/);}finally{temp.cleanup();}
});
test('local-demo cannot send the demo admin key to a non-loopback host',async()=>{
 const temp=folder();try{await assert.rejects(createServerSessionEnvironment({...base,directory:temp.dir,serverOrigin:'https://auth.example.com',fetcher:()=>{throw Error('must not call');}}),/loopback/);}finally{temp.cleanup();}
});
test('provider errors do not produce a credentials file or rotate existing client secrets',async()=>{
 const temp=folder();try{await assert.rejects(createServerSessionEnvironment({...base,directory:temp.dir,fetcher:async()=>new Response(null,{status:409})}),/HTTP 409/);await assert.rejects(createServerSessionEnvironment({...base,directory:temp.dir,fetcher:async()=>Response.json({clientSecret:'invalid\nvalue'})}),/invalid client secret/);assert.equal(existsSync(join(temp.dir,'.env.server-session')),false);}finally{temp.cleanup();}
});
