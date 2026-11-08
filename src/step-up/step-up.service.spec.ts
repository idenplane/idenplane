import { Test, TestingModule } from '@nestjs/testing';
import {
  StepUpService,
  ACR_PASSWORD,
  ACR_MFA,
  ACR_WEBAUTHN,
  strongestAcr,
} from './step-up.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

// ─── Prisma mock ─────────────────────────────────────────────────────────────

const mockStepUpRecordFindMany = jest.fn();
const mockStepUpRecordCreate = jest.fn();
const mockStepUpRecordDeleteMany = jest.fn();
const mockClientFindUnique = jest.fn();

const mockPrisma = {
  sessionRiskProfile: { findFirst: jest.fn() },
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

  describe('getRiskRequiredAcr()', () => {
    it(`is null when none of the user's sessions is flagged for step-up`, async () => {
      mockPrisma.sessionRiskProfile.findFirst.mockResolvedValue(null);
      expect(await service.getRiskRequiredAcr('realm-1', 'user-1')).toBeNull();
    });

    it('requires MFA for a flagged session below critical risk', async () => {
      mockPrisma.sessionRiskProfile.findFirst.mockResolvedValue({
        riskScore: 65,
      });
      expect(await service.getRiskRequiredAcr('realm-1', 'user-1')).toBe(
        ACR_MFA,
      );
    });

    it('requires WebAuthn at critical risk', async () => {
      mockPrisma.sessionRiskProfile.findFirst.mockResolvedValue({
        riskScore: 85,
      });
      expect(await service.getRiskRequiredAcr('realm-1', 'user-1')).toBe(
        ACR_WEBAUTHN,
      );
    });

    it(`looks only at this user's live, unexpired, non-terminated flags in the realm`, async () => {
      mockPrisma.sessionRiskProfile.findFirst.mockResolvedValue(null);
      await service.getRiskRequiredAcr('realm-1', 'user-1');
      const { where } =
        mockPrisma.sessionRiskProfile.findFirst.mock.calls[0][0];
      expect(where).toMatchObject({
        realmId: 'realm-1',
        userId: 'user-1',
        stepUpRequired: true,
        terminateSession: false,
        stepUpExpiresAt: { gte: expect.any(Date) },
      });
    });
  });

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

  describe('strongestAcr()', () => {
    it('picks the strongest known level and ignores unknown or missing ones', () => {
      expect(strongestAcr(null, ACR_MFA, 'urn:other', undefined)).toBe(ACR_MFA);
      expect(strongestAcr(ACR_WEBAUTHN, ACR_MFA)).toBe(ACR_WEBAUTHN);
      expect(strongestAcr()).toBe(ACR_PASSWORD);
    });
  });

  // ── getLoginSessionAcr ────────────────────────────────────────────────────

  describe('getLoginSessionAcr()', () => {
    it('keeps the level the SSO session was signed in at', async () => {
      mockStepUpRecordFindMany.mockResolvedValue([]);
      await expect(
        service.getLoginSessionAcr({ id: 'session-1', satisfiedAcr: ACR_MFA }),
      ).resolves.toBe(ACR_MFA);
    });

    it('is raised by an active step-up', async () => {
      mockStepUpRecordFindMany.mockResolvedValue([
        {
          sessionId: 'session-1',
          acrLevel: ACR_WEBAUTHN,
          expiresAt: futureDate(600),
        },
      ]);
      await expect(
        service.getLoginSessionAcr({ id: 'session-1', satisfiedAcr: ACR_MFA }),
      ).resolves.toBe(ACR_WEBAUTHN);
    });

    it('treats a session with no recorded level as password-only', async () => {
      mockStepUpRecordFindMany.mockResolvedValue([]);
      await expect(
        service.getLoginSessionAcr({ id: 'session-1', satisfiedAcr: null }),
      ).resolves.toBe(ACR_PASSWORD);
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
