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
import { PrismaService } from '../prisma/prisma.service.js';

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
  },
};

// ─── Tests ─────────────────────────────────────────────────

describe('AuthFlowService', () => {
  let service: AuthFlowService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthFlowService,
        { provide: PrismaService, useValue: mockPrisma },
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

  // ── getNextStep ─────────────────────────────────────────

  describe('getNextStep', () => {
    it('returns first step when currentStepId is null', async () => {
      const steps: FlowStep[] = [
        makeStep({ id: 'step-1', order: 1 }),
        makeStep({ id: 'step-2', type: 'totp', order: 2 }),
      ];
      mockPrisma.authenticationFlow.findUnique.mockResolvedValue(
        makeFlow(steps),
      );

      const next = await service.getNextStep('flow-id', null, {});
      expect(next?.id).toBe('step-1');
    });

    it('returns the step following the current one', async () => {
      const steps: FlowStep[] = [
        makeStep({ id: 'step-1', order: 1 }),
        makeStep({ id: 'step-2', type: 'totp', order: 2 }),
      ];
      mockPrisma.authenticationFlow.findUnique.mockResolvedValue(
        makeFlow(steps),
      );

      const next = await service.getNextStep('flow-id', 'step-1', {});
      expect(next?.id).toBe('step-2');
    });

    it('returns null after the last step', async () => {
      const steps: FlowStep[] = [makeStep({ id: 'step-1', order: 1 })];
      mockPrisma.authenticationFlow.findUnique.mockResolvedValue(
        makeFlow(steps),
      );

      const next = await service.getNextStep('flow-id', 'step-1', {});
      expect(next).toBeNull();
    });

    it('skips steps whose conditions are not met (non-required)', async () => {
      const steps: FlowStep[] = [
        makeStep({ id: 'step-1', order: 1 }),
        makeStep({
          id: 'step-totp',
          type: 'totp',
          required: false,
          order: 2,
          condition: { field: 'user.mfaEnabled', operator: 'eq', value: true },
        }),
        makeStep({ id: 'step-3', type: 'consent', order: 3 }),
      ];
      mockPrisma.authenticationFlow.findUnique.mockResolvedValue(
        makeFlow(steps),
      );

      // mfaEnabled is false → skip totp, return step-3
      const next = await service.getNextStep('flow-id', 'step-1', {
        user: { mfaEnabled: false },
      });
      expect(next?.id).toBe('step-3');
    });

    it('does NOT skip required steps even when condition is unmet', async () => {
      const steps: FlowStep[] = [
        makeStep({ id: 'step-1', order: 1 }),
        makeStep({
          id: 'step-totp',
          type: 'totp',
          required: true,
          order: 2,
          condition: { field: 'user.mfaEnabled', operator: 'eq', value: true },
        }),
      ];
      mockPrisma.authenticationFlow.findUnique.mockResolvedValue(
        makeFlow(steps),
      );

      const next = await service.getNextStep('flow-id', 'step-1', {
        user: { mfaEnabled: false },
      });
      expect(next?.id).toBe('step-totp');
    });

    it('throws NotFoundException for unknown flow', async () => {
      mockPrisma.authenticationFlow.findUnique.mockResolvedValue(null);
      await expect(service.getNextStep('no-flow', null, {})).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException for unknown currentStepId', async () => {
      mockPrisma.authenticationFlow.findUnique.mockResolvedValue(makeFlow());
      await expect(
        service.getNextStep('flow-id', 'ghost-step', {}),
      ).rejects.toThrow(BadRequestException);
    });

    it('respects step ordering by order field (not insertion order)', async () => {
      // steps provided in reverse order
      const steps: FlowStep[] = [
        makeStep({ id: 'step-2', type: 'totp', order: 2 }),
        makeStep({ id: 'step-1', order: 1 }),
      ];
      mockPrisma.authenticationFlow.findUnique.mockResolvedValue(
        makeFlow(steps),
      );

      const first = await service.getNextStep('flow-id', null, {});
      expect(first?.id).toBe('step-1');
    });
  });

  // ── executeStep ─────────────────────────────────────────

  describe('executeStep', () => {
    it('returns conditionMet=true and skipped=false for step without condition', async () => {
      mockPrisma.authenticationFlow.findUnique.mockResolvedValue(makeFlow());
      const result = await service.executeStep('flow-id', 'step-1', {});
      expect(result.conditionMet).toBe(true);
      expect(result.skipped).toBe(false);
    });

    it('returns conditionMet=false and skipped=true for non-required step with unmet condition', async () => {
      const steps: FlowStep[] = [
        makeStep({
          id: 'step-1',
          required: false,
          condition: { field: 'user.group', operator: 'eq', value: 'admin' },
        }),
      ];
      mockPrisma.authenticationFlow.findUnique.mockResolvedValue(
        makeFlow(steps),
      );
      const result = await service.executeStep('flow-id', 'step-1', {
        user: { group: 'user' },
      });
      expect(result.conditionMet).toBe(false);
      expect(result.skipped).toBe(true);
    });

    it('returns skipped=false for required step with unmet condition', async () => {
      const steps: FlowStep[] = [
        makeStep({
          id: 'step-1',
          required: true,
          condition: { field: 'user.group', operator: 'eq', value: 'admin' },
        }),
      ];
      mockPrisma.authenticationFlow.findUnique.mockResolvedValue(
        makeFlow(steps),
      );
      const result = await service.executeStep('flow-id', 'step-1', {
        user: { group: 'user' },
      });
      expect(result.conditionMet).toBe(false);
      expect(result.skipped).toBe(false);
    });

    it('throws NotFoundException for unknown step', async () => {
      mockPrisma.authenticationFlow.findUnique.mockResolvedValue(makeFlow());
      await expect(service.executeStep('flow-id', 'ghost', {})).rejects.toThrow(
        NotFoundException,
      );
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

  // ── getFlowForClient ─────────────────────────────────────

  describe('getFlowForClient', () => {
    it('returns client-assigned flow when present', async () => {
      mockPrisma.client.findFirst.mockResolvedValue({ authFlowId: 'flow-id' });
      mockPrisma.authenticationFlow.findFirst.mockResolvedValueOnce(makeFlow());

      const result = await service.getFlowForClient('client-id', 'realm-id');
      expect(result.id).toBe('flow-id');
    });

    it('falls back to realm default when client has no flow assigned', async () => {
      mockPrisma.client.findFirst.mockResolvedValue({ authFlowId: null });
      mockPrisma.authenticationFlow.findFirst.mockResolvedValueOnce(makeFlow());

      const result = await service.getFlowForClient('client-id', 'realm-id');
      expect(result).toBeDefined();
    });

    it('throws NotFoundException when client does not exist', async () => {
      mockPrisma.client.findFirst.mockResolvedValue(null);
      await expect(
        service.getFlowForClient('bad-client', 'realm-id'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when no flows exist for realm', async () => {
      mockPrisma.client.findFirst.mockResolvedValue({ authFlowId: null });
      mockPrisma.authenticationFlow.findFirst.mockResolvedValue(null);
      await expect(
        service.getFlowForClient('client-id', 'realm-id'),
      ).rejects.toThrow(NotFoundException);
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
