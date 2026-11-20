const getHeapStatistics = jest.fn();
jest.mock('node:v8', () => ({ getHeapStatistics }));

import {
  HEAP_READINESS_FRACTION,
  HeapHealthIndicator,
} from './heap-health.indicator.js';

const MB = 1024 * 1024;

describe('HeapHealthIndicator', () => {
  const up = jest.fn((data?: object) => ({
    memory_heap: { status: 'up', ...data },
  }));
  const down = jest.fn((data?: object) => ({
    memory_heap: { status: 'down', ...data },
  }));
  const indicator = new HeapHealthIndicator({
    check: () => ({ up, down }),
  } as any);

  beforeEach(() => jest.clearAllMocks());

  it('is up above the old fixed 300 MB when the limit leaves room', () => {
    getHeapStatistics.mockReturnValue({
      used_heap_size: 900 * MB,
      heap_size_limit: 4096 * MB,
    });

    expect(indicator.isHealthy('memory_heap')).toEqual({
      memory_heap: { status: 'up' },
    });
  });

  it('is up exactly at the threshold', () => {
    getHeapStatistics.mockReturnValue({
      used_heap_size: 1000 * HEAP_READINESS_FRACTION,
      heap_size_limit: 1000,
    });

    expect(indicator.isHealthy('memory_heap')).toEqual({
      memory_heap: { status: 'up' },
    });
  });

  it('is down close to the limit, and gives no sizes', () => {
    getHeapStatistics.mockReturnValue({
      used_heap_size: 240 * MB,
      heap_size_limit: 256 * MB,
    });

    expect(indicator.isHealthy('memory_heap')).toEqual({
      memory_heap: {
        status: 'down',
        message: 'Used heap is close to its limit',
      },
    });
  });

  it('is up when V8 reports no limit', () => {
    getHeapStatistics.mockReturnValue({
      used_heap_size: 500 * MB,
      heap_size_limit: 0,
    });

    expect(indicator.isHealthy('memory_heap')).toEqual({
      memory_heap: { status: 'up' },
    });
  });
});
