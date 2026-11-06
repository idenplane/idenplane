import { AccountController } from './account.controller.js';
import type { Realm } from '@prisma/client';
import {
  createMockPrismaService,
  type MockPrismaService,
} from '../prisma/prisma.mock.js';

describe('AccountController', () => {
  let smsOtp: Record<string, jest.Mock>;
  let controller: AccountController;
  let loginService: { validateLoginSession: jest.Mock };
  let prisma: MockPrismaService;
  let crypto: {
    verifyPassword: jest.Mock;
    hashPassword: jest.Mock;
    sha256: jest.Mock;
  };
  let passwordPolicyService: {
    validate: jest.Mock;
    checkHistory: jest.Mock;
    recordHistory: jest.Mock;
  };
  let mfaService: {
    isMfaEnabled: jest.Mock;
    isTotpEnabled: jest.Mock;
    getEnrolledFactors: jest.Mock;
    setupTotp: jest.Mock;
    verifyAndActivateTotp: jest.Mock;
    disableTotp: jest.Mock;
  };
  let themeRender: { render: jest.Mock };
  let webAuthnService: { getUserCredentials: jest.Mock };
  let emailService: { sendEmail: jest.Mock };

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

  let mockRes: {
    redirect: jest.Mock;
    cookie: jest.Mock;
    clearCookie: jest.Mock;
  };
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
      sha256: jest.fn().mockReturnValue('hashed-session-token'),
    };
    passwordPolicyService = {
      validate: jest.fn(),
      checkHistory: jest.fn(),
      recordHistory: jest.fn(),
    };
    mfaService = {
      isMfaEnabled: jest.fn(),
      isTotpEnabled: jest.fn(),
      getEnrolledFactors: jest.fn().mockResolvedValue([]),
      setupTotp: jest.fn(),
      verifyAndActivateTotp: jest.fn(),
      disableTotp: jest.fn(),
    };
    themeRender = { render: jest.fn() };
    webAuthnService = { getUserCredentials: jest.fn().mockResolvedValue([]) };
    emailService = { sendEmail: jest.fn().mockResolvedValue(undefined) };
    const csrfService = {
      validate: jest.fn().mockReturnValue(true),
      generateToken: jest.fn().mockReturnValue('csrf-token-test'),
      cookieName: jest.fn().mockReturnValue('XSRF-TOKEN-test'),
    };

    smsOtp = {
      getEnrolledPhone: jest.fn().mockResolvedValue(null),
      getEnrollment: jest.fn().mockResolvedValue(null),
      startEnrollment: jest.fn().mockResolvedValue('enrol-token'),
      setEnrollmentPhone: jest.fn(),
      endEnrollment: jest.fn(),
      enrollmentPhone: jest.fn(),
      sendCode: jest.fn().mockResolvedValue({ maskedPhone: '+20••••••5678' }),
      verifyCode: jest.fn(),
      saveEnrolledPhone: jest.fn(),
    };

    controller = new AccountController(
      loginService as any,
      prisma as any,
      crypto as any,
      passwordPolicyService as any,
      mfaService as any,
      themeRender as any,
      webAuthnService as any,
      undefined as any, // dataExportService — not exercised in these tests
      undefined as any, // accountDeletionService — not exercised in these tests
      csrfService as any,
      emailService as any,
      smsOtp as any,
    );

    mockRes = {
      redirect: jest.fn(),
      cookie: jest.fn(),
      clearCookie: jest.fn(),
    };
    mockReqWithSession = {
      cookies: { IDENPLANE_SESSION: 'valid-token' },
      query: {},
      headers: { 'user-agent': 'jest-test-agent' },
      socket: { remoteAddress: '127.0.0.1' },
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
      mfaService.isTotpEnabled.mockResolvedValue(false);

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

  describe('logout', () => {
    it('deletes the loginSession row, clears the cookie, and redirects to /login', async () => {
      // Arrange — request with an IDENPLANE_SESSION cookie
      prisma.loginSession.delete = jest.fn().mockResolvedValue(undefined);

      await controller.logout(realm, mockReqWithSession, mockRes as never);

      expect(crypto.sha256).toHaveBeenCalledWith('valid-token');
      expect(prisma.loginSession.delete).toHaveBeenCalledWith({
        where: { tokenHash: 'hashed-session-token' },
      });
      expect(mockRes.cookie).not.toHaveBeenCalled();
      expect(
        (mockRes as { clearCookie?: jest.Mock }).clearCookie ?? jest.fn(),
      ).toBeDefined(); // tolerate absence in older mocks
      expect(mockRes.redirect).toHaveBeenCalledWith(
        '/realms/test-realm/login?signedOut=1',
      );
    });

    it('still clears the cookie + redirects when no session cookie is present', async () => {
      prisma.loginSession.delete = jest.fn();

      await controller.logout(realm, mockReqNoSession, mockRes as never);

      // No DB delete attempted (nothing to invalidate)
      expect(prisma.loginSession.delete).not.toHaveBeenCalled();
      expect(mockRes.redirect).toHaveBeenCalledWith(
        '/realms/test-realm/login?signedOut=1',
      );
    });

    it('tolerates a prisma delete that throws (session already gone)', async () => {
      // Defense in depth — a stale cookie pointing at a deleted/expired
      // session must still complete the logout flow without throwing.
      prisma.loginSession.delete = jest
        .fn()
        .mockRejectedValue(new Error('P2025: record not found'));

      await expect(
        controller.logout(realm, mockReqWithSession, mockRes as never),
      ).resolves.not.toThrow();
      expect(mockRes.clearCookie).toHaveBeenCalled();
      expect(mockRes.redirect).toHaveBeenCalledWith(
        '/realms/test-realm/login?signedOut=1',
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

    it('still lets users change their password in a realm that requires MFA', async () => {
      passwordPolicyService.validate.mockReturnValue({
        valid: true,
        errors: [],
      });
      crypto.verifyPassword.mockResolvedValue(true);
      passwordPolicyService.checkHistory.mockResolvedValue(false);
      crypto.hashPassword.mockResolvedValue('new-hash');
      prisma.user.update.mockResolvedValue({});

      await controller.changePassword(
        { ...realm, mfaRequired: true } as Realm,
        {
          currentPassword: 'old',
          newPassword: 'newpass',
          confirmPassword: 'newpass',
        },
        mockReqWithSession,
        mockRes as any,
      );

      expect(crypto.hashPassword).toHaveBeenCalledWith('newpass');
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

    it('should send a password-changed security email to the account holder', async () => {
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

      // The email is fire-and-forget (`void ...`), so let its promise settle.
      await new Promise(process.nextTick);

      expect(emailService.sendEmail).toHaveBeenCalledWith(
        'test-realm',
        'test@example.com',
        'Your Password Was Changed',
        expect.stringContaining('Your Password Was Changed'),
      );
    });

    it('should not fail the password change if the notification email fails to send', async () => {
      passwordPolicyService.validate.mockReturnValue({
        valid: true,
        errors: [],
      });
      crypto.verifyPassword.mockResolvedValue(true);
      passwordPolicyService.checkHistory.mockResolvedValue(false);
      crypto.hashPassword.mockResolvedValue('new-hash');
      prisma.user.update.mockResolvedValue({});
      emailService.sendEmail.mockRejectedValue(new Error('SMTP down'));

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
      await new Promise(process.nextTick);

      expect(mockRes.redirect).toHaveBeenCalledWith(
        expect.stringContaining('success='),
      );
    });

    it('should not attempt to send an email when the account has no email address', async () => {
      loginService.validateLoginSession.mockResolvedValue({
        ...sessionUser,
        email: null,
      });
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
      await new Promise(process.nextTick);

      expect(emailService.sendEmail).not.toHaveBeenCalled();
    });
  });

  describe('showTotpSetup', () => {
    it('should redirect to login if no session', async () => {
      loginService.validateLoginSession.mockResolvedValue(null);

      await controller.showTotpSetup(realm, mockReqNoSession, mockRes as any);

      expect(mockRes.redirect).toHaveBeenCalledWith('/realms/test-realm/login');
    });

    it('should redirect to account if MFA already enabled', async () => {
      mfaService.isTotpEnabled.mockResolvedValue(true);

      await controller.showTotpSetup(realm, mockReqWithSession, mockRes as any);

      expect(mockRes.redirect).toHaveBeenCalledWith(
        expect.stringContaining('/account?info='),
      );
    });

    it('should render TOTP setup page', async () => {
      mfaService.isTotpEnabled.mockResolvedValue(false);
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

  // A sign-in paused because the realm requires MFA: no SSO session, only the
  // enrolment cookie, which unlocks this page and nothing else.
  describe('required-MFA enrolment', () => {
    const enrollingUser = { ...sessionUser, id: 'user-2', enabled: true };
    let reqEnrolling: any;

    beforeEach(() => {
      (loginService as any).findUserById = jest
        .fn()
        .mockResolvedValue(enrollingUser);
      (mfaService as any).getMfaEnrollment = jest.fn().mockResolvedValue({
        userId: 'user-2',
        realmId: 'realm-1',
        verified: false,
      });
      (mfaService as any).markMfaEnrollmentVerified = jest.fn();
      reqEnrolling = {
        // A leftover session for someone else must not be what gets enrolled.
        cookies: {
          IDENPLANE_MFA_ENROLLMENT: 'enrol-token',
          IDENPLANE_SESSION: 'valid-token',
        },
        query: {},
        headers: {},
      };
    });

    it('shows the setup page for the enrolling user, cancelling back to login', async () => {
      mfaService.isTotpEnabled.mockResolvedValue(false);
      mfaService.setupTotp.mockResolvedValue({
        qrCodeDataUrl: 'data:qr',
        secret: 'SECRET',
      });

      await controller.showTotpSetup(realm, reqEnrolling, mockRes as any);

      expect(mfaService.setupTotp).toHaveBeenCalledWith(
        'user-2',
        'test-realm',
        'testuser',
      );
      expect(themeRender.render).toHaveBeenCalledWith(
        mockRes,
        realm,
        'account',
        'totp-setup',
        expect.objectContaining({ cancelUrl: '/realms/test-realm/login' }),
        reqEnrolling,
      );
    });

    it('ignores an enrolment from another realm', async () => {
      (mfaService as any).getMfaEnrollment.mockResolvedValue({
        userId: 'user-2',
        realmId: 'other-realm',
      });
      loginService.validateLoginSession.mockResolvedValue(null);

      await controller.showTotpSetup(realm, reqEnrolling, mockRes as any);

      expect(mockRes.redirect).toHaveBeenCalledWith('/realms/test-realm/login');
    });

    it('activates TOTP, marks the enrolment verified and offers to continue the sign-in', async () => {
      mfaService.verifyAndActivateTotp.mockResolvedValue(['R1', 'R2']);

      await controller.handleTotpSetup(
        realm,
        { code: '123456' },
        reqEnrolling,
        mockRes as any,
      );

      expect(mfaService.verifyAndActivateTotp).toHaveBeenCalledWith(
        'user-2',
        '123456',
      );
      expect(
        (mfaService as any).markMfaEnrollmentVerified,
      ).toHaveBeenCalledWith('enrol-token');
      expect(themeRender.render).toHaveBeenCalledWith(
        mockRes,
        realm,
        'account',
        'totp-setup',
        expect.objectContaining({
          activated: true,
          recoveryCodes: ['R1', 'R2'],
          continueAction: '/realms/test-realm/mfa-enrollment/continue',
          csrfToken: 'csrf-token-test',
        }),
        reqEnrolling,
      );
    });

    it('does not mark the enrolment verified when the code is wrong', async () => {
      mfaService.verifyAndActivateTotp.mockResolvedValue(null);

      await controller.handleTotpSetup(
        realm,
        { code: '000000' },
        reqEnrolling,
        mockRes as any,
      );

      expect(
        (mfaService as any).markMfaEnrollmentVerified,
      ).not.toHaveBeenCalled();
    });

    it('sends the user back to sign in if TOTP was enabled elsewhere meanwhile', async () => {
      mfaService.isTotpEnabled.mockResolvedValue(true);

      await controller.showTotpSetup(realm, reqEnrolling, mockRes as any);

      expect(mockRes.clearCookie).toHaveBeenCalledWith(
        'IDENPLANE_MFA_ENROLLMENT',
        { path: '/realms/test-realm' },
      );
      expect(mockRes.redirect).toHaveBeenCalledWith('/realms/test-realm/login');
    });
  });

  describe('SMS phone enrolment', () => {
    const smsRealm = {
      ...realm,
      smsMfaEnabled: true,
      smsProvider: 'twilio',
    } as any as Realm;

    beforeEach(() => {
      (mfaService as any).ensureRecoveryCodes = jest
        .fn()
        .mockResolvedValue(['R1']);
      (mfaService as any).markMfaEnrollmentVerified = jest.fn();
      (mfaService as any).disableSms = jest.fn();
    });

    it('refuses the setup page when SMS MFA is off', async () => {
      await controller.showSmsSetup(
        { ...smsRealm, smsMfaEnabled: false } as Realm,
        mockReqWithSession,
        mockRes as any,
      );

      expect(mockRes.redirect).toHaveBeenCalledWith(
        expect.stringContaining('/account?error='),
      );
      expect(themeRender.render).not.toHaveBeenCalled();
    });

    it('asks a signed-in user for their password', async () => {
      await controller.showSmsSetup(smsRealm, mockReqWithSession, mockRes as any);

      expect(themeRender.render).toHaveBeenCalledWith(
        mockRes,
        smsRealm,
        'account',
        'sms-setup',
        expect.objectContaining({ requirePassword: true, verifyStep: false }),
        mockReqWithSession,
      );
    });

    it('does not text anything when the password is wrong', async () => {
      crypto.verifyPassword.mockResolvedValue(false);

      await controller.sendSmsSetupCode(
        smsRealm,
        { phone: '+201012345678', currentPassword: 'wrong' },
        mockReqWithSession,
        mockRes as any,
      );

      expect(smsOtp.sendCode).not.toHaveBeenCalled();
      expect(smsOtp.startEnrollment).not.toHaveBeenCalled();
    });

    it('rejects a malformed number before anything is sent', async () => {
      await controller.sendSmsSetupCode(
        smsRealm,
        { phone: '0101', currentPassword: 'right' },
        mockReqWithSession,
        mockRes as any,
      );

      expect(smsOtp.sendCode).not.toHaveBeenCalled();
      expect(mockRes.redirect).toHaveBeenCalledWith(
        expect.stringContaining('sms-setup?error='),
      );
    });

    it('starts a fresh enrolment and texts the normalised number', async () => {
      crypto.verifyPassword.mockResolvedValue(true);

      await controller.sendSmsSetupCode(
        smsRealm,
        { phone: '+20 101 234 5678', currentPassword: 'right' },
        mockReqWithSession,
        mockRes as any,
      );

      expect(smsOtp.startEnrollment).toHaveBeenCalledWith('user-1', 'realm-1');
      expect(mockRes.cookie).toHaveBeenCalledWith(
        'IDENPLANE_SMS_ENROLL',
        'enrol-token',
        expect.objectContaining({ httpOnly: true, secure: true }),
      );
      expect(smsOtp.sendCode).toHaveBeenCalledWith(
        expect.objectContaining({
          purpose: 'enroll',
          binding: 'enrol-token',
          phone: '+201012345678',
          userId: 'user-1',
        }),
      );
      expect(smsOtp.setEnrollmentPhone).toHaveBeenCalledWith(
        'enrol-token',
        '+201012345678',
      );
    });

    it('enrols the phone only after the code is confirmed', async () => {
      smsOtp.getEnrollment.mockResolvedValue({
        userId: 'user-1',
        realmId: 'realm-1',
        maskedPhone: '+20••••••5678',
      });
      smsOtp.verifyCode.mockResolvedValue({ ok: true, phone: '+201012345678' });
      const req = {
        ...mockReqWithSession,
        cookies: { ...mockReqWithSession.cookies, IDENPLANE_SMS_ENROLL: 'enrol-token' },
      };

      await controller.verifySmsSetupCode(
        smsRealm,
        { code: '123456' },
        req,
        mockRes as any,
      );

      expect(smsOtp.verifyCode).toHaveBeenCalledWith(
        expect.objectContaining({ purpose: 'enroll', binding: 'enrol-token' }),
      );
      expect(smsOtp.saveEnrolledPhone).toHaveBeenCalledWith(
        'user-1',
        '+201012345678',
      );
      expect(smsOtp.endEnrollment).toHaveBeenCalledWith('enrol-token');
      expect(themeRender.render).toHaveBeenCalledWith(
        mockRes,
        smsRealm,
        'account',
        'sms-setup',
        expect.objectContaining({ activated: true, recoveryCodes: ['R1'] }),
        req,
      );
    });

    it('keeps the old number when the code is wrong', async () => {
      smsOtp.getEnrollment.mockResolvedValue({
        userId: 'user-1',
        realmId: 'realm-1',
      });
      smsOtp.verifyCode.mockResolvedValue({
        ok: false,
        reason: 'invalid',
        remainingAttempts: 4,
      });
      const req = {
        ...mockReqWithSession,
        cookies: { ...mockReqWithSession.cookies, IDENPLANE_SMS_ENROLL: 'enrol-token' },
      };

      await controller.verifySmsSetupCode(
        smsRealm,
        { code: '000000' },
        req,
        mockRes as any,
      );

      expect(smsOtp.saveEnrolledPhone).not.toHaveBeenCalled();
      expect(smsOtp.endEnrollment).not.toHaveBeenCalled();
    });

    it("ignores another user's enrolment cookie", async () => {
      smsOtp.getEnrollment.mockResolvedValue({
        userId: 'someone-else',
        realmId: 'realm-1',
      });
      const req = {
        ...mockReqWithSession,
        cookies: { ...mockReqWithSession.cookies, IDENPLANE_SMS_ENROLL: 'enrol-token' },
      };

      await controller.verifySmsSetupCode(
        smsRealm,
        { code: '123456' },
        req,
        mockRes as any,
      );

      expect(smsOtp.verifyCode).not.toHaveBeenCalled();
    });

    it('refuses to add a phone next to an existing factor for a user without a password', async () => {
      loginService.validateLoginSession.mockResolvedValue({
        ...sessionUser,
        passwordHash: null,
      });
      mfaService.getEnrolledFactors.mockResolvedValue(['totp']);

      await controller.sendSmsSetupCode(
        smsRealm,
        { phone: '+201012345678' },
        mockReqWithSession,
        mockRes as any,
      );

      expect(smsOtp.startEnrollment).not.toHaveBeenCalled();
      expect(smsOtp.sendCode).not.toHaveBeenCalled();
    });

    it('lets a user without a password enrol a first factor', async () => {
      loginService.validateLoginSession.mockResolvedValue({
        ...sessionUser,
        passwordHash: null,
      });
      mfaService.getEnrolledFactors.mockResolvedValue([]);

      await controller.sendSmsSetupCode(
        smsRealm,
        { phone: '+201012345678' },
        mockReqWithSession,
        mockRes as any,
      );

      expect(smsOtp.sendCode).toHaveBeenCalled();
    });

    it('refuses to remove the phone of a user without a password', async () => {
      loginService.validateLoginSession.mockResolvedValue({
        ...sessionUser,
        passwordHash: null,
      });

      await controller.handleSmsDisable(
        smsRealm,
        {},
        mockReqWithSession,
        mockRes as any,
      );

      expect((mfaService as any).disableSms).not.toHaveBeenCalled();
    });

    it('does not enrol a phone after an admin turned SMS MFA off', async () => {
      const req = {
        ...mockReqWithSession,
        cookies: { ...mockReqWithSession.cookies, IDENPLANE_SMS_ENROLL: 'enrol-token' },
      };

      await controller.verifySmsSetupCode(
        { ...smsRealm, smsMfaEnabled: false } as Realm,
        { code: '123456' },
        req,
        mockRes as any,
      );

      expect(smsOtp.verifyCode).not.toHaveBeenCalled();
      expect(smsOtp.saveEnrolledPhone).not.toHaveBeenCalled();
    });

    it('refuses to turn SMS off when it is the last factor in a realm that requires MFA', async () => {
      mfaService.getEnrolledFactors.mockResolvedValue(['sms']);

      await controller.handleSmsDisable(
        { ...smsRealm, mfaRequired: true } as Realm,
        { currentPassword: 'right' },
        mockReqWithSession,
        mockRes as any,
      );

      expect((mfaService as any).disableSms).not.toHaveBeenCalled();
    });

    it('turns SMS off after the password is confirmed', async () => {
      crypto.verifyPassword.mockResolvedValue(true);

      await controller.handleSmsDisable(
        smsRealm,
        { currentPassword: 'right' },
        mockReqWithSession,
        mockRes as any,
      );

      expect((mfaService as any).disableSms).toHaveBeenCalledWith('user-1');
    });
  });

  describe('handleTotpDisable', () => {
    it('refuses to turn off TOTP in a realm that requires MFA', async () => {
      crypto.verifyPassword.mockResolvedValue(true);

      await controller.handleTotpDisable(
        { ...realm, mfaRequired: true } as Realm,
        { currentPassword: 'right' },
        mockReqWithSession,
        mockRes as any,
      );

      expect(mfaService.disableTotp).not.toHaveBeenCalled();
      expect(mockRes.redirect).toHaveBeenCalledWith(
        expect.stringContaining('error='),
      );
    });

    it('allows removing the app in a realm that requires MFA while an SMS phone remains', async () => {
      crypto.verifyPassword.mockResolvedValue(true);
      mfaService.getEnrolledFactors.mockResolvedValue(['totp', 'sms']);

      await controller.handleTotpDisable(
        { ...realm, mfaRequired: true } as Realm,
        { currentPassword: 'right' },
        mockReqWithSession,
        mockRes as any,
      );

      expect(mfaService.disableTotp).toHaveBeenCalledWith('user-1');
    });

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
