import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import {
  AuthFlowService,
  FlowStep,
  FlowStepCondition,
  DEFAULT_FLOWS,
} from './auth-flow.service.js';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CacheService } from '../cache/cache.service.js';

// ─── Helpers ───────────────────────────────────────────────

function makeStep(overrides: Partial<FlowStep> = {}): FlowStep {
  return {
    id: 'step-1',
    type: 'password',
    required: true,
    order: 1,
    condition: null,
    fallbackStepId: null,
    config: {},
    ...overrides,
  };
}

function makeFlow(steps: FlowStep[] = [makeStep()]) {
  return {
    id: 'flow-id',
    realmId: 'realm-id',
    name: 'Simple Login',
    description: null,
    isDefault: true,
    steps,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ─── Mock PrismaService ────────────────────────────────────

const mockPrisma = {
  authenticationFlow: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
  },
  client: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  realm: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  identityProvider: {
    findMany: jest.fn().mockResolvedValue([]),
  },
  $transaction: jest.fn(),
};

const mockCache = {
  invalidateRealmCache: jest.fn(),
  invalidateClientCache: jest.fn(),
};

// ─── Tests ─────────────────────────────────────────────────

describe('AuthFlowService', () => {
  let service: AuthFlowService;

  beforeEach(async () => {
    jest.resetAllMocks();
    // The realm's identity providers, for social steps (none by default).
    mockPrisma.identityProvider.findMany.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthFlowService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CacheService, useValue: mockCache },
      ],
    }).compile();

    service = module.get<AuthFlowService>(AuthFlowService);
  });

  // ── evaluateCondition ───────────────────────────────────

  describe('evaluateCondition', () => {
    it('eq — returns true when field equals value', () => {
      const cond: FlowStepCondition = {
        field: 'user.role',
        operator: 'eq',
        value: 'admin',
      };
      expect(service.evaluateCondition(cond, { user: { role: 'admin' } })).toBe(
        true,
      );
    });

    it('eq — returns false when field does not match', () => {
      const cond: FlowStepCondition = {
        field: 'user.role',
        operator: 'eq',
        value: 'admin',
      };
      expect(service.evaluateCondition(cond, { user: { role: 'user' } })).toBe(
        false,
      );
    });

    it('neq — returns true when field differs from value', () => {
      const cond: FlowStepCondition = {
        field: 'user.role',
        operator: 'neq',
        value: 'admin',
      };
      expect(service.evaluateCondition(cond, { user: { role: 'user' } })).toBe(
        true,
      );
    });

    it('in — returns true when scalar field is in value array', () => {
      const cond: FlowStepCondition = {
        field: 'user.group',
        operator: 'in',
        value: ['admins', 'staff'],
      };
      expect(
        service.evaluateCondition(cond, { user: { group: 'admins' } }),
      ).toBe(true);
    });

    it('in — returns false when scalar field is not in value array', () => {
      const cond: FlowStepCondition = {
        field: 'user.group',
        operator: 'in',
        value: ['admins', 'staff'],
      };
      expect(
        service.evaluateCondition(cond, { user: { group: 'guests' } }),
      ).toBe(false);
    });

    it('in — returns true when field is an array with an overlapping value', () => {
      const cond: FlowStepCondition = {
        field: 'user.groups',
        operator: 'in',
        value: ['admins'],
      };
      expect(
        service.evaluateCondition(cond, {
          user: { groups: ['admins', 'staff'] },
        }),
      ).toBe(true);
    });

    it('not_in — returns true when value is absent from array', () => {
      const cond: FlowStepCondition = {
        field: 'user.group',
        operator: 'not_in',
        value: ['admins'],
      };
      expect(
        service.evaluateCondition(cond, { user: { group: 'guests' } }),
      ).toBe(true);
    });

    it('not_in — returns false when value is present in array', () => {
      const cond: FlowStepCondition = {
        field: 'user.group',
        operator: 'not_in',
        value: ['admins'],
      };
      expect(
        service.evaluateCondition(cond, { user: { group: 'admins' } }),
      ).toBe(false);
    });

    it('exists — returns true when field is present', () => {
      const cond: FlowStepCondition = { field: 'user.mfa', operator: 'exists' };
      expect(service.evaluateCondition(cond, { user: { mfa: true } })).toBe(
        true,
      );
    });

    it('exists — returns false when field is undefined', () => {
      const cond: FlowStepCondition = { field: 'user.mfa', operator: 'exists' };
      expect(service.evaluateCondition(cond, { user: {} })).toBe(false);
    });

    it('not_exists — returns true when field is absent', () => {
      const cond: FlowStepCondition = {
        field: 'user.mfa',
        operator: 'not_exists',
      };
      expect(service.evaluateCondition(cond, { user: {} })).toBe(true);
    });

    it('not_exists — returns false when field is present', () => {
      const cond: FlowStepCondition = {
        field: 'user.mfa',
        operator: 'not_exists',
      };
      expect(service.evaluateCondition(cond, { user: { mfa: false } })).toBe(
        false,
      );
    });

    it('unknown operator — returns false', () => {
      const cond = { field: 'user.x', operator: 'unknown_op' } as any;
      expect(service.evaluateCondition(cond, { user: { x: 1 } })).toBe(false);
    });

    it('resolves nested dot-path fields', () => {
      const cond: FlowStepCondition = {
        field: 'user.profile.country',
        operator: 'eq',
        value: 'EG',
      };
      expect(
        service.evaluateCondition(cond, {
          user: { profile: { country: 'EG' } },
        }),
      ).toBe(true);
    });
  });

  // ── create ──────────────────────────────────────────────

  describe('create', () => {
    it('creates a flow successfully', async () => {
      mockPrisma.authenticationFlow.findUnique.mockResolvedValue(null);
      mockPrisma.authenticationFlow.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.authenticationFlow.create.mockResolvedValue(makeFlow());

      const dto = {
        name: 'Simple Login',
        steps: [makeStep()],
        isDefault: false,
      };
      const result = await service.create('realm-id', dto);
      expect(result).toBeDefined();
      expect(mockPrisma.authenticationFlow.create).toHaveBeenCalled();
    });

    it('throws ConflictException when name already exists', async () => {
      mockPrisma.authenticationFlow.findUnique.mockResolvedValue(makeFlow());
      const dto = { name: 'Simple Login', steps: [makeStep()] };
      await expect(service.create('realm-id', dto)).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws BadRequestException for empty steps array', async () => {
      mockPrisma.authenticationFlow.findUnique.mockResolvedValue(null);
      await expect(
        service.create('realm-id', { name: 'X', steps: [] }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for duplicate step IDs', async () => {
      mockPrisma.authenticationFlow.findUnique.mockResolvedValue(null);
      const dto = {
        name: 'X',
        steps: [makeStep({ id: 'dup' }), makeStep({ id: 'dup', order: 2 })],
      };
      await expect(service.create('realm-id', dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException for duplicate step orders', async () => {
      mockPrisma.authenticationFlow.findUnique.mockResolvedValue(null);
      const dto = {
        name: 'X',
        steps: [
          makeStep({ id: 's1', order: 1 }),
          makeStep({ id: 's2', order: 1 }),
        ],
      };
      await expect(service.create('realm-id', dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException for unknown fallbackStepId reference', async () => {
      mockPrisma.authenticationFlow.findUnique.mockResolvedValue(null);
      const dto = {
        name: 'X',
        steps: [makeStep({ id: 's1', fallbackStepId: 'ghost' })],
      };
      await expect(service.create('realm-id', dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('clears existing default flag when isDefault=true', async () => {
      mockPrisma.authenticationFlow.findUnique.mockResolvedValue(null);
      mockPrisma.authenticationFlow.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.authenticationFlow.create.mockResolvedValue(makeFlow());

      await service.create('realm-id', {
        name: 'New Default',
        steps: [makeStep()],
        isDefault: true,
      });
      expect(mockPrisma.authenticationFlow.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isDefault: true }),
        }),
      );
    });
  });

  // ── strict validation on save ───────────────────────────

  describe('validation on create/update', () => {
    async function badRequestBody(p: Promise<unknown>) {
      const err = await p.then(
        () => {
          throw new Error('expected a BadRequestException');
        },
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(BadRequestException);
      return (err as BadRequestException).getResponse() as {
        message: string;
        errors: Array<{ path: string; code: string; message: string }>;
      };
    }

    it('create returns 400 with the full {path, code, message} list', async () => {
      mockPrisma.authenticationFlow.findUnique.mockResolvedValue(null);
      const body = await badRequestBody(
        service.create('realm-id', {
          name: 'X',
          steps: [
            makeStep({ id: 'otp', type: 'totp', order: 1 }),
            makeStep({ id: 'c', type: 'consent', order: 2 }),
          ],
        }),
      );
      expect(body.message).toBe('Authentication flow is invalid');
      expect(body.errors.map((e) => e.code).sort()).toEqual([
        'first_step_not_identifying',
        'unsupported_type',
      ]);
      expect(mockPrisma.authenticationFlow.create).not.toHaveBeenCalled();
    });

    it('update validates new steps and writes nothing when invalid', async () => {
      mockPrisma.authenticationFlow.findFirst.mockResolvedValueOnce(makeFlow());
      const body = await badRequestBody(
        service.update('realm-id', 'flow-id', {
          steps: [
            makeStep({ condition: { field: 'x', operator: 'eq', value: 1 } }),
          ],
        }),
      );
      expect(body.errors.map((e) => e.code)).toContain(
        'first_step_conditional',
      );
      expect(mockPrisma.authenticationFlow.update).not.toHaveBeenCalled();
    });

    it('update increments the version on every update', async () => {
      mockPrisma.authenticationFlow.findFirst
        .mockResolvedValueOnce(makeFlow())
        .mockResolvedValueOnce(null);
      mockPrisma.authenticationFlow.update.mockResolvedValue(makeFlow());

      await service.update('realm-id', 'flow-id', { name: 'Renamed' });

      expect(mockPrisma.authenticationFlow.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ version: { increment: 1 } }),
        }),
      );
    });
  });

  // ── validateFlow ────────────────────────────────────────

  describe('validateFlow', () => {
    it('returns {valid:true, errors:[]} for a valid stored flow', async () => {
      mockPrisma.authenticationFlow.findFirst.mockResolvedValue(makeFlow());
      await expect(
        service.validateFlow('realm-id', 'flow-id'),
      ).resolves.toEqual({
        valid: true,
        errors: [],
      });
    });

    it('reports errors of a flow saved before the stricter rules', async () => {
      mockPrisma.authenticationFlow.findFirst.mockResolvedValue(
        makeFlow([makeStep({ type: 'consent' as FlowStep['type'] })]),
      );
      const r = await service.validateFlow('realm-id', 'flow-id');
      expect(r.valid).toBe(false);
      expect(r.errors[0]).toMatchObject({
        path: 'steps[0].type',
        code: 'unsupported_type',
      });
    });

    it('checks a social step against the realm identity providers', async () => {
      const social = makeStep({
        type: 'social' as FlowStep['type'],
        config: { providerAlias: 'google' },
      });
      mockPrisma.authenticationFlow.findFirst.mockResolvedValue(
        makeFlow([social]),
      );
      const missing = await service.validateFlow('realm-id', 'flow-id');
      expect(missing.errors).toEqual([
        expect.objectContaining({ code: 'provider_not_found' }),
      ]);
      expect(mockPrisma.identityProvider.findMany).toHaveBeenCalledWith({
        where: { realmId: 'realm-id', enabled: true },
        select: { alias: true },
      });

      mockPrisma.identityProvider.findMany.mockResolvedValue([
        { alias: 'google' },
      ]);
      expect(await service.validateFlow('realm-id', 'flow-id')).toEqual({
        valid: true,
        errors: [],
      });
    });

    it('404s for a flow of another realm', async () => {
      mockPrisma.authenticationFlow.findFirst.mockResolvedValue(null);
      await expect(service.validateFlow('realm-id', 'x')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrisma.authenticationFlow.findFirst).toHaveBeenCalledWith({
        where: { id: 'x', realmId: 'realm-id' },
      });
    });
  });

  // ── remove ──────────────────────────────────────────────

  describe('remove', () => {
    beforeEach(() => {
      mockPrisma.authenticationFlow.findFirst.mockResolvedValue(makeFlow());
      mockPrisma.realm.findMany.mockResolvedValue([]);
      mockPrisma.client.findMany.mockResolvedValue([]);
    });

    it('deletes an unbound flow', async () => {
      await service.remove('realm-id', 'flow-id');
      expect(mockPrisma.authenticationFlow.delete).toHaveBeenCalledWith({
        where: { id: 'flow-id' },
      });
    });

    it('409s with the binding list when the realm and clients use the flow', async () => {
      mockPrisma.realm.findMany.mockResolvedValue([
        { id: 'realm-id', name: 'acme' },
      ]);
      mockPrisma.client.findMany.mockResolvedValue([
        { id: 'c1', clientId: 'web' },
      ]);
      const err = await service.remove('realm-id', 'flow-id').catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).getResponse()).toMatchObject({
        bindings: [
          { kind: 'realm', realmId: 'realm-id', realmName: 'acme' },
          { kind: 'client', id: 'c1', clientId: 'web' },
        ],
      });
      expect(mockPrisma.authenticationFlow.delete).not.toHaveBeenCalled();
    });

    it('maps an FK violation raced in after the check to 409', async () => {
      mockPrisma.authenticationFlow.delete.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('fk', {
          code: 'P2003',
          clientVersion: 'test',
        }),
      );
      await expect(service.remove('realm-id', 'flow-id')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // ── bindings ────────────────────────────────────────────

  describe('bindings', () => {
    const realmRow = {
      id: 'realm-id',
      name: 'acme',
      authFlowsEnabled: false,
      browserFlowId: null as string | null,
    };
    const clients = [
      {
        id: 'c1',
        clientId: 'web',
        name: 'Web',
        authFlowId: null as string | null,
      },
      {
        id: 'c2',
        clientId: 'cli',
        name: null,
        authFlowId: null as string | null,
      },
    ];
    const originalEnv = process.env['AUTH_FLOW_RUNTIME_ENABLED'];

    beforeEach(() => {
      mockPrisma.realm.findUnique.mockResolvedValue({ ...realmRow });
      mockPrisma.client.findMany.mockResolvedValue(
        clients.map((c) => ({ ...c })),
      );
      mockPrisma.authenticationFlow.findMany.mockResolvedValue([
        { id: 'good', name: 'Good', steps: [makeStep()] },
        {
          id: 'bad',
          name: 'Bad',
          steps: [makeStep({ type: 'totp' })],
        },
      ]);
      mockPrisma.$transaction.mockResolvedValue([]);
    });

    afterAll(() => {
      if (originalEnv === undefined)
        delete process.env['AUTH_FLOW_RUNTIME_ENABLED'];
      else process.env['AUTH_FLOW_RUNTIME_ENABLED'] = originalEnv;
    });

    it('getBindings reports runtimeEnabled from the env flag', async () => {
      delete process.env['AUTH_FLOW_RUNTIME_ENABLED'];
      await expect(service.getBindings('realm-id')).resolves.toMatchObject({
        runtimeEnabled: false,
        authFlowsEnabled: false,
        browserFlowId: null,
        clients: [{ clientId: 'web' }, { clientId: 'cli' }],
      });
      process.env['AUTH_FLOW_RUNTIME_ENABLED'] = 'true';
      await expect(service.getBindings('realm-id')).resolves.toMatchObject({
        runtimeEnabled: true,
      });
    });

    async function rejected(
      dto: Parameters<AuthFlowService['updateBindings']>[1],
    ) {
      const err = await service.updateBindings('realm-id', dto).catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      return (
        (err as BadRequestException).getResponse() as {
          errors: Array<{ path: string; code: string }>;
        }
      ).errors;
    }

    it('binds a valid realm flow and per-client override, then busts caches', async () => {
      await service.updateBindings('realm-id', {
        browserFlowId: 'good',
        authFlowsEnabled: true,
        clients: [{ clientId: 'web', authFlowId: 'good' }],
      });
      expect(mockPrisma.authenticationFlow.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { realmId: 'realm-id', id: { in: ['good'] } },
        }),
      );
      expect(mockPrisma.realm.update).toHaveBeenCalledWith({
        where: { id: 'realm-id' },
        data: {
          browserFlow: { connect: { id: 'good' } },
          authFlowsEnabled: true,
        },
      });
      expect(mockPrisma.client.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { authFlowId: 'good' },
      });
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockCache.invalidateRealmCache).toHaveBeenCalledWith(
        'realm-id',
        'acme',
      );
      expect(mockCache.invalidateClientCache).toHaveBeenCalledWith(
        'realm-id:web',
      );
      expect(mockCache.invalidateClientCache).toHaveBeenCalledWith(
        'realm-id:c1',
      );
    });

    it('unbinds with null', async () => {
      mockPrisma.realm.findUnique.mockResolvedValue({
        ...realmRow,
        browserFlowId: 'good',
      });
      await service.updateBindings('realm-id', { browserFlowId: null });
      expect(mockPrisma.realm.update).toHaveBeenCalledWith({
        where: { id: 'realm-id' },
        data: { browserFlow: { disconnect: true } },
      });
    });

    it('rejects an invalid flow with its validator errors', async () => {
      const errors = await rejected({ browserFlowId: 'bad' });
      expect(errors).toEqual([
        expect.objectContaining({
          path: 'browserFlowId',
          code: 'flow_invalid',
          flowId: 'bad',
          flowErrors: [
            expect.objectContaining({ code: 'first_step_not_identifying' }),
          ],
        }),
      ]);
    });

    it('rejects a flow that is not in this realm', async () => {
      const errors = await rejected({
        clients: [{ clientId: 'cli', authFlowId: 'other-realm-flow' }],
      });
      expect(errors).toEqual([
        expect.objectContaining({
          path: 'clients[0].authFlowId',
          code: 'flow_not_found',
        }),
      ]);
    });

    it('rejects unknown, duplicate and incomplete client entries', async () => {
      const errors = await rejected({
        clients: [
          { clientId: 'nope', authFlowId: 'good' },
          { clientId: 'web', authFlowId: 'good' },
          { clientId: 'web', authFlowId: null },
          { clientId: 'cli' } as never,
        ],
      });
      expect(errors.map((e) => [e.path, e.code])).toEqual([
        ['clients[0].clientId', 'client_not_found'],
        ['clients[2].clientId', 'client_duplicate'],
        ['clients[3].authFlowId', 'flow_id_required'],
      ]);
    });

    it('enabling checks existing bindings that are not in the request', async () => {
      mockPrisma.realm.findUnique.mockResolvedValue({
        ...realmRow,
        browserFlowId: 'good',
      });
      mockPrisma.client.findMany.mockResolvedValue([
        { ...clients[0], authFlowId: 'bad' },
        clients[1],
      ]);
      const errors = await rejected({ authFlowsEnabled: true });
      expect(errors).toEqual([
        expect.objectContaining({
          path: 'clients[clientId=web].authFlowId',
          code: 'flow_invalid',
        }),
      ]);
    });

    it('does not re-check untouched bindings while the realm stays disabled', async () => {
      mockPrisma.client.findMany.mockResolvedValue([
        { ...clients[0], authFlowId: 'bad' },
        clients[1],
      ]);
      await service.updateBindings('realm-id', {
        clients: [{ clientId: 'cli', authFlowId: null }],
      });
      expect(mockPrisma.authenticationFlow.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.client.update).toHaveBeenCalledWith({
        where: { id: 'c2' },
        data: { authFlowId: null },
      });
    });
  });

  // ── assign / unassign ───────────────────────────────────

  describe('assignToClient', () => {
    it('404s for a flow of another realm', async () => {
      mockPrisma.authenticationFlow.findFirst.mockResolvedValue(null);
      await expect(
        service.assignToClient('realm-id', 'flow-b', 'c1', undefined),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.authenticationFlow.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'flow-b', realmId: 'realm-id' },
        }),
      );
    });

    it('404s for a client of another realm', async () => {
      mockPrisma.authenticationFlow.findFirst.mockResolvedValue(makeFlow());
      mockPrisma.client.findFirst.mockResolvedValue(null);
      await expect(
        service.assignToClient('realm-id', 'flow-id', 'client-b', undefined),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.client.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'client-b', realmId: 'realm-id' },
        }),
      );
    });

    it.each([
      ['another flow', 'other-flow'],
      ['null (clear)', null],
    ])('400s when the body names %s', async (_n, bodyFlowId) => {
      mockPrisma.authenticationFlow.findFirst.mockResolvedValue(makeFlow());
      mockPrisma.client.findFirst.mockResolvedValue({
        id: 'c1',
        clientId: 'web',
        authFlowId: null,
      });
      await expect(
        service.assignToClient('realm-id', 'flow-id', 'c1', bodyFlowId),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.client.update).not.toHaveBeenCalled();
    });

    it('400s when the flow is invalid', async () => {
      mockPrisma.authenticationFlow.findFirst.mockResolvedValue(
        makeFlow([makeStep({ type: 'totp' })]),
      );
      mockPrisma.client.findFirst.mockResolvedValue({
        id: 'c1',
        clientId: 'web',
        authFlowId: null,
      });
      await expect(
        service.assignToClient('realm-id', 'flow-id', 'c1', 'flow-id'),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.client.update).not.toHaveBeenCalled();
    });

    it('binds the path flow and reports the previous one', async () => {
      mockPrisma.authenticationFlow.findFirst.mockResolvedValue(makeFlow());
      mockPrisma.client.findFirst.mockResolvedValue({
        id: 'c1',
        clientId: 'web',
        authFlowId: 'old',
      });
      mockPrisma.client.update.mockResolvedValue({
        id: 'c1',
        clientId: 'web',
        authFlowId: 'flow-id',
      });
      await expect(
        service.assignToClient('realm-id', 'flow-id', 'c1', undefined),
      ).resolves.toEqual({
        id: 'c1',
        clientId: 'web',
        authFlowId: 'flow-id',
        previousAuthFlowId: 'old',
      });
      expect(mockPrisma.client.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { authFlowId: 'flow-id' } }),
      );
      expect(mockCache.invalidateClientCache).toHaveBeenCalledWith(
        'realm-id:web',
      );
    });
  });

  describe('unassignFromClient', () => {
    it('clears the override when the client is bound to this flow', async () => {
      mockPrisma.authenticationFlow.findFirst.mockResolvedValue(makeFlow());
      mockPrisma.client.findFirst.mockResolvedValue({
        id: 'c1',
        clientId: 'web',
        authFlowId: 'flow-id',
      });
      mockPrisma.client.update.mockResolvedValue({
        id: 'c1',
        clientId: 'web',
        authFlowId: null,
      });
      await service.unassignFromClient('realm-id', 'flow-id', 'c1');
      expect(mockPrisma.client.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { authFlowId: null } }),
      );
    });

    it('404s when the client is bound to another flow', async () => {
      mockPrisma.authenticationFlow.findFirst.mockResolvedValue(makeFlow());
      mockPrisma.client.findFirst.mockResolvedValue({
        id: 'c1',
        clientId: 'web',
        authFlowId: 'other',
      });
      await expect(
        service.unassignFromClient('realm-id', 'flow-id', 'c1'),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.client.update).not.toHaveBeenCalled();
    });
  });

  // ── DEFAULT_FLOWS ────────────────────────────────────────

  describe('DEFAULT_FLOWS constant', () => {
    it('contains exactly three flows', () => {
      expect(DEFAULT_FLOWS).toHaveLength(3);
    });

    it('"Simple Login" has a single password step', () => {
      const flow = DEFAULT_FLOWS.find((f) => f.name === 'Simple Login')!;
      expect(flow).toBeDefined();
      expect(flow.steps).toHaveLength(1);
      expect(flow.steps[0].type).toBe('password');
    });

    it('"MFA Required" has password then totp steps in order', () => {
      const flow = DEFAULT_FLOWS.find((f) => f.name === 'MFA Required')!;
      expect(flow).toBeDefined();
      expect(flow.steps).toHaveLength(2);
      const sorted = [...flow.steps].sort((a, b) => a.order - b.order);
      expect(sorted[0].type).toBe('password');
      expect(sorted[1].type).toBe('totp');
    });

    it('"Passwordless" has a single webauthn step', () => {
      const flow = DEFAULT_FLOWS.find((f) => f.name === 'Passwordless')!;
      expect(flow).toBeDefined();
      expect(flow.steps).toHaveLength(1);
      expect(flow.steps[0].type).toBe('webauthn');
    });
  });

  // ── seedDefaultFlows ─────────────────────────────────────

  describe('seedDefaultFlows', () => {
    it('creates all three flows when none exist', async () => {
      mockPrisma.authenticationFlow.findUnique.mockResolvedValue(null);
      mockPrisma.authenticationFlow.create.mockResolvedValue({});

      await service.seedDefaultFlows('realm-id');
      expect(mockPrisma.authenticationFlow.create).toHaveBeenCalledTimes(3);
    });

    it('skips flows that already exist', async () => {
      // First call returns existing flow, rest return null
      mockPrisma.authenticationFlow.findUnique
        .mockResolvedValueOnce(makeFlow())
        .mockResolvedValue(null);
      mockPrisma.authenticationFlow.create.mockResolvedValue({});

      await service.seedDefaultFlows('realm-id');
      expect(mockPrisma.authenticationFlow.create).toHaveBeenCalledTimes(2);
    });

    it('marks only the first flow (Simple Login) as default', async () => {
      mockPrisma.authenticationFlow.findUnique.mockResolvedValue(null);
      mockPrisma.authenticationFlow.create.mockResolvedValue({});

      await service.seedDefaultFlows('realm-id');

      const calls = mockPrisma.authenticationFlow.create.mock.calls;
      const firstCallData = calls[0][0].data;
      expect(firstCallData.isDefault).toBe(true);

      const secondCallData = calls[1][0].data;
      expect(secondCallData.isDefault).toBe(false);
    });
  });
});
