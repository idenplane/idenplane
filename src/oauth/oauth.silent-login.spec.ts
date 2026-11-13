import { BadRequestException } from '@nestjs/common';
import type { Realm } from '@prisma/client';
import { OAuthController } from './oauth.controller.js';
import { ACR_PASSWORD, ACR_MFA, ACR_WEBAUTHN } from '../step-up/step-up.service.js';

describe('OIDC silent authorization decisions', () => {
  const realm = {id:'realm-1',name:'test'} as Realm;
  const redirectUri = 'https://app.example/second-callback?tenant=one';
  const user = {id:'user-1'};
  let controller: OAuthController;
  let oauth: {validateAuthRequest:jest.Mock;authorizeWithUser:jest.Mock};
  let login: {validateLoginSession:jest.Mock;findLoginSession:jest.Mock};
  let consent: {hasConsent:jest.Mock;storeConsentRequest:jest.Mock};
  let stepUp: {getLoginSessionAcr:jest.Mock;getRiskRequiredAcr:jest.Mock;satisfiesAcr:jest.Mock;getAcrStrength:jest.Mock};
  let theme: {render:jest.Mock};
  let client: {id:string;clientId:string;redirectUris:string[];requireConsent:boolean;requiredAcr:string|null};
  let req: {cookies:Record<string,string>};
  let res: {status:jest.Mock;redirect:jest.Mock};
  let query: Record<string,string>;
  const strength = (acr:string) => ({[ACR_PASSWORD]:1,[ACR_MFA]:2,[ACR_WEBAUTHN]:3}[acr] ?? 0);

  beforeEach(() => {
    client={id:'client-1',clientId:'app',redirectUris:['https://app.example/first-callback',redirectUri],requireConsent:false,requiredAcr:null};
    query={client_id:'app',redirect_uri:redirectUri,response_type:'code',scope:'openid profile',prompt:'none',state:'state + & value',code_challenge:'challenge',code_challenge_method:'S256',nonce:'nonce'};
    oauth={validateAuthRequest:jest.fn().mockResolvedValue(client),authorizeWithUser:jest.fn().mockImplementation(async (_realm,_user,params) => {
      const uri=new URL(params.redirect_uri);uri.searchParams.set('code','test-code');uri.searchParams.set('state',params.state);return {redirectUrl:uri.toString()};
    })};
    login={validateLoginSession:jest.fn().mockResolvedValue(user),findLoginSession:jest.fn().mockResolvedValue({id:'session-1',userId:user.id,satisfiedAcr:ACR_PASSWORD,amr:['pwd']})};
    consent={hasConsent:jest.fn().mockResolvedValue(true),storeConsentRequest:jest.fn().mockResolvedValue('consent-1')};
    stepUp={getLoginSessionAcr:jest.fn().mockResolvedValue(ACR_PASSWORD),getRiskRequiredAcr:jest.fn().mockResolvedValue(null),satisfiesAcr:jest.fn((a,b)=>strength(a)>=strength(b)),getAcrStrength:jest.fn(strength)};
    theme={render:jest.fn()};req={cookies:{IDENPLANE_SESSION:'session-token'}};res={status:jest.fn().mockReturnThis(),redirect:jest.fn()};
    // The flow runtime is off: every login resolves to the built-in one.
    const flowRuntime={resolveBinding:jest.fn().mockResolvedValue({kind:'legacy'})};
    controller=new OAuthController(oauth as never,login as never,consent as never,stepUp as never,theme as never,flowRuntime as never);
  });

  async function authorize(){await controller.authorize(realm,query,req as never,res as never);}
  function redirect(){expect(res.redirect).toHaveBeenCalledTimes(1);expect(res.redirect.mock.calls[0][0]).toBe(302);return new URL(res.redirect.mock.calls[0][1],'https://idp.example');}
  function expectSilentError(error:string){const uri=redirect();expect(uri.origin+uri.pathname).toBe('https://app.example/second-callback');expect(uri.searchParams.get('tenant')).toBe('one');expect(uri.searchParams.get('error')).toBe(error);expect(uri.searchParams.get('state')).toBe(query.state);expect(oauth.authorizeWithUser).not.toHaveBeenCalled();expect(consent.storeConsentRequest).not.toHaveBeenCalled();expect(theme.render).not.toHaveBeenCalled();}

  it('issues a code for an existing authenticated session and retains PKCE, nonce and session assurance', async () => {
    await authorize();expect(redirect().searchParams.get('code')).toBe('test-code');
    expect(oauth.authorizeWithUser).toHaveBeenCalledWith(realm,user,query,{acr:ACR_PASSWORD,amr:['pwd']});expect(theme.render).not.toHaveBeenCalled();
  });
  it.each(['missing','invalid'])('returns login_required without a UI for a %s session', async kind => {
    if(kind==='missing')req.cookies={};else login.validateLoginSession.mockResolvedValue(null);
    await authorize();expectSilentError('login_required');
  });
  it('returns consent_required without creating an interactive consent request', async () => {
    client.requireConsent=true;consent.hasConsent.mockResolvedValue(false);await authorize();expectSilentError('consent_required');
  });
  it('uses existing consent for the requested scopes', async () => {
    client.requireConsent=true;await authorize();expect(redirect().searchParams.get('code')).toBe('test-code');expect(consent.hasConsent).toHaveBeenCalledWith(user.id,client.id,['openid','profile']);
  });
  it.each(['requested','client','risk'])('returns interaction_required for stronger %s assurance', async source => {
    if(source==='requested')query.acr_values=ACR_MFA;
    if(source==='client')client.requiredAcr=ACR_MFA;
    if(source==='risk')stepUp.getRiskRequiredAcr.mockResolvedValue(ACR_MFA);
    await authorize();expectSilentError('interaction_required');
  });
  it('does not bypass an assurance requirement when the session record is missing', async () => {
    login.findLoginSession.mockResolvedValue(null);client.requiredAcr=ACR_MFA;await authorize();expectSilentError('interaction_required');
  });
  it('allows an existing session that already satisfies the requested assurance', async () => {
    client.requiredAcr=ACR_MFA;stepUp.getLoginSessionAcr.mockResolvedValue(ACR_MFA);await authorize();expect(redirect().searchParams.get('code')).toBe('test-code');expect(oauth.authorizeWithUser.mock.calls[0][3]).toEqual({acr:ACR_MFA,amr:['pwd','otp']});
  });
  it.each(['none login','none consent'])('rejects conflicting prompt values: %s', async prompt => {
    query.prompt=prompt;await authorize();expectSilentError('invalid_request');expect(login.validateLoginSession).not.toHaveBeenCalled();
  });
  it('preserves an explicitly empty state in a silent error', async () => {
    req.cookies={};query.state='';await authorize();expectSilentError('login_required');expect(redirect().searchParams.has('state')).toBe(true);
  });
  it('retains normal SSO when no prompt is supplied', async () => {
    delete query.prompt;await authorize();expect(redirect().searchParams.get('code')).toBe('test-code');
  });
  it('retains interactive login when requested explicitly', async () => {
    query.prompt='login';await authorize();expect(redirect().pathname).toBe('/realms/test/login');expect(oauth.authorizeWithUser).not.toHaveBeenCalled();
  });
  it('honors explicit consent even when a previous consent exists', async () => {
    query.prompt='consent';await authorize();expect(redirect().pathname).toBe('/realms/test/consent');expect(consent.storeConsentRequest).toHaveBeenCalled();expect(oauth.authorizeWithUser).not.toHaveBeenCalled();
  });
  it('retains an interactive step-up when silent mode is not requested', async () => {
    delete query.prompt;client.requiredAcr=ACR_MFA;await authorize();expect(redirect().pathname).toBe('/realms/test/step-up/challenge');expect(oauth.authorizeWithUser).not.toHaveBeenCalled();
  });
  it('does not redirect to an invalid redirect URI even in silent mode', async () => {
    oauth.validateAuthRequest.mockRejectedValue(new BadRequestException('Invalid redirect_uri'));await authorize();expect(res.redirect).not.toHaveBeenCalled();expect(res.status).toHaveBeenCalledWith(400);expect(theme.render).toHaveBeenCalled();
  });
});
