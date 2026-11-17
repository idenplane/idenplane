import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import {
  AdminMfaService,
  ADMIN_MFA_CHALLENGE,
  ADMIN_MFA_CHALLENGE_MAX_ATTEMPTS,
  proofFor,
} from './admin-mfa.service.js';
import { createMockPrismaService } from '../prisma/prisma.mock.js';

const master = {
  id: 'master-id',
  name: 'master',
  webAuthnRpId: null,
  bruteForceEnabled: true,
};
const admin = {
  id: 'admin-1',
  realmId: 'master-id',
  username: 'sample-admin',
  enabled: true,
  lockedUntil: null,
};
const actor = { userId: 'admin-1', ipAddress: '10.0.0.1' };

describe('AdminMfaService', () => {
  let prisma: any;
  let crypto: { sha256: jest.Mock; generateSecret: jest.Mock };
  let mfa: Record<string, jest.Mock>;
  let webAuthn: Record<string, jest.Mock>;
  let bruteForce: Record<string, jest.Mock>;
  let events: { recordAdminEvent: jest.Mock; recordLoginEvent: jest.Mock };
  let principals: { adminMfaPolicy: jest.Mock };
  let env: Record<string, string | undefined>;
  let sessions: { revokeAllUserSessions: jest.Mock };
  let service: AdminMfaService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    prisma.realm.findUnique.mockResolvedValue(master);
    prisma.user.findUnique.mockResolvedValue(admin);
    prisma.userCredential.findFirst = jest.fn().mockResolvedValue(null);
    prisma.userCredential.count = jest.fn().mockResolvedValue(0);
    prisma.userCredential.deleteMany = jest.fn();
    prisma.webAuthnCredential.count = jest.fn().mockResolvedValue(0);
    prisma.webAuthnCredential.findFirst = jest.fn();
    prisma.webAuthnCredential.findMany = jest.fn().mockResolvedValue([]);
    prisma.webAuthnCredential.deleteMany = jest.fn();
    prisma.pendingAction.count = jest.fn().mockResolvedValue(0);
    prisma.pendingAction.updateMany = jest.fn();
    prisma.pendingAction.deleteMany = jest.fn().mockResolvedValue({ count: 0 });
    crypto = {
      sha256: jest.fn((v: string) => `h(${v})`),
      generateSecret: jest.fn().mockReturnValue('challenge-dummy'),
    };
    mfa = {
      verifyTotp: jest.fn(),
      verifyRecoveryCode: jest.fn(),
      getRecoveryCodeStatus: jest
        .fn()
        .mockResolvedValue({ remaining: 0, oldFormat: false }),
      setupTotp: jest.fn().mockResolvedValue({ secret: 'S' }),
      verifyAndActivateTotp: jest.fn(),
      claimTotpCode: jest.fn().mockResolvedValue(true),
      ensureRecoveryCodes: jest.fn().mockResolvedValue(['code-a']),
      generateRecoveryCodes: jest.fn().mockResolvedValue(['code-b']),
      disableAllFactors: jest.fn(),
    };
    webAuthn = {
      generateAuthenticationOptions: jest.fn().mockResolvedValue({}),
      verifyAuthentication: jest.fn(),
      generateRegistrationOptions: jest.fn().mockResolvedValue({}),
      verifyRegistration: jest
        .fn()
        .mockResolvedValue({ id: 'pk-1', friendlyName: 'Key' }),
    };
    bruteForce = {
      checkLocked: jest.fn().mockReturnValue({ locked: false }),
      checkTotpRateLimit: jest.fn().mockResolvedValue({ blocked: false }),
      recordTotpFailure: jest.fn(),
      resetTotpFailures: jest.fn(),
    };
    events = {
      recordAdminEvent: jest.fn().mockResolvedValue(undefined),
      recordLoginEvent: jest.fn().mockResolvedValue(undefined),
    };
    principals = {
      adminMfaPolicy: jest
        .fn()
        .mockResolvedValue({ required: false, source: 'setting' }),
    };
    env = { BASE_URL: 'https://id.example.com' };
    sessions = {
      revokeAllUserSessions: jest.fn().mockResolvedValue(undefined),
    };
    service = new AdminMfaService(
      prisma,
      crypto as any,
      mfa as any,
      webAuthn as any,
      bruteForce as any,
      events as any,
      principals as any,
      { get: (k: string) => env[k] } as any,
      sessions as any,
    );
  });

  const withTotp = () =>
    prisma.userCredential.findFirst.mockResolvedValue({ id: 'totp-1' });

  describe('the sign-in challenge', () => {
    it('stores only the hash, under its own pending-action type', async () => {
      const token = await service.createChallenge('admin-1');
      expect(token).toBe('challenge-dummy');
      const data = prisma.pendingAction.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        tokenHash: 'h(challenge-dummy)',
        type: ADMIN_MFA_CHALLENGE,
        data: { userId: 'admin-1' },
      });
      expect(JSON.stringify(data)).not.toContain('"challenge-dummy"');
    });

    it('limits how many challenges one admin can have in a window', async () => {
      prisma.pendingAction.count.mockResolvedValue(5);
      await expect(service.createChallenge('admin-1')).rejects.toBeInstanceOf(
        HttpException,
      );
    });

    it('spends an attempt atomically before anything is checked', async () => {
      prisma.pendingAction.updateMany.mockResolvedValue({ count: 1 });
      prisma.pendingAction.findUnique.mockResolvedValue({
        data: { userId: 'admin-1' },
      });
      await expect(service.spendChallengeAttempt('t')).resolves.toEqual({
        userId: 'admin-1',
      });
      expect(prisma.pendingAction.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          tokenHash: 'h(t)',
          type: ADMIN_MFA_CHALLENGE,
          attempts: { lt: ADMIN_MFA_CHALLENGE_MAX_ATTEMPTS },
        }),
        data: { attempts: { increment: 1 } },
      });
    });

    it('drops a spent, expired or unknown challenge', async () => {
      prisma.pendingAction.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.spendChallengeAttempt('t')).resolves.toBeNull();
      expect(prisma.pendingAction.deleteMany).toHaveBeenCalledWith({
        where: { tokenHash: 'h(t)', type: ADMIN_MFA_CHALLENGE },
      });
    });

    it('ignores a hosted-login MFA challenge', async () => {
      prisma.pendingAction.findUnique.mockResolvedValue({
        type: 'mfa_challenge',
        expiresAt: new Date(Date.now() + 60_000),
        attempts: 0,
        data: { userId: 'admin-1' },
      });
      await expect(service.peekChallenge('t')).resolves.toBeNull();
    });

    it('lets one request consume it', async () => {
      prisma.pendingAction.deleteMany.mockResolvedValueOnce({ count: 1 });
      expect(await service.consumeChallenge('t')).toBe(true);
      expect(await service.consumeChallenge('t')).toBe(false);
    });
  });

  describe('verifyCode', () => {
    it('accepts a TOTP code and clears the second-factor failures', async () => {
      mfa.verifyTotp.mockResolvedValue(true);
      await expect(
        service.verifyCode('admin-1', 'totp', ' 123456 ', '10.0.0.1'),
      ).resolves.toEqual(proofFor('totp'));
      expect(mfa.verifyTotp).toHaveBeenCalledWith('admin-1', '123456');
      expect(bruteForce.resetTotpFailures).toHaveBeenCalledWith(
        'master-id',
        'admin-1',
      );
    });

    it('counts a wrong code against the brute-force limits and logs it', async () => {
      mfa.verifyTotp.mockResolvedValue(false);
      await expect(
        service.verifyCode('admin-1', 'totp', '000000', '10.0.0.1'),
      ).resolves.toBeNull();
      expect(bruteForce.recordTotpFailure).toHaveBeenCalledWith(
        master,
        'admin-1',
        '10.0.0.1',
      );
      expect(events.recordLoginEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'MFA_VERIFY_ERROR',
          userId: 'admin-1',
        }),
      );
    });

    it('checks a recovery code with the recovery-code store', async () => {
      mfa.verifyRecoveryCode.mockResolvedValue(true);
      await expect(
        service.verifyCode(
          'admin-1',
          'recovery',
          'abcdef-ghijkl-mnopqr-stuvwx',
        ),
      ).resolves.toEqual({
        method: 'recovery',
        amr: ['pwd', 'mfa'],
        acr: 'urn:idenplane:acr:mfa',
      });
      expect(mfa.verifyTotp).not.toHaveBeenCalled();
    });

    it('refuses with 429, without checking the code, while locked', async () => {
      bruteForce.checkLocked.mockReturnValue({ locked: true });
      await expect(
        service.verifyCode('admin-1', 'totp', '123456'),
      ).rejects.toBeInstanceOf(HttpException);
      bruteForce.checkLocked.mockReturnValue({ locked: false });
      bruteForce.checkTotpRateLimit.mockResolvedValue({ blocked: true });
      await expect(
        service.verifyCode('admin-1', 'totp', '123456'),
      ).rejects.toBeInstanceOf(HttpException);
      expect(mfa.verifyTotp).not.toHaveBeenCalled();
    });

    it('never accepts an empty or oversized answer', async () => {
      expect(await service.verifyCode('admin-1', 'totp', '  ')).toBeNull();
      expect(
        await service.verifyCode('admin-1', 'recovery', 'x'.repeat(65)),
      ).toBeNull();
      expect(mfa.verifyRecoveryCode).not.toHaveBeenCalled();
    });
  });

  describe('passkeys', () => {
    it("checks an assertion under the console's relying party, pinned to the admin", async () => {
      webAuthn.verifyAuthentication.mockResolvedValue({});
      await expect(
        service.verifyPasskey('admin-1', {} as any, 'bind'),
      ).resolves.toEqual(proofFor('passkey'));
      const args = webAuthn.verifyAuthentication.mock.calls[0];
      expect(args[0]).toBe(master);
      expect(args[2]).toBe('bind');
      expect(args[4]).toBe('admin-1');
      expect(args[5]).toEqual({
        id: 'id.example.com',
        name: 'Idenplane admin console',
        origins: ['https://id.example.com'],
        userVerificationRequired: false,
      });
    });

    it('counts a refused assertion as a failure', async () => {
      webAuthn.verifyAuthentication.mockRejectedValue(new Error('bad'));
      await expect(
        service.verifyPasskey('admin-1', {} as any, 'bind', 'ip'),
      ).resolves.toBeNull();
      expect(bruteForce.recordTotpFailure).toHaveBeenCalled();
    });

    it('offers passkey options only to an admin who has one', async () => {
      await expect(
        service.passkeyOptions('admin-1', 'bind'),
      ).rejects.toBeInstanceOf(BadRequestException);
      prisma.webAuthnCredential.count.mockResolvedValue(1);
      await service.passkeyOptions('admin-1', 'bind');
      expect(webAuthn.generateAuthenticationOptions).toHaveBeenCalledWith(
        master,
        'admin-1',
        'bind',
        expect.objectContaining({ id: 'id.example.com' }),
      );
    });

    it('registers a first passkey with recovery codes and an audit event', async () => {
      const result = await service.registerPasskey(
        admin as any,
        {} as any,
        ' My key ',
        actor,
      );
      expect(result).toEqual({
        recoveryCodes: ['code-a'],
        passkey: { id: 'pk-1', name: 'Key' },
      });
      expect(webAuthn.verifyRegistration.mock.calls[0][3]).toBe('My key');
      expect(events.recordAdminEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceType: 'ADMIN_MFA',
          operationType: 'CREATE',
          always: true,
          representation: { action: 'enrol-passkey', userId: 'admin-1' },
        }),
      );
    });
  });

  describe('enrolment', () => {
    it('refuses a second authenticator app', async () => {
      withTotp();
      await expect(service.startTotp(admin)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(mfa.setupTotp).not.toHaveBeenCalled();
    });

    it('activates TOTP, claims the code and records it', async () => {
      mfa.verifyAndActivateTotp.mockResolvedValue(['c1', 'c2']);
      await expect(
        service.activateTotp('admin-1', '123456', actor),
      ).resolves.toEqual({ recoveryCodes: ['c1', 'c2'] });
      expect(mfa.claimTotpCode).toHaveBeenCalledWith('admin-1', '123456');
      expect(events.recordAdminEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          always: true,
          representation: { action: 'enrol-totp', userId: 'admin-1' },
        }),
      );
    });

    it('refuses a wrong or malformed activation code', async () => {
      mfa.verifyAndActivateTotp.mockResolvedValue(null);
      expect(await service.activateTotp('admin-1', '123456', actor)).toBeNull();
      expect(await service.activateTotp('admin-1', 'abc', actor)).toBeNull();
      expect(mfa.claimTotpCode).not.toHaveBeenCalled();
      expect(events.recordAdminEvent).not.toHaveBeenCalled();
    });
  });

  describe('removing factors', () => {
    it('refuses to remove the last factor while MFA is required', async () => {
      withTotp();
      principals.adminMfaPolicy.mockResolvedValue({
        required: true,
        source: 'setting',
      });
      await expect(service.removeTotp('admin-1', actor)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.userCredential.deleteMany).not.toHaveBeenCalled();
    });

    it('removes TOTP when a passkey is left, keeping the recovery codes', async () => {
      withTotp();
      prisma.webAuthnCredential.count.mockResolvedValue(1);
      principals.adminMfaPolicy.mockResolvedValue({
        required: true,
        source: 'setting',
      });
      await service.removeTotp('admin-1', actor);
      expect(prisma.userCredential.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'admin-1', type: 'totp' },
      });
      expect(prisma.recoveryCode.deleteMany).not.toHaveBeenCalled();
    });

    it('drops the recovery codes with the last factor when MFA is optional', async () => {
      // TOTP before the removal, none after it.
      prisma.userCredential.findFirst
        .mockResolvedValueOnce({ id: 'totp-1' })
        .mockResolvedValue(null);
      await service.removeTotp('admin-1', actor);
      expect(prisma.recoveryCode.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'admin-1' },
      });
    });

    it('removes only a passkey of this admin', async () => {
      prisma.webAuthnCredential.findFirst.mockResolvedValue(null);
      await expect(
        service.removePasskey('admin-1', 'pk-x', actor),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.webAuthnCredential.findFirst).toHaveBeenCalledWith({
        where: { id: 'pk-x', userId: 'admin-1' },
        select: { id: true },
      });
    });

    it('issues new recovery codes only to an admin with a factor', async () => {
      await expect(
        service.regenerateRecoveryCodes('admin-1', actor),
      ).rejects.toBeInstanceOf(BadRequestException);
      withTotp();
      await expect(
        service.regenerateRecoveryCodes('admin-1', actor),
      ).resolves.toEqual(['code-b']);
    });
  });

  describe('reset (super-admin or API key)', () => {
    beforeEach(() => {
      prisma.user.findFirst.mockResolvedValue({
        id: 'admin-2',
        username: 'other',
      });
    });

    it('removes every factor of the admin and records who did it', async () => {
      await service.reset('admin-2', {
        userId: 'api-key:admin',
        ipAddress: '10.0.0.9',
      });
      expect(mfa.disableAllFactors).toHaveBeenCalledWith('admin-2');
      expect(prisma.webAuthnCredential.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'admin-2' },
      });
      // Signed out everywhere, console tokens included.
      expect(sessions.revokeAllUserSessions).toHaveBeenCalledWith(
        master,
        'admin-2',
      );
      expect(events.recordAdminEvent).toHaveBeenCalledWith({
        realmId: 'master-id',
        adminUserId: 'api-key:admin',
        operationType: 'DELETE',
        resourceType: 'ADMIN_MFA',
        resourcePath: 'admin-accounts/admin-2/mfa',
        representation: {
          action: 'reset-mfa',
          userId: 'admin-2',
          username: 'other',
          by: 'api-key',
        },
        ipAddress: '10.0.0.9',
        always: true,
      });
    });

    it('only resets a master realm account, and never your own', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(service.reset('admin-2', actor)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.reset('admin-1', actor)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mfa.disableAllFactors).not.toHaveBeenCalled();
      expect(sessions.revokeAllUserSessions).not.toHaveBeenCalled();
    });
  });

  describe('the requirement', () => {
    it('stores a change and records it', async () => {
      await expect(service.setPolicy(true, actor)).resolves.toEqual({
        required: true,
        source: 'setting',
      });
      expect(prisma.adminSecurityPolicy.upsert).toHaveBeenCalledWith({
        where: { id: 1 },
        create: { id: 1, mfaRequired: true, updatedBy: 'admin-1' },
        update: { mfaRequired: true, updatedBy: 'admin-1' },
      });
      expect(events.recordAdminEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          resourcePath: 'admin-mfa/policy',
          representation: {
            action: 'set-requirement',
            required: true,
            previous: false,
          },
          always: true,
        }),
      );
    });

    it('cannot be changed while ADMIN_MFA_REQUIRED fixes it', async () => {
      principals.adminMfaPolicy.mockResolvedValue({
        required: true,
        source: 'environment',
      });
      await expect(service.setPolicy(false, actor)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.adminSecurityPolicy.upsert).not.toHaveBeenCalled();
    });
  });

  it('offers only the methods the admin has', async () => {
    withTotp();
    mfa.getRecoveryCodeStatus.mockResolvedValue({
      remaining: 3,
      oldFormat: false,
    });
    await expect(service.methods('admin-1')).resolves.toEqual([
      'totp',
      'recovery',
    ]);
  });
});
