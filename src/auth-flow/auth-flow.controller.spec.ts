import { NotFoundException } from '@nestjs/common';
import { AuthFlowController } from './auth-flow.controller.js';
import {
  createMockPrismaService,
  type MockPrismaService,
} from '../prisma/prisma.mock.js';

describe('AuthFlowController.assignToClient', () => {
  let prisma: MockPrismaService;
  let controller: AuthFlowController;

  beforeEach(() => {
    prisma = createMockPrismaService();
    prisma.realm.findUnique.mockResolvedValue({ id: 'realm-a' });
    controller = new AuthFlowController({} as never, prisma as never);
  });

  it('refuses a client from another realm', async () => {
    prisma.client.findFirst.mockResolvedValue(null);

    await expect(
      controller.assignToClient('realm-a', 'flow-1', 'client-of-b', {
        authFlowId: 'flow-1',
      }),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.client.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'client-of-b', realmId: 'realm-a' },
      }),
    );
    expect(prisma.client.update).not.toHaveBeenCalled();
  });

  it('refuses a flow from another realm', async () => {
    prisma.client.findFirst.mockResolvedValue({ id: 'client-1' });
    prisma.authenticationFlow.findFirst.mockResolvedValue(null);

    await expect(
      controller.assignToClient('realm-a', 'flow-of-b', 'client-1', {
        authFlowId: 'flow-of-b',
      }),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.authenticationFlow.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'flow-of-b', realmId: 'realm-a' },
      }),
    );
    expect(prisma.client.update).not.toHaveBeenCalled();
  });

  it('assigns a flow of the same realm', async () => {
    prisma.client.findFirst.mockResolvedValue({ id: 'client-1' });
    prisma.authenticationFlow.findFirst.mockResolvedValue({ id: 'flow-1' });
    prisma.client.update.mockResolvedValue({
      id: 'client-1',
      clientId: 'web',
      authFlowId: 'flow-1',
    });

    await controller.assignToClient('realm-a', 'flow-1', 'client-1', {
      authFlowId: 'flow-1',
    });

    expect(prisma.client.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'client-1' },
        data: { authFlowId: 'flow-1' },
      }),
    );
  });

  it('clears the assignment without looking up a flow', async () => {
    prisma.client.findFirst.mockResolvedValue({ id: 'client-1' });

    await controller.assignToClient('realm-a', 'flow-1', 'client-1', {
      authFlowId: null,
    });

    expect(prisma.authenticationFlow.findFirst).not.toHaveBeenCalled();
    expect(prisma.client.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { authFlowId: null } }),
    );
  });
});
