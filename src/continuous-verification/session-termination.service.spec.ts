import { SessionTerminationService } from './session-termination.service.js';

describe('SessionTerminationService', () => {
  let service: SessionTerminationService;
  let prisma: any;
  let sessionsService: { revokeSession: jest.Mock };
  let sessionEvents: { emitSessionTerminated: jest.Mock };
  let emailService: { sendEmail: jest.Mock };

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
      realm: {
        findUnique: jest.fn().mockResolvedValue({ name: 'test-realm' }),
      },
    };
    sessionsService = { revokeSession: jest.fn().mockResolvedValue(undefined) };
    sessionEvents = { emitSessionTerminated: jest.fn() };
    emailService = { sendEmail: jest.fn().mockResolvedValue(undefined) };

    service = new SessionTerminationService(
      prisma,
      sessionsService as any,
      sessionEvents as any,
      emailService as any,
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

    it('emails the affected user with the realm name resolved from realmId', async () => {
      await service.terminateSessionById('sess-1', 'Impossible travel detected');

      expect(prisma.realm.findUnique).toHaveBeenCalledWith({
        where: { id: 'realm-1' },
        select: { name: true },
      });
      expect(emailService.sendEmail).toHaveBeenCalledWith(
        'test-realm',
        'alice@example.com',
        'Your session was ended',
        expect.stringContaining('Impossible travel detected'),
      );
    });

    it('escapes the username and reason in the email body', async () => {
      prisma.sessionRiskProfile.findUnique.mockResolvedValue({
        ...mockProfile,
        session: {
          ...mockProfile.session,
          user: { username: '<script>alert(1)</script>', email: 'alice@example.com' },
        },
      });

      await service.terminateSessionById('sess-1', '<img src=x onerror=alert(1)>');

      const html = emailService.sendEmail.mock.calls[0][3] as string;
      expect(html).not.toContain('<script>');
      expect(html).not.toContain('<img src=x onerror=alert(1)>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('does not email when the user has no email on file', async () => {
      prisma.sessionRiskProfile.findUnique.mockResolvedValue({
        ...mockProfile,
        session: {
          ...mockProfile.session,
          user: { username: 'alice', email: null },
        },
      });

      await service.terminateSessionById('sess-1');

      expect(emailService.sendEmail).not.toHaveBeenCalled();
    });

    it('does not throw and still completes termination when the email send fails', async () => {
      emailService.sendEmail.mockRejectedValue(new Error('SMTP down'));

      await expect(service.terminateSessionById('sess-1')).resolves.toBeUndefined();
      expect(sessionEvents.emitSessionTerminated).toHaveBeenCalled();
    });

    it('skips the email silently if the realm cannot be resolved', async () => {
      prisma.realm.findUnique.mockResolvedValue(null);

      await expect(service.terminateSessionById('sess-1')).resolves.toBeUndefined();
      expect(emailService.sendEmail).not.toHaveBeenCalled();
    });
  });
});
