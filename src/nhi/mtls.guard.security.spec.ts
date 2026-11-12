import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { TLSSocket } from 'node:tls';
import { X509Certificate } from 'node:crypto';
import { createServer, request as httpsRequest } from 'node:https';
import { MtlsGuard, NhiCertificateGuard } from './mtls.guard.js';
import { makeTestCertificate } from './__mocks__/certificate.fixture.js';

const makeGuard = (type: typeof MtlsGuard | typeof NhiCertificateGuard, isPublic=false) => Reflect.construct(type,[{getAllAndOverride:()=>isPublic}]) as MtlsGuard | NhiCertificateGuard;
function context(path:string, headers:Record<string,string|undefined>={},socket:unknown={}) {
  const req={path,headers,socket,nhiCertificate:undefined as undefined|{fingerprint:string;subject:string}};
  const response={setHeader:jest.fn()};
  const ctx={switchToHttp:()=>({getRequest:()=>req,getResponse:()=>response}),getHandler:()=>function handler(){},getClass:()=>class Controller{}} as unknown as ExecutionContext;
  return {req,response,ctx};
}
const peer = (certificate:X509Certificate|undefined, authorized=true) => Object.defineProperties(Object.create(TLSSocket.prototype),{encrypted:{value:true},authorized:{value:authorized},getPeerX509Certificate:{value:()=>certificate}});

describe('certificate proof-of-possession guard boundary',()=>{
  it.each([
    {'x-client-certificate-fingerprint':'SHA256:AA:BB'},
    {'x-client-certificate':Buffer.from('public certificate metadata').toString('base64')},
    {'x-client-certificate-fingerprint':'SHA256:AA:BB','x-client-certificate-verified':'SUCCESS'},
  ])('rejects client-controlled headers on a non-TLS request: %j',headers=>{
    expect(()=>makeGuard(MtlsGuard).canActivate(context('/api/v1/device',headers).ctx)).toThrow(UnauthorizedException);
  });
  it('does not bypass a configured mTLS route when it has public metadata',()=>{
    expect(()=>makeGuard(MtlsGuard,true).canActivate(context('/api/v1/device',{'x-client-certificate-fingerprint':'AA:BB'}).ctx)).toThrow(UnauthorizedException);
  });
  it('rejects an unverified TLS connection',async()=>{
    const {pem}=await makeTestCertificate();
    expect(()=>makeGuard(MtlsGuard).canActivate(context('/api/v1/device',{},peer(new X509Certificate(pem),false)).ctx)).toThrow(UnauthorizedException);
  });
  it('rejects a TLS connection with no client certificate',()=>{
    expect(()=>makeGuard(MtlsGuard).canActivate(context('/api/v1/device',{},peer(undefined)).ctx)).toThrow(UnauthorizedException);
  });
  it('reads only the verified peer certificate and ignores a forged header',async()=>{
    const {pem}=await makeTestCertificate({name:'real-device'}),certificate=new X509Certificate(pem);
    const test=context('/api/v1/device',{'x-client-certificate-fingerprint':'SHA256:AA:BB'},peer(certificate));
    expect(makeGuard(MtlsGuard).canActivate(test.ctx)).toBe(true);
    expect(test.req.nhiCertificate?.fingerprint).toBe('SHA256:'+certificate.fingerprint256);
    expect(test.req.nhiCertificate?.subject).toBe(certificate.subject);
    expect(test.response.setHeader).toHaveBeenCalledWith('X-Client-Certificate-Fingerprint','SHA256:'+certificate.fingerprint256);
  });
  it('rejects an expired peer certificate even if transport verification was asserted',async()=>{
    const {pem}=await makeTestCertificate({notBefore:new Date(Date.now()-3*86400000),notAfter:new Date(Date.now()-86400000)});
    expect(()=>makeGuard(MtlsGuard).canActivate(context('/api/v1/device',{},peer(new X509Certificate(pem))).ctx)).toThrow(UnauthorizedException);
  });
  it.each([false,true])('keeps unfinished NHI credential authentication closed, public=%s',isPublic=>{
    expect(()=>makeGuard(NhiCertificateGuard,isPublic).canActivate(context('/api/v1/nhi/auth',{'x-client-certificate-fingerprint':'AA:BB'}).ctx)).toThrow(UnauthorizedException);
  });
  it('does not block normal OAuth and admin routes',()=>{
    for(const type of [MtlsGuard,NhiCertificateGuard])for(const path of ['/admin/realms','/realms/test/protocol/openid-connect/auth'])expect(makeGuard(type).canActivate(context(path).ctx)).toBe(true);
  });
  it('accepts a client that completes a real mutually verified TLS handshake',async()=>{
    const serverCertificate=await makeTestCertificate({name:'localhost',dns:'localhost',isCA:true});
    const clientCertificate=await makeTestCertificate({name:'device-client',isCA:true});
    const guard=makeGuard(MtlsGuard);
    const server=createServer({key:serverCertificate.privateKeyPem,cert:serverCertificate.pem,ca:[clientCertificate.pem],requestCert:true,rejectUnauthorized:true},(request,response)=>{
      const test=context('/api/v1/device',{'x-client-certificate-fingerprint':'forged'},request.socket);
      try{guard.canActivate(test.ctx);response.end(JSON.stringify(test.req.nhiCertificate));}catch{response.statusCode=401;response.end('{}');}
    });
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    try{
      const address=server.address();if(!address||typeof address==='string')throw Error('No test port');
      const result=await new Promise<{status:number;body:string}>((resolve,reject)=>{
        const request=httpsRequest({hostname:'127.0.0.1',servername:'localhost',port:address.port,path:'/api/v1/device',ca:serverCertificate.pem,key:clientCertificate.privateKeyPem,cert:clientCertificate.pem,agent:false},response=>{let body='';response.on('data',part=>body+=part);response.on('end',()=>resolve({status:response.statusCode!,body}));});request.on('error',reject);request.end();
      });
      expect(result.status).toBe(200);expect(JSON.parse(result.body).fingerprint).toBe('SHA256:'+new X509Certificate(clientCertificate.pem).fingerprint256);
    }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  });
});
