jest.mock('../crypto/jwk.service.js', () => ({ JwkService: jest.fn() }));

import { MfaController } from './mfa.controller.js';
import type { Realm } from '@prisma/client';

describe('MfaController', () => {
  let controller: MfaController;
  let mockMfaService: {
    getEnrolledFactors: jest.Mock;
    disableTotp: jest.Mock;
    disableSms: jest.Mock;
    disableAllFactors: jest.Mock;
  };
  let mockPrisma: {
    user: { findUnique: jest.Mock };
    loginSession: { findUnique: jest.Mock };
  };
  let mockStepUpService: {
    getSessionAcr: jest.Mock;
    satisfiesAcr: jest.Mock;
  };
  let mockLoginService: {
    validateLoginSession: jest.Mock;
  };
  let mockCrypto: {
    sha256: jest.Mock;
  };
  let mockWebAuthn: {
    countCredentials: jest.Mock;
    removeAllCredentials: jest.Mock;
    getUserCredentials: jest.Mock;
    removeCredential: jest.Mock;
  };

  const realm = { id: 'realm-1', name: 'test' } as Realm;
  const mockUser = { id: 'user-1', realmId: 'realm-1', email: 'test@test.com' };
  const mockSessionToken = 'valid-session-token';
  let mockSessions: { revokeAllUserSessions: jest.Mock };
  const mockTokenHash = 'hashed-token';
  const mockLoginSession = {
    id: 'session-1',
    userId: 'user-1',
    realmId: 'realm-1',
  };

  beforeEach(() => {
    mockMfaService = {
      getEnrolledFactors: jest.fn(),
      disableTotp: jest.fn(),
      disableSms: jest.fn(),
      disableAllFactors: jest.fn(),
    };

    mockPrisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(mockUser),
      },
      loginSession: {
        findUnique: jest.fn().mockResolvedValue(mockLoginSession),
      },
    };

    mockStepUpService = {
      getSessionAcr: jest.fn().mockResolvedValue('urn:idenplane:acr:mfa'),
      satisfiesAcr: jest.fn().mockReturnValue(true),
    };

    mockLoginService = {
      validateLoginSession: jest.fn().mockResolvedValue(mockUser),
    };

    mockSessions = {
      revokeAllUserSessions: jest.fn().mockResolvedValue(undefined),
    };

    mockCrypto = {
      sha256: jest.fn().mockReturnValue(mockTokenHash),
    };

    mockWebAuthn = {
      countCredentials: jest.fn().mockResolvedValue(0),
      removeAllCredentials: jest.fn().mockResolvedValue(0),
      getUserCredentials: jest.fn().mockResolvedValue([]),
      removeCredential: jest.fn().mockResolvedValue(undefined),
    };

    controller = new MfaController(
      mockMfaService as any,
      mockPrisma as any,
      mockStepUpService as any,
      mockLoginService as any,
      mockCrypto as any,
      mockSessions as any,
      mockWebAuthn as any,
    );
  });

  describe('getMfaStatus', () => {
    it('should look up the enrolled factors for the userId', async () => {
      mockMfaService.getEnrolledFactors.mockResolvedValue(['totp']);

      await controller.getMfaStatus(realm, 'user-1');

      expect(mockMfaService.getEnrolledFactors).toHaveBeenCalledWith('user-1');
    });

    it('reports every enrolled factor', async () => {
      mockMfaService.getEnrolledFactors.mockResolvedValue(['totp', 'sms']);

      const result = await controller.getMfaStatus(realm, 'user-1');

      expect(result).toEqual({
        enabled: true,
        methods: ['totp', 'sms'],
        passkeys: 0,
      });
    });

    it('counts an SMS-only user as enabled', async () => {
      mockMfaService.getEnrolledFactors.mockResolvedValue(['sms']);

      const result = await controller.getMfaStatus(realm, 'user-1');

      expect(result).toEqual({ enabled: true, methods: ['sms'], passkeys: 0 });
    });

    it('should return { enabled: false } when MFA is disabled', async () => {
      mockMfaService.getEnrolledFactors.mockResolvedValue([]);

      const result = await controller.getMfaStatus(realm, 'user-2');

      expect(result).toEqual({ enabled: false, methods: [], passkeys: 0 });
    });

    it('counts passkeys apart from the second factors', async () => {
      mockMfaService.getEnrolledFactors.mockResolvedValue([]);
      mockWebAuthn.countCredentials.mockResolvedValue(2);

      const result = await controller.getMfaStatus(realm, 'user-1');

      expect(result).toEqual({ enabled: false, methods: [], passkeys: 2 });
      expect(mockWebAuthn.countCredentials).toHaveBeenCalledWith(
        'user-1',
        'realm-1',
      );
    });

    it('should throw NotFoundException for user in different realm', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        realmId: 'other-realm',
      });

      await expect(controller.getMfaStatus(realm, 'user-1')).rejects.toThrow(
        'not found in realm',
      );
    });
  });

  describe('resetMfa', () => {
    const mockReq = {
      cookies: { IDENPLANE_SESSION: mockSessionToken },
      adminUser: { userId: 'user-1' },
    } as any;

    it('removes every second factor of the user', async () => {
      mockMfaService.disableAllFactors.mockResolvedValue(undefined);

      await controller.resetMfa(realm, 'user-1', mockReq);

      expect(mockMfaService.disableAllFactors).toHaveBeenCalledWith('user-1');
    });

    it('removes the passkeys too by default, scoped to the realm', async () => {
      await controller.resetMfa(realm, 'user-1', mockReq);

      expect(mockWebAuthn.removeAllCredentials).toHaveBeenCalledWith(
        'user-1',
        'realm-1',
      );
      expect(
        mockSessions.revokeAllUserSessions.mock.invocationCallOrder[0],
      ).toBeGreaterThan(
        mockWebAuthn.removeAllCredentials.mock.invocationCallOrder[0],
      );
    });

    it.each([undefined, '', 'false'])(
      'keepPasskeys=%p removes them',
      async (value) => {
        await controller.resetMfa(realm, 'user-1', mockReq, value);
        expect(mockWebAuthn.removeAllCredentials).toHaveBeenCalled();
      },
    );

    it('keepPasskeys=true keeps them, and still ends the sessions', async () => {
      await controller.resetMfa(realm, 'user-1', mockReq, 'true');

      expect(mockMfaService.disableAllFactors).toHaveBeenCalledWith('user-1');
      expect(mockWebAuthn.removeAllCredentials).not.toHaveBeenCalled();
      expect(mockSessions.revokeAllUserSessions).toHaveBeenCalledWith(
        realm,
        'user-1',
      );
    });

    it.each(['yes', '1', 'TRUE'])(
      'refuses keepPasskeys=%p before changing anything',
      async (value) => {
        await expect(
          controller.resetMfa(realm, 'user-1', mockReq, value),
        ).rejects.toThrow('keepPasskeys must be true or false');
        expect(mockMfaService.disableAllFactors).not.toHaveBeenCalled();
        expect(mockWebAuthn.removeAllCredentials).not.toHaveBeenCalled();
      },
    );

    it('removes nothing without the step-up', async () => {
      await expect(
        controller.resetMfa(realm, 'user-1', {
          adminUser: { userId: 'api-key:abc' },
        } as any),
      ).rejects.toThrow('Static admin API keys');
      expect(mockWebAuthn.removeAllCredentials).not.toHaveBeenCalled();
    });

    it("ends the user's sessions after removing the factors", async () => {
      await controller.resetMfa(realm, 'user-1', mockReq);

      expect(mockSessions.revokeAllUserSessions).toHaveBeenCalledWith(
        realm,
        'user-1',
      );
      expect(
        mockSessions.revokeAllUserSessions.mock.invocationCallOrder[0],
      ).toBeGreaterThan(
        mockMfaService.disableAllFactors.mock.invocationCallOrder[0],
      );
    });

    it('ends the sessions when only the TOTP or the SMS factor is removed', async () => {
      await controller.resetTotp(realm, 'user-1', mockReq);
      await controller.resetSms(realm, 'user-1', mockReq);

      expect(mockMfaService.disableTotp).toHaveBeenCalledWith('user-1');
      expect(mockMfaService.disableSms).toHaveBeenCalledWith('user-1');
      expect(mockSessions.revokeAllUserSessions).toHaveBeenCalledTimes(2);
    });

    it('should throw UnauthorizedException when no adminUser is present', async () => {
      const reqWithoutAdmin = {
        cookies: { IDENPLANE_SESSION: mockSessionToken },
      } as any;

      await expect(
        controller.resetMfa(realm, 'user-1', reqWithoutAdmin),
      ).rejects.toThrow('Admin identity could not be determined');
    });

    it('should throw UnauthorizedException for API key authentication', async () => {
      const reqWithApiKey = {
        cookies: { IDENPLANE_SESSION: mockSessionToken },
        adminUser: { userId: 'api-key:abc123' },
      } as any;

      await expect(
        controller.resetMfa(realm, 'user-1', reqWithApiKey),
      ).rejects.toThrow('Static admin API keys cannot disable user MFA');
    });

    it('should throw UnauthorizedException when no session token is present', async () => {
      const reqWithoutSession = { adminUser: { userId: 'user-1' } } as any;

      await expect(
        controller.resetMfa(realm, 'user-1', reqWithoutSession),
      ).rejects.toThrow('verify your second factor in the admin console');
    });

    it('accepts the console step-up: an admin token with a recent MFA check', async () => {
      const req = {
        adminUser: {
          userId: 'user-1',
          acr: 'urn:idenplane:acr:mfa',
          authTime: Math.floor(Date.now() / 1000) - 60,
        },
      } as any;

      await controller.resetMfa(realm, 'user-1', req);

      expect(mockMfaService.disableAllFactors).toHaveBeenCalledWith('user-1');
      expect(mockLoginService.validateLoginSession).not.toHaveBeenCalled();
    });

    it('does not accept a stale admin MFA check', async () => {
      const req = {
        adminUser: {
          userId: 'user-1',
          acr: 'urn:idenplane:acr:mfa',
          authTime: Math.floor(Date.now() / 1000) - 3600,
        },
      } as any;

      await expect(controller.resetMfa(realm, 'user-1', req)).rejects.toThrow(
        'MFA step-up is required',
      );
    });

    it('should throw UnauthorizedException when session ACR does not satisfy MFA', async () => {
      mockStepUpService.satisfiesAcr.mockReturnValue(false);

      await expect(
        controller.resetMfa(realm, 'user-1', mockReq),
      ).rejects.toThrow('MFA step-up is required');
    });
  });

  describe('passkeys', () => {
    const mockReq = {
      cookies: { IDENPLANE_SESSION: mockSessionToken },
      adminUser: { userId: 'user-1' },
    } as any;
    const credential = (id: string, realmId = 'realm-1') => ({
      id,
      realmId,
      userId: 'user-1',
      credentialId: 'raw',
      publicKey: Buffer.from('k'),
      counter: 0n,
      friendlyName: 'Phone',
      deviceType: 'multiDevice',
      backedUp: true,
      transports: ['internal'],
      createdAt: new Date('2026-01-01'),
      lastUsedAt: null,
    });

    it("lists the user's passkeys in this realm, without key material", async () => {
      mockWebAuthn.getUserCredentials.mockResolvedValue([
        credential('c1'),
        credential('c2', 'other-realm'),
      ]);

      const list = await controller.listPasskeys(realm, 'user-1');

      expect(list).toEqual([
        {
          id: 'c1',
          friendlyName: 'Phone',
          deviceType: 'multiDevice',
          backedUp: true,
          transports: ['internal'],
          createdAt: new Date('2026-01-01'),
          lastUsedAt: null,
        },
      ]);
    });

    it('listing a user of another realm is a 404', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        realmId: 'other-realm',
      });
      await expect(controller.listPasskeys(realm, 'user-1')).rejects.toThrow(
        'not found in realm',
      );
      expect(mockWebAuthn.getUserCredentials).not.toHaveBeenCalled();
    });

    it('removes one passkey, scoped to the user and realm, then ends the sessions', async () => {
      await controller.removePasskey(realm, 'user-1', 'c1', mockReq);

      expect(mockWebAuthn.removeCredential).toHaveBeenCalledWith(
        'user-1',
        'realm-1',
        'c1',
      );
      expect(mockSessions.revokeAllUserSessions).toHaveBeenCalledWith(
        realm,
        'user-1',
      );
    });

    it('removing a passkey needs the MFA step-up: the API key is refused', async () => {
      await expect(
        controller.removePasskey(realm, 'user-1', 'c1', {
          adminUser: { userId: 'api-key:abc' },
        } as any),
      ).rejects.toThrow('Static admin API keys');
      expect(mockWebAuthn.removeCredential).not.toHaveBeenCalled();
      expect(mockSessions.revokeAllUserSessions).not.toHaveBeenCalled();
    });
  });
});
