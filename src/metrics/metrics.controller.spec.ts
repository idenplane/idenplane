import { MetricsController } from './metrics.controller.js';

describe('MetricsController', () => {
  let controller: MetricsController;
  let metricsService: { metricsText: jest.Mock };

  beforeEach(() => {
    metricsService = {
      metricsText: jest
        .fn()
        .mockResolvedValue(
          '# HELP http_requests_total\nhttp_requests_total 42',
        ),
    };
    controller = new MetricsController(metricsService as any);
  });

  describe('getMetrics', () => {
    it('serves the metrics the service reports (cluster-wide in cluster mode)', async () => {
      const result = await controller.getMetrics();

      expect(result).toContain('http_requests_total');
      expect(metricsService.metricsText).toHaveBeenCalled();
    });
  });
});
