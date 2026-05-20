import { AccountController } from './account.controller.js';
import type { Realm } from '@prisma/client';
import {
  createMockPrismaService,
  type MockPrismaService,
} from '../prisma/prisma.mock.js';

describe('AccountController', () => {
  let controller: AccountController;
  let loginService: { validateLoginSession: jest.Mock };
  let prisma: MockPrismaService;
  let crypto: { verifyPassword: jest.Mock; hashPassword: jest.Mock };
  let passwordPolicyService: {
    validate: jest.Mock;
    checkHistory: jest.Mock;
    recordHistory: jest.Mock;
  };
  let mfaService: {
    isMfaEnabled: jest.Mock;
    setupTotp: jest.Mock;
    verifyAndActivateTotp: jest.Mock;
    disableTotp: jest.Mock;
  };
  let themeRender: { render: jest.Mock };
  let webAuthnService: { getUserCredentials: jest.Mock };

  const realm = {
    id: 'realm-1',
    name: 'test-realm',
    passwordHistoryCount: 3,
  } as any as Realm;

  const sessionUser = {
    id: 'user-1',
    username: 'testuser',
    email: 'test@example.com',
    emailVerified: true,
    firstName: 'Test',
    lastName: 'User',
    passwordHash: 'hashed-pw',
  };

  let mockRes: { redirect: jest.Mock };
  let mockReqWithSession: any;
  let mockReqNoSession: any;

  beforeEach(() => {
    loginService = {
      validateLoginSession: jest.fn(),
    };
    prisma = createMockPrismaService();
    crypto = {
      verifyPassword: jest.fn(),
      hashPassword: jest.fn(),
    };
    passwordPolicyService = {
      validate: jest.fn(),
      checkHistory: jest.fn(),
      recordHistory: jest.fn(),
    };
    mfaService = {
      isMfaEnabled: jest.fn(),
      setupTotp: jest.fn(),
      verifyAndActivateTotp: jest.fn(),
      disableTotp: jest.fn(),
    };
    themeRender = { render: jest.fn() };
    webAuthnService = { getUserCredentials: jest.fn().mockResolvedValue([]) };

    controller = new AccountController(
      loginService as any,
      prisma as any,
      crypto as any,
      passwordPolicyService as any,
      mfaService as any,
      themeRender as any,
      webAuthnService as any,
    );

    mockRes = { redirect: jest.fn() };
    mockReqWithSession = {
      cookies: { IDENPLANE_SESSION: 'valid-token' },
      query: {},
    };
    mockReqNoSession = { cookies: {} };

    loginService.validateLoginSession.mockResolvedValue(sessionUser);
  });

  describe('showAccount', () => {
    it('should redirect to login if no session', async () => {
      loginService.validateLoginSession.mockResolvedValue(null);

      await controller.showAccount(realm, mockReqNoSession, mockRes as any);

      expect(mockRes.redirect).toHaveBeenCalledWith('/realms/test-realm/login');
    });

    it('should render account page for authenticated user', async () => {
      mfaService.isMfaEnabled.mockResolvedValue(false);

      await controller.showAccount(realm, mockReqWithSession, mockRes as any);

      expect(themeRender.render).toHaveBeenCalledWith(
        mockRes,
        realm,
        'account',
        'account',
        expect.objectContaining({
          username: 'testuser',
          email: 'test@example.com',
          mfaEnabled: false,
        }),
        mockReqWithSession,
      );
    });
  });

  describe('updateProfile', () => {
    it('should redirect to login if no session', async () => {
      loginService.validateLoginSession.mockResolvedValue(null);

      await controller.updateProfile(
        realm,
        { firstName: 'New' },
        mockReqNoSession,
        mockRes as any,
      );

      expect(mockRes.redirect).toHaveBeenCalledWith('/realms/test-realm/login');
    });

    it('should update user profile and redirect with success', async () => {
      prisma.user.update.mockResolvedValue({});

      await controller.updateProfile(
        realm,
        { firstName: 'New', lastName: 'Name' },
        mockReqWithSession,
        mockRes as any,
      );

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { firstName: 'New', lastName: 'Name' },
      });
      expect(mockRes.redirect).toHaveBeenCalledWith(
        expect.stringContaining('success='),
      );
    });
  });

  describe('changePassword', () => {
    it('should redirect to login if no session', async () => {
      loginService.validateLoginSession.mockResolvedValue(null);

      await controller.changePassword(
        realm,
        { currentPassword: 'old', newPassword: 'new', confirmPassword: 'new' },
        mockReqNoSession,
        mockRes as any,
      );

      expect(mockRes.redirect).toHaveBeenCalledWith('/realms/test-realm/login');
    });

    it('should redirect with error if passwords do not match', async () => {
      await controller.changePassword(
        realm,
        {
          currentPassword: 'old',
          newPassword: 'new1',
          confirmPassword: 'new2',
        },
        mockReqWithSession,
        mockRes as any,
      );

      expect(mockRes.redirect).toHaveBeenCalledWith(
        expect.stringContaining('error='),
      );
    });

    it('should redirect with error if password fields are missing', async () => {
      await controller.changePassword(
        realm,
        { currentPassword: '', newPassword: '', confirmPassword: '' },
        mockReqWithSession,
        mockRes as any,
      );

      expect(mockRes.redirect).toHaveBeenCalledWith(
        expect.stringContaining('error='),
      );
    });

    it('should redirect with error if password policy fails', async () => {
      passwordPolicyService.validate.mockReturnValue({
        valid: false,
        errors: ['Password too short'],
      });

      await controller.changePassword(
        realm,
        { currentPassword: 'old', newPassword: 'new', confirmPassword: 'new' },
        mockReqWithSession,
        mockRes as any,
      );

      expect(mockRes.redirect).toHaveBeenCalledWith(
        expect.stringContaining('error='),
      );
    });

    it('should redirect with error if current password is incorrect', async () => {
      passwordPolicyService.validate.mockReturnValue({
        valid: true,
        errors: [],
      });
      crypto.verifyPassword.mockResolvedValue(false);

      await controller.changePassword(
        realm,
        {
          currentPassword: 'wrong',
          newPassword: 'newpass',
          confirmPassword: 'newpass',
        },
        mockReqWithSession,
        mockRes as any,
      );

      expect(mockRes.redirect).toHaveBeenCalledWith(
        expect.stringContaining('error='),
      );
    });

    it('should redirect with error if password is in history', async () => {
      passwordPolicyService.validate.mockReturnValue({
        valid: true,
        errors: [],
      });
      crypto.verifyPassword.mockResolvedValue(true);
      passwordPolicyService.checkHistory.mockResolvedValue(true);

      await controller.changePassword(
        realm,
        {
          currentPassword: 'old',
          newPassword: 'reused',
          confirmPassword: 'reused',
        },
        mockReqWithSession,
        mockRes as any,
      );

      expect(mockRes.redirect).toHaveBeenCalledWith(
        expect.stringContaining('error='),
      );
    });

    it('should change password successfully', async () => {
      passwordPolicyService.validate.mockReturnValue({
        valid: true,
        errors: [],
      });
      crypto.verifyPassword.mockResolvedValue(true);
      passwordPolicyService.checkHistory.mockResolvedValue(false);
      crypto.hashPassword.mockResolvedValue('new-hash');
      prisma.user.update.mockResolvedValue({});

      await controller.changePassword(
        realm,
        {
          currentPassword: 'old',
          newPassword: 'newpass',
          confirmPassword: 'newpass',
        },
        mockReqWithSession,
        mockRes as any,
      );

      expect(crypto.hashPassword).toHaveBeenCalledWith('newpass');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: expect.objectContaining({ passwordHash: 'new-hash' }),
      });
      expect(passwordPolicyService.recordHistory).toHaveBeenCalled();
      expect(mockRes.redirect).toHaveBeenCalledWith(
        expect.stringContaining('success='),
      );
    });
  });

  describe('showTotpSetup', () => {
    it('should redirect to login if no session', async () => {
      loginService.validateLoginSession.mockResolvedValue(null);

      await controller.showTotpSetup(realm, mockReqNoSession, mockRes as any);

      expect(mockRes.redirect).toHaveBeenCalledWith('/realms/test-realm/login');
    });

    it('should redirect to account if MFA already enabled', async () => {
      mfaService.isMfaEnabled.mockResolvedValue(true);

      await controller.showTotpSetup(realm, mockReqWithSession, mockRes as any);

      expect(mockRes.redirect).toHaveBeenCalledWith(
        expect.stringContaining('/account?info='),
      );
    });

    it('should render TOTP setup page', async () => {
      mfaService.isMfaEnabled.mockResolvedValue(false);
      mfaService.setupTotp.mockResolvedValue({
        qrCodeDataUrl: 'data:image/png;base64,abc',
        secret: 'JBSWY3DPEHPK3PXP',
      });

      await controller.showTotpSetup(realm, mockReqWithSession, mockRes as any);

      expect(themeRender.render).toHaveBeenCalledWith(
        mockRes,
        realm,
        'account',
        'totp-setup',
        expect.objectContaining({
          qrCodeDataUrl: 'data:image/png;base64,abc',
          secret: 'JBSWY3DPEHPK3PXP',
        }),
        mockReqWithSession,
      );
    });
  });

  describe('handleTotpSetup', () => {
    it('should redirect if code is missing', async () => {
      await controller.handleTotpSetup(
        realm,
        { code: '' },
        mockReqWithSession,
        mockRes as any,
      );

      expect(mockRes.redirect).toHaveBeenCalledWith(
        expect.stringContaining('error='),
      );
    });

    it('should redirect with error if code is invalid', async () => {
      mfaService.verifyAndActivateTotp.mockResolvedValue(null);

      await controller.handleTotpSetup(
        realm,
        { code: '000000' },
        mockReqWithSession,
        mockRes as any,
      );

      expect(mockRes.redirect).toHaveBeenCalledWith(
        expect.stringContaining('error='),
      );
    });

    it('should render recovery codes on successful activation', async () => {
      const recoveryCodes = ['CODE1', 'CODE2', 'CODE3'];
      mfaService.verifyAndActivateTotp.mockResolvedValue(recoveryCodes);

      await controller.handleTotpSetup(
        realm,
        { code: '123456' },
        mockReqWithSession,
        mockRes as any,
      );

      expect(themeRender.render).toHaveBeenCalledWith(
        mockRes,
        realm,
        'account',
        'totp-setup',
        expect.objectContaining({
          activated: true,
          recoveryCodes,
        }),
        mockReqWithSession,
      );
    });
  });

  describe('handleTotpDisable', () => {
    it('should redirect with error if no password provided', async () => {
      await controller.handleTotpDisable(
        realm,
        { currentPassword: '' },
        mockReqWithSession,
        mockRes as any,
      );

      expect(mockRes.redirect).toHaveBeenCalledWith(
        expect.stringContaining('error='),
      );
    });

    it('should redirect with error if password is incorrect', async () => {
      crypto.verifyPassword.mockResolvedValue(false);

      await controller.handleTotpDisable(
        realm,
        { currentPassword: 'wrong' },
        mockReqWithSession,
        mockRes as any,
      );

      expect(mockRes.redirect).toHaveBeenCalledWith(
        expect.stringContaining('error='),
      );
    });

    it('should disable TOTP and redirect with success', async () => {
      crypto.verifyPassword.mockResolvedValue(true);
      mfaService.disableTotp.mockResolvedValue(undefined);

      await controller.handleTotpDisable(
        realm,
        { currentPassword: 'correct' },
        mockReqWithSession,
        mockRes as any,
      );

      expect(mfaService.disableTotp).toHaveBeenCalledWith('user-1');
      expect(mockRes.redirect).toHaveBeenCalledWith(
        expect.stringContaining('success='),
      );
    });
  });
});
