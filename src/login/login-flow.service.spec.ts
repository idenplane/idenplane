import type { Realm, User } from '@prisma/client';
import {
  LoginFlowService,
  MFA_CHALLENGE_COOKIE,
} from './login-flow.service.js';
import { MFA_ENROLLMENT_COOKIE } from '../mfa/mfa.service.js';

describe('LoginFlowService', () => {
  const realm = { id: 'realm-1', name: 'test-realm' } as Realm;
  const user = { id: 'user-1', username: 'alice' } as User;
  const oauthParams = {
    response_type: 'code',
    client_id: 'app',
    redirect_uri: 'https://app.example/cb',
    scope: 'openid',
  };

  let loginService: { createLoginSession: jest.Mock };
  let oauthService: {
    validateAuthRequest: jest.Mock;
    authorizeWithUser: jest.Mock;
  };
  let consentService: {
    hasConsent: jest.Mock;
    storeConsentRequest: jest.Mock;
  };
  let eventsService: { recordLoginEvent: jest.Mock };
  let mfaService: {
    isMfaRequired: jest.Mock;
    isMfaEnabled: jest.Mock;
    createMfaChallenge: jest.Mock;
    createMfaEnrollment: jest.Mock;
  };
  let flow: LoginFlowService;
  let res: { cookie: jest.Mock; redirect: jest.Mock };
  const req = { headers: { 'user-agent': 'jest' }, cookies: {} } as any;

  beforeEach(() => {
    loginService = { createLoginSession: jest.fn().mockResolvedValue('sso') };
    oauthService = {
      validateAuthRequest: jest
        .fn()
        .mockResolvedValue({ id: 'client-db-1', requireConsent: false }),
      authorizeWithUser: jest
        .fn()
        .mockResolvedValue({ redirectUrl: 'https://app.example/cb?code=c' }),
    };
    consentService = {
      hasConsent: jest.fn(),
      storeConsentRequest: jest.fn(),
    };
    eventsService = { recordLoginEvent: jest.fn() };
    mfaService = {
      isMfaRequired: jest.fn().mockResolvedValue(false),
      isMfaEnabled: jest.fn().mockResolvedValue(false),
      createMfaChallenge: jest.fn().mockResolvedValue('challenge'),
      createMfaEnrollment: jest.fn().mockResolvedValue('enrolment'),
    };
    flow = new LoginFlowService(
      loginService as any,
      oauthService as any,
      consentService as any,
      eventsService as any,
      mfaService as any,
    );
    res = { cookie: jest.fn(), redirect: jest.fn() };
  });

  describe('continueAfterPrimaryAuth', () => {
    it('challenges a user who has TOTP, remembering the first factor', async () => {
      mfaService.isMfaEnabled.mockResolvedValue(true);
      mfaService.isMfaRequired.mockResolvedValue(true);

      await flow.continueAfterPrimaryAuth(
        realm,
        user,
        oauthParams,
        { primaryAmr: [] },
        req,
        res as any,
      );

      expect(mfaService.createMfaChallenge).toHaveBeenCalledWith(
        'user-1',
        'realm-1',
        oauthParams,
        undefined,
        [],
      );
      expect(res.cookie).toHaveBeenCalledWith(
        MFA_CHALLENGE_COOKIE,
        'challenge',
        expect.objectContaining({ httpOnly: true, path: '/realms/test-realm' }),
      );
      expect(res.redirect).toHaveBeenCalledWith('/realms/test-realm/totp');
      expect(loginService.createLoginSession).not.toHaveBeenCalled();
    });

    it('sends an un-enrolled user in an MFA-required realm to enrolment, with no session', async () => {
      mfaService.isMfaRequired.mockResolvedValue(true);

      await flow.continueAfterPrimaryAuth(
        realm,
        user,
        oauthParams,
        { primaryAmr: ['pwd'], rememberMe: true },
        req,
        res as any,
      );

      expect(mfaService.createMfaEnrollment).toHaveBeenCalledWith({
        userId: 'user-1',
        realmId: 'realm-1',
        oauthParams,
        rememberMe: true,
        primaryAmr: ['pwd'],
      });
      expect(res.cookie).toHaveBeenCalledWith(
        MFA_ENROLLMENT_COOKIE,
        'enrolment',
        expect.objectContaining({ httpOnly: true }),
      );
      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('/realms/test-realm/account/totp-setup'),
      );
      expect(loginService.createLoginSession).not.toHaveBeenCalled();
      expect(oauthService.authorizeWithUser).not.toHaveBeenCalled();
    });

    it('completes a single-factor sign-in at the password level with its own methods', async () => {
      await flow.continueAfterPrimaryAuth(
        realm,
        user,
        oauthParams,
        { primaryAmr: [] },
        req,
        res as any,
      );

      const context = { acr: 'urn:idenplane:acr:password', amr: [] };
      expect(loginService.createLoginSession).toHaveBeenCalledWith(
        realm,
        user,
        expect.any(String), // client IP
        'jest',
        undefined,
        context,
      );
      expect(oauthService.authorizeWithUser).toHaveBeenCalledWith(
        realm,
        user,
        oauthParams,
        context,
      );
      expect(res.redirect).toHaveBeenCalledWith(
        302,
        'https://app.example/cb?code=c',
      );
    });
  });

  describe('completeLogin', () => {
    const mfa = { acr: 'urn:idenplane:acr:mfa', amr: ['otp'] };

    it('validates the OAuth request before creating the session', async () => {
      oauthService.validateAuthRequest.mockRejectedValue(
        new Error('Invalid redirect_uri'),
      );

      await expect(
        flow.completeLogin(realm, user, oauthParams, req, res as any, mfa),
      ).rejects.toThrow('Invalid redirect_uri');
      expect(loginService.createLoginSession).not.toHaveBeenCalled();
    });

    it('records the login and keeps the session cookie for "remember me"', async () => {
      await flow.completeLogin(realm, user, oauthParams, req, res as any, mfa, {
        rememberMe: true,
      });

      expect(eventsService.recordLoginEvent).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', clientId: 'app' }),
      );
      expect(res.cookie).toHaveBeenCalledWith(
        'IDENPLANE_SESSION',
        'sso',
        expect.objectContaining({ maxAge: 30 * 24 * 60 * 60 * 1000 }),
      );
    });

    it('shows the consent screen, carrying the satisfied level across it', async () => {
      oauthService.validateAuthRequest.mockResolvedValue({
        id: 'client-db-1',
        clientId: 'app',
        name: 'App',
        requireConsent: true,
      });
      consentService.hasConsent.mockResolvedValue(false);
      consentService.storeConsentRequest.mockResolvedValue('req-1');

      await flow.completeLogin(realm, user, oauthParams, req, res as any, mfa);

      expect(consentService.storeConsentRequest).toHaveBeenCalledWith(
        expect.objectContaining({ satisfiedAcr: mfa.acr, amr: mfa.amr }),
      );
      expect(res.redirect).toHaveBeenCalledWith(
        302,
        '/realms/test-realm/consent?req=req-1',
      );
      expect(oauthService.authorizeWithUser).not.toHaveBeenCalled();
    });

    it('goes to the account page when there is no OAuth request', async () => {
      await flow.completeLogin(realm, user, {}, req, res as any, mfa);

      expect(oauthService.validateAuthRequest).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(
        302,
        '/realms/test-realm/account',
      );
    });
  });

  it('records the first factor plus otp once TOTP completes a sign-in', () => {
    expect(LoginFlowService.amrWithOtp(['pwd'])).toEqual(['pwd', 'otp']);
    expect(LoginFlowService.amrWithOtp([])).toEqual(['otp']);
    // Challenges created before the first factor was recorded were passwords.
    expect(LoginFlowService.amrWithOtp(undefined)).toEqual(['pwd', 'otp']);
  });
});
