import { SessionStepUpTrigger } from './session-step-up-trigger.js';
import {
  createMockPrismaService,
  type MockPrismaService,
} from '../prisma/prisma.mock.js';
import { ACR_MFA, ACR_WEBAUTHN } from '../step-up/step-up.service.js';

describe('SessionStepUpTrigger', () => {
  let trigger: SessionStepUpTrigger;
  let prisma: MockPrismaService & {
    sessionRiskProfile: Record<string, jest.Mock>;
    continuousRiskEvent: Record<string, jest.Mock>;
  };
  let sessionEvents: { emitStepUpRequired: jest.Mock };

  const baseProfile = {
    sessionId: 'session-1',
    riskScore: 65,
    riskLevel: 'HIGH' as const,
    stepUpReason: 'Impossible travel detected',
    stepUpExpiresAt: new Date(Date.now() + 60_000),
    session: {
      id: 'session-1',
      userId: 'user-1',
      realmId: 'realm-1',
      clientId: null,
      user: { username: 'alice', email: 'alice@example.com' },
    },
  };

  beforeEach(() => {
    prisma = createMockPrismaService() as typeof prisma;
    prisma.sessionRiskProfile = {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      // The claim that announces an episode once: succeeds unless told not to.
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    prisma.continuousRiskEvent = { create: jest.fn().mockResolvedValue({}) };
    prisma.client.findUnique = jest.fn();
    prisma.client.update = jest.fn();

    sessionEvents = { emitStepUpRequired: jest.fn() };

    trigger = new SessionStepUpTrigger(prisma as any, sessionEvents as any);
  });

  describe('triggerStepUpForSession', () => {
    it('pushes a real-time step-up event to the session owner', async () => {
      prisma.sessionRiskProfile.findUnique.mockResolvedValue(baseProfile);

      await trigger.triggerStepUpForSession('session-1');

      expect(sessionEvents.emitStepUpRequired).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          sessionId: 'session-1',
          requiredAcr: ACR_MFA,
          reason: 'Impossible travel detected',
        }),
      );
    });

    it('requires WebAuthn for critical risk scores instead of MFA', async () => {
      prisma.sessionRiskProfile.findUnique.mockResolvedValue({
        ...baseProfile,
        riskScore: 85,
      });

      await trigger.triggerStepUpForSession('session-1');

      expect(sessionEvents.emitStepUpRequired).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ requiredAcr: ACR_WEBAUTHN }),
      );
    });

    it('uses the override reason over the stored one when provided', async () => {
      prisma.sessionRiskProfile.findUnique.mockResolvedValue(baseProfile);

      await trigger.triggerStepUpForSession(
        'session-1',
        'Manually triggered by admin',
      );

      expect(sessionEvents.emitStepUpRequired).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ reason: 'Manually triggered by admin' }),
      );
    });

    it('throws when no risk profile exists for the session', async () => {
      prisma.sessionRiskProfile.findUnique.mockResolvedValue(null);

      await expect(
        trigger.triggerStepUpForSession('missing-session'),
      ).rejects.toThrow('Session risk profile not found');
      expect(sessionEvents.emitStepUpRequired).not.toHaveBeenCalled();
    });

    it('does not push an event when the profile has no attached session', async () => {
      prisma.sessionRiskProfile.findUnique.mockResolvedValue({
        ...baseProfile,
        session: null,
      });

      await trigger.triggerStepUpForSession('session-1');

      expect(sessionEvents.emitStepUpRequired).not.toHaveBeenCalled();
    });
  });

  describe('what a step-up does not do', () => {
    it('never raises the requiredAcr of the whole client', async () => {
      prisma.sessionRiskProfile.findUnique.mockResolvedValue({
        ...baseProfile,
        session: { ...baseProfile.session, clientId: 'client-1' },
      });
      await trigger.triggerStepUpForSession('session-1');
      expect(prisma.client.update).not.toHaveBeenCalled();
    });
  });

  describe('checkAndTriggerStepUp', () => {
    it('announces a risk episode once, not on every run while it lasts', async () => {
      prisma.sessionRiskProfile.findMany.mockResolvedValue([baseProfile]);
      prisma.sessionRiskProfile.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValue({ count: 0 });

      await trigger.checkAndTriggerStepUp();
      await trigger.checkAndTriggerStepUp();
      await trigger.checkAndTriggerStepUp();

      expect(sessionEvents.emitStepUpRequired).toHaveBeenCalledTimes(1);
      expect(prisma.continuousRiskEvent.create).toHaveBeenCalledTimes(1);
      expect(prisma.sessionRiskProfile.updateMany).toHaveBeenCalledWith({
        where: { sessionId: 'session-1', stepUpNotifiedAt: null },
        data: { stepUpNotifiedAt: expect.any(Date) },
      });
    });

    it('processes every session found by the scheduled query and pushes an event for each', async () => {
      prisma.sessionRiskProfile.findMany.mockResolvedValue([
        baseProfile,
        {
          ...baseProfile,
          sessionId: 'session-2',
          session: {
            ...baseProfile.session,
            id: 'session-2',
            userId: 'user-2',
          },
        },
      ]);

      await trigger.checkAndTriggerStepUp();

      expect(sessionEvents.emitStepUpRequired).toHaveBeenCalledTimes(2);
      expect(sessionEvents.emitStepUpRequired).toHaveBeenCalledWith(
        'user-2',
        expect.objectContaining({ sessionId: 'session-2' }),
      );
    });

    it('does nothing when no sessions require step-up', async () => {
      prisma.sessionRiskProfile.findMany.mockResolvedValue([]);

      await trigger.checkAndTriggerStepUp();

      expect(sessionEvents.emitStepUpRequired).not.toHaveBeenCalled();
    });
  });
});
