import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserSessionPolicy } from '../lib/session/browser-policy.ts';

const loopback=origin=>['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname);
export async function createServerSessionEnvironment(options) {
  const { directory, localDemo=false, adminKey, realm='quickstart', clientId='nextjs-session', fetcher=fetch }=options;
  const app=browserSessionPolicy(options.appOrigin,localDemo),server=browserSessionPolicy(options.serverOrigin,localDemo);
  if(localDemo&&(!loopback(app.origin)||!loopback(server.origin)))throw Error('Local-demo mode requires loopback origins');
  if(!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(realm)||!/^[A-Za-z0-9_.-]{1,100}$/.test(clientId))throw Error('Invalid realm or client identifier');
  if(typeof adminKey!=='string'||!/^[\x21-\x7e]{16,512}$/.test(adminKey))throw Error('A valid ASCII admin API key is required');
  const filename=resolve(directory,'.env.server-session');
  if(existsSync(filename))throw Error('Refusing to overwrite .env.server-session; preserve its credentials and encryption key');
  const response=await fetcher(server.origin+'/admin/realms/'+encodeURIComponent(realm)+'/clients',{
    method:'POST',headers:{'Content-Type':'application/json','x-admin-api-key':adminKey},
    body:JSON.stringify({clientId,clientType:'CONFIDENTIAL',redirectUris:[app.origin+'/api/session/callback'],postLogoutRedirectUris:[app.origin+'/server-session'],grantTypes:['authorization_code','refresh_token']}),signal:AbortSignal.timeout(10000),
  });
  if(!response.ok)throw Error('Could not create the server-session client (HTTP '+response.status+'). Preserve existing client credentials; no automatic secret rotation was attempted.');
  const client=await response.json();
  if(typeof client.clientSecret!=='string'||!/^[A-Za-z0-9_-]{20,}$/.test(client.clientSecret))throw Error('The provider returned an invalid client secret');
  const values={SESSION_APP_ORIGIN:app.origin,NEXT_PUBLIC_IDENPLANE_SERVER_URL:server.origin,NEXT_PUBLIC_IDENPLANE_REALM:realm,SESSION_POSTGRES_PASSWORD:randomBytes(32).toString('hex'),SESSION_ENCRYPTION_KEY:randomBytes(32).toString('hex'),SESSION_CLIENT_ID:clientId,SESSION_CLIENT_SECRET:client.clientSecret,SESSION_ALLOW_INSECURE_LOCALHOST:String(localDemo&&!app.secure)};
  writeFileSync(filename,'# Private server-session settings. Preserve and back up this key with the session database.\n'+Object.entries(values).map(([k,v])=>k+'='+v).join('\n')+'\n',{flag:'wx',mode:0o600});
  return filename;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  const localDemo=process.argv.includes('--local-demo');
  try{
    await createServerSessionEnvironment({directory:process.cwd(),localDemo,appOrigin:process.env.SESSION_APP_ORIGIN??'http://localhost:3001',serverOrigin:process.env.IDENPLANE_SERVER_URL??'http://localhost:3000',adminKey:process.env.IDENPLANE_ADMIN_API_KEY??(localDemo?'quickstart-dev-admin-key-do-not-use-in-production':undefined),realm:process.env.NEXT_PUBLIC_IDENPLANE_REALM??'quickstart'});
    console.log('Created private .env.server-session. Keep it out of Git and preserve its encryption key.');
  }catch(error){console.error(error.message);process.exitCode=1;}
}
