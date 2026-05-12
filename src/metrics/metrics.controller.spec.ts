import { MetricsController } from './metrics.controller.js';

describe('MetricsController', () => {
  let controller: MetricsController;
  let metricsService: {
    registry: { metrics: jest.Mock };
  };

  beforeEach(() => {
    metricsService = {
      registry: {
        metrics: jest
          .fn()
          .mockResolvedValue(
            '# HELP http_requests_total\nhttp_requests_total 42',
          ),
      },
    };
    controller = new MetricsController(metricsService as any);
  });

  describe('getMetrics', () => {
    it('should return prometheus metrics string', async () => {
      const result = await controller.getMetrics();

      expect(result).toContain('http_requests_total');
      expect(metricsService.registry.metrics).toHaveBeenCalled();
    });
  });
});
