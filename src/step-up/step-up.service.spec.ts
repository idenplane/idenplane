import { Test, TestingModule } from '@nestjs/testing';
import {
  StepUpService,
  ACR_PASSWORD,
  ACR_MFA,
  ACR_WEBAUTHN,
} from './step-up.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

// ─── Prisma mock ─────────────────────────────────────────────────────────────

const mockStepUpRecordFindMany = jest.fn();
const mockStepUpRecordCreate = jest.fn();
const mockStepUpRecordDeleteMany = jest.fn();
const mockClientFindUnique = jest.fn();

const mockPrisma = {
  stepUpRecord: {
    findMany: mockStepUpRecordFindMany,
    create: mockStepUpRecordCreate,
    deleteMany: mockStepUpRecordDeleteMany,
  },
  client: {
    findUnique: mockClientFindUnique,
  },
} as unknown as PrismaService;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function futureDate(offsetSeconds: number): Date {
  return new Date(Date.now() + offsetSeconds * 1000);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('StepUpService', () => {
  let service: StepUpService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StepUpService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<StepUpService>(StepUpService);
  });

  // ── ACR strength ───────────────────────────────────────────────────────────

  describe('getAcrStrength()', () => {
    it('assigns level 1 to ACR_PASSWORD', () => {
      expect(service.getAcrStrength(ACR_PASSWORD)).toBe(1);
    });

    it('assigns level 2 to ACR_MFA', () => {
      expect(service.getAcrStrength(ACR_MFA)).toBe(2);
    });

    it('assigns level 3 to ACR_WEBAUTHN', () => {
      expect(service.getAcrStrength(ACR_WEBAUTHN)).toBe(3);
    });

    it('assigns level 0 to unknown ACR values', () => {
      expect(service.getAcrStrength('urn:unknown:acr')).toBe(0);
    });
  });

  // ── satisfiesAcr ───────────────────────────────────────────────────────────

  describe('satisfiesAcr()', () => {
    it('returns true when candidate equals required', () => {
      expect(service.satisfiesAcr(ACR_MFA, ACR_MFA)).toBe(true);
    });

    it('returns true when candidate is stronger than required', () => {
      expect(service.satisfiesAcr(ACR_WEBAUTHN, ACR_MFA)).toBe(true);
      expect(service.satisfiesAcr(ACR_WEBAUTHN, ACR_PASSWORD)).toBe(true);
      expect(service.satisfiesAcr(ACR_MFA, ACR_PASSWORD)).toBe(true);
    });

    it('returns false when candidate is weaker than required', () => {
      expect(service.satisfiesAcr(ACR_PASSWORD, ACR_MFA)).toBe(false);
      expect(service.satisfiesAcr(ACR_PASSWORD, ACR_WEBAUTHN)).toBe(false);
      expect(service.satisfiesAcr(ACR_MFA, ACR_WEBAUTHN)).toBe(false);
    });

    it('returns false for unknown candidate against a known required', () => {
      expect(service.satisfiesAcr('urn:unknown', ACR_PASSWORD)).toBe(false);
    });
  });

  // ── getSessionAcr ─────────────────────────────────────────────────────────

  describe('getSessionAcr()', () => {
    it('falls back to ACR_PASSWORD when no records exist', async () => {
      mockStepUpRecordFindMany.mockResolvedValue([]);
      const acr = await service.getSessionAcr('session-1');
      expect(acr).toBe(ACR_PASSWORD);
    });

    it('returns the highest ACR level from active records', async () => {
      mockStepUpRecordFindMany.mockResolvedValue([
        {
          sessionId: 'session-1',
          acrLevel: ACR_MFA,
          expiresAt: futureDate(600),
        },
        {
          sessionId: 'session-1',
          acrLevel: ACR_PASSWORD,
          expiresAt: futureDate(600),
        },
      ]);
      const acr = await service.getSessionAcr('session-1');
      expect(acr).toBe(ACR_MFA);
    });

    it('returns ACR_WEBAUTHN when webauthn record is present', async () => {
      mockStepUpRecordFindMany.mockResolvedValue([
        {
          sessionId: 'session-1',
          acrLevel: ACR_WEBAUTHN,
          expiresAt: futureDate(600),
        },
        {
          sessionId: 'session-1',
          acrLevel: ACR_MFA,
          expiresAt: futureDate(600),
        },
      ]);
      const acr = await service.getSessionAcr('session-1');
      expect(acr).toBe(ACR_WEBAUTHN);
    });

    it('queries only non-expired records', async () => {
      mockStepUpRecordFindMany.mockResolvedValue([]);
      await service.getSessionAcr('session-1');
      expect(mockStepUpRecordFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            sessionId: 'session-1',
            expiresAt: expect.objectContaining({ gt: expect.any(Date) }),
          }),
        }),
      );
    });
  });

  // ── requiresStepUp ────────────────────────────────────────────────────────

  describe('requiresStepUp()', () => {
    it('returns false when client has no required ACR', async () => {
      mockClientFindUnique.mockResolvedValue({ requiredAcr: null });
      const result = await service.requiresStepUp('client-db-id', ACR_PASSWORD);
      expect(result).toBe(false);
    });

    it('returns false when current ACR satisfies required ACR', async () => {
      mockClientFindUnique.mockResolvedValue({ requiredAcr: ACR_MFA });
      const result = await service.requiresStepUp('client-db-id', ACR_MFA);
      expect(result).toBe(false);
    });

    it('returns true when current ACR is weaker than required ACR', async () => {
      mockClientFindUnique.mockResolvedValue({ requiredAcr: ACR_MFA });
      const result = await service.requiresStepUp('client-db-id', ACR_PASSWORD);
      expect(result).toBe(true);
    });

    it('returns false when current ACR is stronger than required ACR', async () => {
      mockClientFindUnique.mockResolvedValue({ requiredAcr: ACR_MFA });
      const result = await service.requiresStepUp('client-db-id', ACR_WEBAUTHN);
      expect(result).toBe(false);
    });
  });

  // ── recordStepUp ──────────────────────────────────────────────────────────

  describe('recordStepUp()', () => {
    it('creates a step-up record with correct expiry', async () => {
      mockStepUpRecordCreate.mockResolvedValue({});
      const before = Date.now();
      await service.recordStepUp('session-1', ACR_MFA, 900);
      const after = Date.now();

      expect(mockStepUpRecordCreate).toHaveBeenCalledTimes(1);
      const callArg = mockStepUpRecordCreate.mock.calls[0][0];
      expect(callArg.data.sessionId).toBe('session-1');
      expect(callArg.data.acrLevel).toBe(ACR_MFA);

      const expiresAtMs = callArg.data.expiresAt.getTime();
      expect(expiresAtMs).toBeGreaterThanOrEqual(before + 900 * 1000);
      expect(expiresAtMs).toBeLessThanOrEqual(after + 900 * 1000);
    });

    it('uses the provided cache duration', async () => {
      mockStepUpRecordCreate.mockResolvedValue({});
      const before = Date.now();
      await service.recordStepUp('session-2', ACR_WEBAUTHN, 3600);

      const callArg = mockStepUpRecordCreate.mock.calls[0][0];
      const expiresAtMs = callArg.data.expiresAt.getTime();
      // Should be approximately now + 3600s
      expect(expiresAtMs).toBeGreaterThan(before + 3500 * 1000);
    });
  });

  // ── isStepUpCached ────────────────────────────────────────────────────────

  describe('isStepUpCached()', () => {
    it('returns true when session ACR satisfies the required level', async () => {
      // getSessionAcr will return ACR_MFA
      mockStepUpRecordFindMany.mockResolvedValue([
        {
          sessionId: 'session-1',
          acrLevel: ACR_MFA,
          expiresAt: futureDate(600),
        },
      ]);
      const cached = await service.isStepUpCached('session-1', ACR_MFA);
      expect(cached).toBe(true);
    });

    it('returns true when session ACR is stronger than required', async () => {
      mockStepUpRecordFindMany.mockResolvedValue([
        {
          sessionId: 'session-1',
          acrLevel: ACR_WEBAUTHN,
          expiresAt: futureDate(600),
        },
      ]);
      const cached = await service.isStepUpCached('session-1', ACR_MFA);
      expect(cached).toBe(true);
    });

    it('returns false when session ACR is weaker than required', async () => {
      // No active records → falls back to ACR_PASSWORD
      mockStepUpRecordFindMany.mockResolvedValue([]);
      const cached = await service.isStepUpCached('session-1', ACR_MFA);
      expect(cached).toBe(false);
    });

    it('returns false when the only record is expired (not returned by query)', async () => {
      // Prisma where clause filters out expired records, so findMany returns []
      mockStepUpRecordFindMany.mockResolvedValue([]);
      const cached = await service.isStepUpCached('session-1', ACR_MFA);
      expect(cached).toBe(false);
    });
  });

  // ── cleanupExpiredRecords ─────────────────────────────────────────────────

  describe('cleanupExpiredRecords()', () => {
    it('deletes records with expiresAt in the past', async () => {
      mockStepUpRecordDeleteMany.mockResolvedValue({ count: 3 });
      await service.cleanupExpiredRecords();

      expect(mockStepUpRecordDeleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            expiresAt: expect.objectContaining({ lt: expect.any(Date) }),
          }),
        }),
      );
    });

    it('handles the case with no expired records gracefully', async () => {
      mockStepUpRecordDeleteMany.mockResolvedValue({ count: 0 });
      await expect(service.cleanupExpiredRecords()).resolves.not.toThrow();
    });
  });
});
