import { UnauthorizedException } from '@nestjs/common';
import { BrokerController } from './broker.controller.js';
import type { Realm } from '@prisma/client';

describe('BrokerController', () => {
  let controller: BrokerController;
  let brokerService: {
    initiateLogin: jest.Mock;
    handleCallback: jest.Mock;
  };
  let themeRender: { render: jest.Mock };
  let loginFlow: { continueAfterPrimaryAuth: jest.Mock };

  const realm = { id: 'realm-1', name: 'test-realm' } as Realm;

  beforeEach(() => {
    brokerService = {
      initiateLogin: jest.fn(),
      handleCallback: jest.fn(),
    };
    themeRender = { render: jest.fn() };
    loginFlow = { continueAfterPrimaryAuth: jest.fn() };
    controller = new BrokerController(
      brokerService as any,
      themeRender as any,
      loginFlow as any,
    );
  });

  describe('login', () => {
    it('should initiate login and redirect to external provider', async () => {
      const redirectUrl =
        'https://accounts.google.com/auth?client_id=gid&state=abc';
      brokerService.initiateLogin.mockResolvedValue(redirectUrl);

      const res = { redirect: jest.fn() };
      const query = {
        client_id: 'my-app',
        redirect_uri: 'http://localhost/callback',
        scope: 'openid',
        state: 'abc',
        nonce: 'xyz',
        code_challenge: 'challenge-abc',
        code_challenge_method: 'S256',
      };

      await controller.login(
        realm,
        'google',
        query.client_id,
        query.redirect_uri,
        query.scope,
        query.state,
        query.nonce,
        query.code_challenge,
        query.code_challenge_method,
        res as any,
      );

      expect(brokerService.initiateLogin).toHaveBeenCalledWith(
        realm,
        'google',
        {
          client_id: 'my-app',
          redirect_uri: 'http://localhost/callback',
          scope: 'openid',
          state: 'abc',
          nonce: 'xyz',
          code_challenge: 'challenge-abc',
          code_challenge_method: 'S256',
        },
      );
      expect(res.redirect).toHaveBeenCalledWith(302, redirectUrl);
    });
  });

  describe('callback', () => {
    const oauthParams = {
      response_type: 'code',
      client_id: 'my-app',
      redirect_uri: 'http://localhost/callback',
    };

    it('finishes the federated sign-in through the shared login flow', async () => {
      const user = { id: 'user-1', enabled: true };
      brokerService.handleCallback.mockResolvedValue({ user, oauthParams });

      const req = {};
      const res = { redirect: jest.fn(), status: jest.fn().mockReturnThis() };

      await controller.callback(
        realm,
        'google',
        'ext-code',
        'state-123',
        req as any,
        res as any,
      );

      expect(brokerService.handleCallback).toHaveBeenCalledWith(
        realm,
        'google',
        'ext-code',
        'state-123',
      );
      // Same path as a password sign-in, so MFA policy, session, consent and
      // the code are all applied; the external methods are not known.
      expect(loginFlow.continueAfterPrimaryAuth).toHaveBeenCalledWith(
        realm,
        user,
        oauthParams,
        { primaryAmr: [] },
        req,
        res,
      );
      expect(themeRender.render).not.toHaveBeenCalled();
    });

    it('refuses a disabled account', async () => {
      brokerService.handleCallback.mockResolvedValue({
        user: { id: 'user-1', enabled: false },
        oauthParams,
      });

      const req = {};
      const res = { redirect: jest.fn(), status: jest.fn().mockReturnThis() };

      await controller.callback(
        realm,
        'google',
        'ext-code',
        'state-123',
        req as any,
        res as any,
      );

      expect(loginFlow.continueAfterPrimaryAuth).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(themeRender.render).toHaveBeenCalledWith(
        res,
        realm,
        'login',
        'error',
        expect.objectContaining({ errorMessage: 'This account is disabled.' }),
        req,
      );
    });

    it('should render a themed error page (not raw JSON) when federation fails', async () => {
      brokerService.handleCallback.mockRejectedValue(
        new UnauthorizedException(
          'No matching user found and identity provider is configured as link-only',
        ),
      );

      const req = {};
      const res = { redirect: jest.fn(), status: jest.fn().mockReturnThis() };

      await controller.callback(
        realm,
        'google',
        'ext-code',
        'state-123',
        req as any,
        res as any,
      );

      expect(res.redirect).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(themeRender.render).toHaveBeenCalledWith(
        res,
        realm,
        'login',
        'error',
        expect.objectContaining({
          errorTitle: 'Sign-in failed',
          errorMessage:
            'No matching user found and identity provider is configured as link-only',
        }),
        req,
      );
    });
  });
});
