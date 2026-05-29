import { NotFoundException, BadRequestException } from '@nestjs/common';
import { OAuthController } from './oauth.controller.js';
import type { Realm } from '@prisma/client';

describe('OAuthController', () => {
  let controller: OAuthController;
  let oauthService: { validateAuthRequest: jest.Mock };
  let themeRender: { render: jest.Mock };

  const realm = { id: 'realm-1', name: 'test-realm' } as Realm;

  beforeEach(() => {
    oauthService = { validateAuthRequest: jest.fn() };
    themeRender = { render: jest.fn() };
    controller = new OAuthController(
      oauthService as any,
      {} as any, // loginService
      {} as any, // consentService
      {} as any, // stepUpService
      {} as any, // crypto
      {} as any, // prisma
      themeRender as any,
    );
  });

  describe('authorize error rendering', () => {
    it('renders a themed error page (not raw JSON) when the client is unknown', async () => {
      oauthService.validateAuthRequest.mockRejectedValue(
        new NotFoundException('Client not found'),
      );
      const req = {};
      const res = { status: jest.fn().mockReturnThis(), redirect: jest.fn() };

      await controller.authorize(
        realm,
        { client_id: 'ghost' },
        req as any,
        res as any,
      );

      expect(res.redirect).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(404);
      expect(themeRender.render).toHaveBeenCalledWith(
        res,
        realm,
        'login',
        'error',
        expect.objectContaining({ errorMessage: 'Client not found' }),
        req,
      );
    });

    it('renders a themed error page on an invalid redirect_uri (status from the exception)', async () => {
      oauthService.validateAuthRequest.mockRejectedValue(
        new BadRequestException('Invalid redirect_uri'),
      );
      const req = {};
      const res = { status: jest.fn().mockReturnThis(), redirect: jest.fn() };

      await controller.authorize(
        realm,
        {
          client_id: 'test-client',
          redirect_uri: 'http://evil.example/cb',
          response_type: 'code',
        },
        req as any,
        res as any,
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(themeRender.render).toHaveBeenCalledWith(
        res,
        realm,
        'login',
        'error',
        expect.objectContaining({ errorMessage: 'Invalid redirect_uri' }),
        req,
      );
    });
  });
});
