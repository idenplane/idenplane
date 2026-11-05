import { HealthIndicatorService } from '@nestjs/terminus';
import { PrismaHealthIndicator } from './prisma-health.indicator.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('PrismaHealthIndicator', () => {
  function build(queryRawUnsafe: jest.Mock) {
    return new PrismaHealthIndicator(
      { $queryRawUnsafe: queryRawUnsafe } as unknown as PrismaService,
      new HealthIndicatorService(),
    );
  }

  it('reports up when the database answers SELECT 1', async () => {
    const query = jest.fn().mockResolvedValue([{ '?column?': 1 }]);

    await expect(build(query).isHealthy('database')).resolves.toEqual({
      database: { status: 'up' },
    });
    expect(query).toHaveBeenCalledWith('SELECT 1');
  });

  it('reports down with the driver error message when the query fails', async () => {
    const query = jest
      .fn()
      .mockRejectedValue(new Error("Can't reach database server"));

    await expect(build(query).isHealthy('database')).resolves.toEqual({
      database: { status: 'down', message: "Can't reach database server" },
    });
  });
});
