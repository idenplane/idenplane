import { ContinuousVerificationScheduler } from './continuous-verification.scheduler.js';
import { NhiRotationScheduler } from '../nhi/nhi-rotation.scheduler.js';

/**
 * The once-per-cluster jobs run on the elected leader only (LeaderService);
 * on every other process each tick is a no-op.
 */
describe('scheduled jobs and leader election', () => {
  const makePrisma = () => ({
    sessionRiskProfile: { findMany: jest.fn().mockResolvedValue([]) },
    continuousRiskEvent: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    behavioralSample: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    devicePostureRecord: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    realm: { findMany: jest.fn().mockResolvedValue([]) },
  });
  const stepUp = {
    checkAndTriggerStepUp: jest.fn().mockResolvedValue(undefined),
  };
  const termination = {
    checkAndTerminateSessions: jest.fn().mockResolvedValue(undefined),
  };

  const scheduler = (leader: boolean) => {
    const prisma = makePrisma();
    const s = new ContinuousVerificationScheduler(
      prisma as any,
      {} as any,
      stepUp as any,
      termination as any,
      { isLeader: () => leader } as any,
    );
    return { s, prisma };
  };

  beforeEach(() => jest.clearAllMocks());

  it('does nothing on a process that is not the leader', async () => {
    const { s, prisma } = scheduler(false);
    await s.evaluateActiveSessions();
    await s.checkStepUpRequired();
    await s.checkTerminateRequired();
    await s.cleanupOldRiskData();
    await s.applyTrustDecay();
    expect(prisma.sessionRiskProfile.findMany).not.toHaveBeenCalled();
    expect(prisma.continuousRiskEvent.deleteMany).not.toHaveBeenCalled();
    expect(stepUp.checkAndTriggerStepUp).not.toHaveBeenCalled();
    expect(termination.checkAndTerminateSessions).not.toHaveBeenCalled();
  });

  it('runs every job on the leader', async () => {
    const { s, prisma } = scheduler(true);
    await s.evaluateActiveSessions();
    await s.checkStepUpRequired();
    await s.checkTerminateRequired();
    await s.cleanupOldRiskData();
    await s.applyTrustDecay();
    expect(prisma.sessionRiskProfile.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.continuousRiskEvent.deleteMany).toHaveBeenCalled();
    expect(stepUp.checkAndTriggerStepUp).toHaveBeenCalledTimes(1);
    expect(termination.checkAndTerminateSessions).toHaveBeenCalledTimes(1);
  });

  it('rotates NHI credentials on the leader only', async () => {
    for (const leader of [false, true]) {
      const prisma = makePrisma();
      const s = new NhiRotationScheduler(
        prisma as any,
        {} as any,
        {
          isLeader: () => leader,
        } as any,
      );
      await s.processRotations();
      expect(prisma.realm.findMany).toHaveBeenCalledTimes(leader ? 1 : 0);
    }
  });
});
