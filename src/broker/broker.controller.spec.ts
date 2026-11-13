import { UnauthorizedException } from '@nestjs/common';
import { BrokerController } from './broker.controller.js';
import type { Realm } from '@prisma/client';

describe('BrokerController', () => {
  let controller: BrokerController;
  let brokerService: {
    initiateLogin: jest.Mock;
    handleCallback: jest.Mock;
    readState: jest.Mock;
  };
  let themeRender: { render: jest.Mock };
  let loginFlow: { continueAfterPrimaryAuth: jest.Mock };
  let flowRuntime: { startSocial: jest.Mock; dispatch: jest.Mock };

  const realm = { id: 'realm-1', name: 'test-realm' } as Realm;

  beforeEach(() => {
    brokerService = {
      initiateLogin: jest.fn(),
      handleCallback: jest.fn(),
      readState: jest.fn().mockResolvedValue({
        realmId: 'realm-1',
        alias: 'google',
        clientId: 'my-app',
        redirectUri: 'http://localhost/callback',
      }),
    };
    themeRender = { render: jest.fn() };
    loginFlow = { continueAfterPrimaryAuth: jest.fn() };
    // No custom-flow login in progress: the built-in federated sign-in.
    flowRuntime = {
      startSocial: jest.fn().mockResolvedValue(false),
      dispatch: jest.fn(),
    };
    controller = new BrokerController(
      brokerService as any,
      themeRender as any,
      loginFlow as any,
      flowRuntime as any,
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
        {} as any,
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
      expect(flowRuntime.dispatch).not.toHaveBeenCalled();
    });

    it('sends a callback a flow step started back into the flow runtime', async () => {
      const flow = { txn: 'txn-1', step: 'social', nonce: 'n' };
      brokerService.readState.mockResolvedValue({
        realmId: 'realm-1',
        alias: 'google',
        flow,
      });
      flowRuntime.dispatch.mockResolvedValue(true);
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

      expect(flowRuntime.dispatch).toHaveBeenCalledWith(
        realm,
        { endpoint: 'social', alias: 'google', code: 'ext-code', flow },
        req,
        res,
      );
      expect(brokerService.handleCallback).not.toHaveBeenCalled();
      expect(loginFlow.continueAfterPrimaryAuth).not.toHaveBeenCalled();
    });

    it('refuses a flow callback in a browser without that sign-in', async () => {
      brokerService.readState.mockResolvedValue({
        realmId: 'realm-1',
        alias: 'google',
        flow: { txn: 'txn-1', step: 'social', nonce: 'n' },
      });
      flowRuntime.dispatch.mockResolvedValue(false);
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

      expect(res.status).toHaveBeenCalledWith(403);
      expect(brokerService.handleCallback).not.toHaveBeenCalled();
      expect(loginFlow.continueAfterPrimaryAuth).not.toHaveBeenCalled();
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
