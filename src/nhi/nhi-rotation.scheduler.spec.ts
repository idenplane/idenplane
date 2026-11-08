import { NhiRotationScheduler } from './nhi-rotation.scheduler.js';

describe('NhiRotationScheduler', () => {
  const realm = { id: 'realm-1', name: 'acme' };
  const policy = {
    id: 'policy-1',
    credentialType: 'API_KEY',
    rotationIntervalDays: 90,
    rotationBeforeDays: 7,
  };
  const days = (n: number) => new Date(Date.now() - n * 86_400_000);

  const build = (
    credentials: Array<{ id: string; createdAt: Date }>,
    flipped = 1,
  ) => {
    const prisma = {
      realm: { findMany: jest.fn().mockResolvedValue([realm]) },
      nhiCredentialPolicy: { findMany: jest.fn().mockResolvedValue([policy]) },
      nhiCredential: {
        findMany: jest
          .fn()
          .mockResolvedValue(
            credentials.map((c) => ({
              ...c,
              nhiIdentityId: 'nhi-1',
              rotationRequired: false,
            })),
          ),
        updateMany: jest.fn().mockResolvedValue({ count: flipped }),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    const webhooks = { dispatchEvent: jest.fn().mockResolvedValue(undefined) };
    const scheduler = new NhiRotationScheduler(
      prisma as any,
      webhooks as any,
      {
        isLeader: () => true,
      } as any,
    );
    return { prisma, webhooks, scheduler };
  };

  it('flags a credential that has come due and announces it once', async () => {
    const { prisma, webhooks, scheduler } = build([
      { id: 'cred-1', createdAt: days(85) },
    ]);

    await scheduler.processRotations();

    expect(prisma.nhiCredential.updateMany).toHaveBeenCalledWith({
      where: { id: 'cred-1', revoked: false, rotationRequired: false },
      data: { rotationRequired: true },
    });
    expect(webhooks.dispatchEvent).toHaveBeenCalledWith({
      realmId: 'realm-1',
      eventType: 'nhi.credential.rotation_due',
      payload: {
        credentialId: 'cred-1',
        nhiIdentityId: 'nhi-1',
        policyId: 'policy-1',
      },
    });
  });

  it('never revokes the credential or creates a key nobody can learn', async () => {
    const { prisma, scheduler } = build([
      { id: 'cred-1', createdAt: days(85) },
    ]);
    await scheduler.processRotations();
    expect(prisma.nhiCredential.create).not.toHaveBeenCalled();
    expect(prisma.nhiCredential.update).not.toHaveBeenCalled();
  });

  it('does not announce again a credential already flagged meanwhile', async () => {
    const { webhooks, scheduler } = build(
      [{ id: 'cred-1', createdAt: days(85) }],
      0,
    );
    await scheduler.processRotations();
    expect(webhooks.dispatchEvent).not.toHaveBeenCalled();
  });

  it('leaves a credential alone until it comes due', async () => {
    const { prisma, webhooks, scheduler } = build([
      { id: 'cred-1', createdAt: days(10) },
    ]);
    await scheduler.processRotations();
    expect(prisma.nhiCredential.updateMany).not.toHaveBeenCalled();
    expect(webhooks.dispatchEvent).not.toHaveBeenCalled();
  });
});
