import {
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ImpersonationService } from './impersonation.service.js';
import {
  createMockPrismaService,
  type MockPrismaService,
} from '../prisma/prisma.mock.js';

// ─── Fixtures ────────────────────────────────────────────

const realm = {
  id: 'realm-1',
  name: 'testrealm',
  impersonationEnabled: true,
  impersonationMaxDuration: 1800,
} as any;

const realmDisabled = { ...realm, impersonationEnabled: false };

const adminUser = {
  id: 'admin-1',
  realmId: 'realm-1',
  username: 'admin',
  enabled: true,
};

const targetUser = {
  id: 'target-1',
  realmId: 'realm-1',
  username: 'target',
  enabled: true,
};

const signingKey = {
  id: 'key-1',
  realmId: 'realm-1',
  kid: 'kid-1',
  algorithm: 'RS256',
  publicKey: '-----BEGIN PUBLIC KEY-----\nfake\n-----END PUBLIC KEY-----',
  privateKey: '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----',
  active: true,
  createdAt: new Date(),
};

const session = {
  id: 'session-1',
  userId: 'target-1',
  expiresAt: new Date(Date.now() + 1800_000),
  createdAt: new Date(),
};

const impersonationSession = {
  id: 'imp-session-1',
  realmId: 'realm-1',
  adminUserId: 'admin-1',
  targetUserId: 'target-1',
  sessionId: 'session-1',
  active: true,
  expiresAt: new Date(Date.now() + 1800_000),
  endedAt: null,
  createdAt: new Date(),
};

// ─── Test suite ──────────────────────────────────────────

describe('ImpersonationService', () => {
  let service: ImpersonationService;
  let prisma: MockPrismaService;
  let jwkService: { signJwt: jest.Mock };
  let crypto: { generateSecret: jest.Mock; sha256: jest.Mock };
  let eventsService: {
    recordLoginEvent: jest.Mock;
    recordAdminEvent: jest.Mock;
  };

  beforeEach(() => {
    prisma = createMockPrismaService();

    jwkService = { signJwt: jest.fn().mockResolvedValue('signed-jwt') };

    crypto = {
      generateSecret: jest.fn().mockReturnValue('raw-refresh-token'),
      sha256: jest.fn().mockReturnValue('hashed-token'),
    };

    eventsService = {
      recordLoginEvent: jest.fn(),
      recordAdminEvent: jest.fn(),
    };

    service = new ImpersonationService(
      prisma as any,
      jwkService as any,
      crypto as any,
      eventsService as any,
    );
  });

  // ─── startImpersonation ──────────────────────────────────

  describe('startImpersonation', () => {
    beforeEach(() => {
      prisma.user.findUnique
        .mockResolvedValueOnce(targetUser) // target user lookup
        .mockResolvedValueOnce(adminUser); // admin user lookup
      prisma.session.create.mockResolvedValue(session);
      (prisma as any).impersonationSession = {
        create: jest.fn().mockResolvedValue(impersonationSession),
        findUnique: jest.fn(),
        update: jest.fn(),
      };
      prisma.realmSigningKey.findFirst.mockResolvedValue(signingKey);
      prisma.refreshToken.create.mockResolvedValue({});
    });

    it('returns tokens with impersonation claims on success', async () => {
      const result = await service.startImpersonation(
        realm,
        'admin-1',
        'target-1',
        '127.0.0.1',
      );

      expect(result).toMatchObject({
        access_token: 'signed-jwt',
        token_type: 'Bearer',
        expires_in: 1800,
        refresh_token: 'raw-refresh-token',
        impersonation_session_id: 'imp-session-1',
      });

      // Access token payload should carry impersonation claims
      const [payload] = jwkService.signJwt.mock.calls[0];
      expect(payload.impersonated).toBe(true);
      expect(payload.act).toEqual({ sub: 'admin-1' });
      expect(payload.sub).toBe('target-1');
    });

    it('throws ForbiddenException when impersonation is disabled on realm', async () => {
      await expect(
        service.startImpersonation(realmDisabled, 'admin-1', 'target-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when target user does not exist', async () => {
      prisma.user.findUnique.mockReset();
      prisma.user.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.startImpersonation(realm, 'admin-1', 'target-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when target user belongs to a different realm', async () => {
      prisma.user.findUnique.mockReset();
      prisma.user.findUnique.mockResolvedValueOnce({
        ...targetUser,
        realmId: 'other-realm',
      });

      await expect(
        service.startImpersonation(realm, 'admin-1', 'target-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when target user is disabled', async () => {
      prisma.user.findUnique.mockReset();
      prisma.user.findUnique.mockResolvedValueOnce({
        ...targetUser,
        enabled: false,
      });

      await expect(
        service.startImpersonation(realm, 'admin-1', 'target-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException on self-impersonation', async () => {
      prisma.user.findUnique.mockReset();
      prisma.user.findUnique
        .mockResolvedValueOnce(adminUser) // target (same id)
        .mockResolvedValueOnce(adminUser); // admin

      await expect(
        service.startImpersonation(realm, 'admin-1', 'admin-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when admin user does not exist', async () => {
      prisma.user.findUnique.mockReset();
      prisma.user.findUnique
        .mockResolvedValueOnce(targetUser) // target exists
        .mockResolvedValueOnce(null); // admin not found

      await expect(
        service.startImpersonation(realm, 'admin-1', 'target-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('records IMPERSONATION_START login event', async () => {
      await service.startImpersonation(
        realm,
        'admin-1',
        'target-1',
        '127.0.0.1',
      );

      expect(eventsService.recordLoginEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'IMPERSONATION_START',
          userId: 'target-1',
          realmId: 'realm-1',
        }),
      );
    });

    it('records admin event for audit trail', async () => {
      await service.startImpersonation(
        realm,
        'admin-1',
        'target-1',
        '127.0.0.1',
      );

      expect(eventsService.recordAdminEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          realmId: 'realm-1',
          adminUserId: 'admin-1',
          operationType: 'CREATE',
          resourceType: 'IMPERSONATION',
        }),
      );
    });

    it('stores a refresh token with the impersonation session duration', async () => {
      await service.startImpersonation(realm, 'admin-1', 'target-1');

      expect(prisma.refreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sessionId: 'session-1',
            tokenHash: 'hashed-token',
          }),
        }),
      );
    });
  });

  // ─── endImpersonation ────────────────────────────────────

  describe('endImpersonation', () => {
    beforeEach(() => {
      (prisma as any).impersonationSession = {
        findUnique: jest.fn().mockResolvedValue(impersonationSession),
        update: jest
          .fn()
          .mockResolvedValue({ ...impersonationSession, active: false }),
        create: jest.fn(),
      };
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
      prisma.session.delete.mockResolvedValue(session);
    });

    it('ends an active impersonation session successfully', async () => {
      await service.endImpersonation(
        realm,
        'imp-session-1',
        'admin-1',
        '127.0.0.1',
      );

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { sessionId: 'session-1' },
          data: { revoked: true },
        }),
      );

      expect((prisma as any).impersonationSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'imp-session-1' },
          data: expect.objectContaining({ active: false }),
        }),
      );
    });

    it('throws NotFoundException when impersonation session does not exist', async () => {
      (prisma as any).impersonationSession.findUnique.mockResolvedValue(null);

      await expect(
        service.endImpersonation(realm, 'imp-session-1', 'admin-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when session belongs to a different realm', async () => {
      (prisma as any).impersonationSession.findUnique.mockResolvedValue({
        ...impersonationSession,
        realmId: 'other-realm',
      });

      await expect(
        service.endImpersonation(realm, 'imp-session-1', 'admin-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when a different admin tries to end the session', async () => {
      await expect(
        service.endImpersonation(realm, 'imp-session-1', 'other-admin'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException when session is already ended', async () => {
      (prisma as any).impersonationSession.findUnique.mockResolvedValue({
        ...impersonationSession,
        active: false,
      });

      await expect(
        service.endImpersonation(realm, 'imp-session-1', 'admin-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('records IMPERSONATION_END login event', async () => {
      await service.endImpersonation(
        realm,
        'imp-session-1',
        'admin-1',
        '127.0.0.1',
      );

      expect(eventsService.recordLoginEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'IMPERSONATION_END',
          userId: 'target-1',
          realmId: 'realm-1',
        }),
      );
    });

    it('records admin event on end', async () => {
      await service.endImpersonation(
        realm,
        'imp-session-1',
        'admin-1',
        '127.0.0.1',
      );

      expect(eventsService.recordAdminEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          realmId: 'realm-1',
          adminUserId: 'admin-1',
          operationType: 'DELETE',
          resourceType: 'IMPERSONATION',
        }),
      );
    });
  });
});
