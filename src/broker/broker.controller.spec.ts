import { BrokerController } from './broker.controller.js';
import type { Realm } from '@prisma/client';

describe('BrokerController', () => {
  let controller: BrokerController;
  let brokerService: {
    initiateLogin: jest.Mock;
    handleCallback: jest.Mock;
  };

  const realm = { id: 'realm-1', name: 'test-realm' } as Realm;

  beforeEach(() => {
    brokerService = {
      initiateLogin: jest.fn(),
      handleCallback: jest.fn(),
    };
    controller = new BrokerController(brokerService as any);
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
      };

      await controller.login(
        realm,
        'google',
        query.client_id,
        query.redirect_uri,
        query.scope,
        query.state,
        query.nonce,
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
        },
      );
      expect(res.redirect).toHaveBeenCalledWith(302, redirectUrl);
    });
  });

  describe('callback', () => {
    it('should handle callback and redirect to result URL', async () => {
      brokerService.handleCallback.mockResolvedValue({
        redirectUrl: 'http://localhost/callback?code=authcode&state=abc',
      });

      const res = { redirect: jest.fn() };

      await controller.callback(
        realm,
        'google',
        'ext-code',
        'state-123',
        res as any,
      );

      expect(brokerService.handleCallback).toHaveBeenCalledWith(
        realm,
        'google',
        'ext-code',
        'state-123',
      );
      expect(res.redirect).toHaveBeenCalledWith(
        302,
        'http://localhost/callback?code=authcode&state=abc',
      );
    });
  });
});
