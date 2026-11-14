import { NotFoundException } from '@nestjs/common';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { AuthFlowController } from './auth-flow.controller.js';
import {
  createMockPrismaService,
  type MockPrismaService,
} from '../prisma/prisma.mock.js';

describe('AuthFlowController', () => {
  let prisma: MockPrismaService;
  let service: Record<string, jest.Mock>;
  let events: { recordAdminEvent: jest.Mock };
  let controller: AuthFlowController;
  const req = {
    path: '/admin/realms/realm-a/auth-flows/x',
    ip: '127.0.0.1',
    adminUser: { userId: 'admin-1' },
  } as never;

  beforeEach(() => {
    prisma = createMockPrismaService();
    prisma.realm.findUnique.mockResolvedValue({ id: 'realm-a' });
    service = {
      create: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      validateFlow: jest.fn(),
      getBindings: jest.fn(),
      updateBindings: jest.fn(),
      assignToClient: jest.fn(),
      unassignFromClient: jest.fn(),
    };
    events = { recordAdminEvent: jest.fn().mockResolvedValue(undefined) };
    controller = new AuthFlowController(
      service as never,
      prisma as never,
      events as never,
    );
  });

  it('404s for an unknown realm before touching the service', async () => {
    prisma.realm.findUnique.mockResolvedValue(null);
    await expect(controller.getBindings('nope')).rejects.toThrow(
      NotFoundException,
    );
    expect(service.getBindings).not.toHaveBeenCalled();
  });

  it('declares the bindings routes before `:id` so "bindings" is never a flow id', () => {
    const routes = Object.getOwnPropertyNames(AuthFlowController.prototype)
      .map((name) => {
        const handler = (
          AuthFlowController.prototype as unknown as Record<string, unknown>
        )[name];
        return {
          name,
          path: Reflect.getMetadata(PATH_METADATA, handler as object) as
            string | undefined,
          method: Reflect.getMetadata(METHOD_METADATA, handler as object) as
            RequestMethod | undefined,
        };
      })
      .filter((r) => r.path !== undefined);
    const idx = (path: string, method: RequestMethod) =>
      routes.findIndex((r) => r.path === path && r.method === method);
    expect(idx('bindings', RequestMethod.GET)).toBeGreaterThanOrEqual(0);
    expect(idx('bindings', RequestMethod.GET)).toBeLessThan(
      idx(':id', RequestMethod.GET),
    );
    expect(idx('bindings', RequestMethod.PUT)).toBeLessThan(
      idx(':id', RequestMethod.PUT),
    );
  });

  it('assign-client passes the path flow and body to the service and audits it', async () => {
    service.assignToClient.mockResolvedValue({
      id: 'c1',
      clientId: 'web',
      authFlowId: 'flow-1',
      previousAuthFlowId: null,
    });
    const result = await controller.assignToClient(
      'realm-a',
      'flow-1',
      'c1',
      {},
      req,
    );
    expect(service.assignToClient).toHaveBeenCalledWith(
      'realm-a',
      'flow-1',
      'c1',
      undefined,
    );
    expect(result).toEqual({ id: 'c1', clientId: 'web', authFlowId: 'flow-1' });
    expect(events.recordAdminEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        realmId: 'realm-a',
        adminUserId: 'admin-1',
        operationType: 'UPDATE',
        resourceType: 'AUTH_FLOW',
        representation: { clientId: 'web', from: null, to: 'flow-1' },
      }),
    );
  });

  it('records an admin event with the binding diff on bindings PUT', async () => {
    service.updateBindings.mockResolvedValue({
      bindings: { runtimeEnabled: false },
      changed: { authFlowsEnabled: { from: false, to: true } },
    });
    await expect(
      controller.updateBindings('realm-a', { authFlowsEnabled: true }, req),
    ).resolves.toEqual({ runtimeEnabled: false });
    expect(events.recordAdminEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        operationType: 'UPDATE',
        representation: {
          bindings: { authFlowsEnabled: { from: false, to: true } },
        },
      }),
    );
  });

  it('does not audit a failed write', async () => {
    service.remove.mockRejectedValue(new Error('409'));
    await expect(controller.remove('realm-a', 'f', req)).rejects.toThrow();
    expect(events.recordAdminEvent).not.toHaveBeenCalled();
  });

  it('audits deletes and falls back to "api-key" without an admin user', async () => {
    await controller.remove('realm-a', 'f', { path: '/p', ip: 'x' } as never);
    expect(events.recordAdminEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        operationType: 'DELETE',
        adminUserId: 'api-key',
      }),
    );
  });

  it('does not audit read-only validate', async () => {
    service.validateFlow.mockResolvedValue({ valid: true, errors: [] });
    await expect(controller.validate('realm-a', 'f')).resolves.toEqual({
      valid: true,
      errors: [],
    });
    expect(events.recordAdminEvent).not.toHaveBeenCalled();
  });
});
