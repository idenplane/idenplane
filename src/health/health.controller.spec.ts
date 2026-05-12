jest.mock('../crypto/jwk.service.js', () => ({ JwkService: jest.fn() }));

import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  let controller: HealthController;
  let healthCheckService: { check: jest.Mock };
  let prismaHealth: { isHealthy: jest.Mock };
  let memoryHealth: { checkHeap: jest.Mock };
  let redisHealth: { isHealthy: jest.Mock };

  beforeEach(() => {
    healthCheckService = {
      check: jest.fn(),
    };
    prismaHealth = { isHealthy: jest.fn() };
    memoryHealth = { checkHeap: jest.fn() };
    redisHealth = { isHealthy: jest.fn() };

    controller = new HealthController(
      healthCheckService as any,
      memoryHealth as any,
      prismaHealth as any,
      redisHealth as any,
    );
  });

  describe('liveness', () => {
    it('should call health.check with an empty indicators array and return the result', async () => {
      const expected = { status: 'ok', details: {} };
      healthCheckService.check.mockResolvedValue(expected);

      const result = await controller.liveness();

      expect(healthCheckService.check).toHaveBeenCalledWith([]);
      expect(result).toEqual(expected);
    });
  });

  describe('liveness', () => {
    it('should call health.check with an empty indicators array and return the result', async () => {
      const expected = { status: 'ok', details: {} };
      healthCheckService.check.mockResolvedValue(expected);

      const result = await controller.liveness();

      expect(healthCheckService.check).toHaveBeenCalledWith([]);
      expect(result).toEqual(expected);
    });
  });

  describe('livenessAlias', () => {
    it('should call health.check with an empty indicators array and return the result', async () => {
      const expected = { status: 'ok', details: {} };
      healthCheckService.check.mockResolvedValue(expected);

      const result = await controller.livenessAlias();

      expect(healthCheckService.check).toHaveBeenCalledWith([]);
      expect(result).toEqual(expected);
    });
  });

  describe('readiness', () => {
    it('should call health.check with database and memory indicators', async () => {
      const dbResult = { database: { status: 'up' } };
      const memoryResult = { memory_heap: { status: 'up' } };
      const expected = {
        status: 'ok',
        details: { ...dbResult, ...memoryResult },
      };

      prismaHealth.isHealthy.mockResolvedValue(dbResult);
      memoryHealth.checkHeap.mockResolvedValue(memoryResult);

      // Make health.check invoke each indicator function it receives
      healthCheckService.check.mockImplementation(
        async (indicators: (() => Promise<unknown>)[]) => {
          for (const fn of indicators) {
            await fn();
          }
          return expected;
        },
      );

      const result = await controller.readiness();

      expect(healthCheckService.check).toHaveBeenCalledTimes(1);
      expect(prismaHealth.isHealthy).toHaveBeenCalledWith('database');
      expect(memoryHealth.checkHeap).toHaveBeenCalledWith(
        'memory_heap',
        300 * 1024 * 1024,
      );
      expect(result).toEqual(expected);
    });
  });
});
