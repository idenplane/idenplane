import { SessionTerminationService } from './session-termination.service.js';

describe('SessionTerminationService', () => {
  let service: SessionTerminationService;
  let prisma: any;
  let sessionsService: { revokeSession: jest.Mock };
  let sessionEvents: { emitSessionTerminated: jest.Mock };

  const mockProfile = {
    sessionId: 'sess-1',
    riskScore: 95,
    riskLevel: 'CRITICAL',
    terminationReason: null,
    session: {
      id: 'sess-1',
      userId: 'user-1',
      realmId: 'realm-1',
      clientId: 'client-1',
      user: { username: 'alice', email: 'alice@example.com' },
    },
  };

  beforeEach(() => {
    prisma = {
      sessionRiskProfile: {
        findMany: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(mockProfile),
        update: jest.fn().mockResolvedValue({}),
      },
      continuousRiskEvent: {
        create: jest.fn().mockResolvedValue({}),
      },
    };
    sessionsService = { revokeSession: jest.fn().mockResolvedValue(undefined) };
    sessionEvents = { emitSessionTerminated: jest.fn() };

    service = new SessionTerminationService(
      prisma,
      sessionsService as any,
      sessionEvents as any,
    );
  });

  describe('terminateSessionById', () => {
    it('pushes a session.terminated event to the affected user over the realtime gateway', async () => {
      await service.terminateSessionById('sess-1', 'Impossible travel detected');

      expect(sessionEvents.emitSessionTerminated).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          sessionId: 'sess-1',
          reason: 'Impossible travel detected',
          timestamp: expect.any(String),
        }),
      );
    });

    it('falls back to the profile termination reason when none is given', async () => {
      prisma.sessionRiskProfile.findUnique.mockResolvedValue({
        ...mockProfile,
        terminationReason: 'Stored reason',
      });

      await service.terminateSessionById('sess-1');

      expect(sessionEvents.emitSessionTerminated).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ reason: 'Stored reason' }),
      );
    });

    it('throws if no risk profile exists for the session', async () => {
      prisma.sessionRiskProfile.findUnique.mockResolvedValue(null);

      await expect(service.terminateSessionById('missing')).rejects.toThrow(
        'Session risk profile not found for session: missing',
      );
      expect(sessionEvents.emitSessionTerminated).not.toHaveBeenCalled();
    });

    it('revokes the session via SessionsService', async () => {
      await service.terminateSessionById('sess-1');

      expect(sessionsService.revokeSession).toHaveBeenCalledWith(
        null,
        'sess-1',
        'oauth',
      );
    });
  });
});
