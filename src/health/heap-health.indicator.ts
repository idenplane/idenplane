import { Injectable } from '@nestjs/common';
import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { getHeapStatistics } from 'node:v8';

/**
 * Share of V8's heap limit above which the process is reported not ready.
 * Close to the limit V8 spends its time in full collections and the next
 * large allocation ends the process, so new traffic should go elsewhere.
 */
export const HEAP_READINESS_FRACTION = 0.9;

/**
 * Readiness by heap use, relative to the limit this process actually has
 * (`--max-old-space-size`, or the default V8 derives from the memory
 * available to the container).
 *
 * A fixed number of bytes is wrong here: V8 lets the heap grow well past a
 * few hundred megabytes under load before it collects, when the limit allows
 * it. Failing readiness then takes a healthy, busy instance out of rotation
 * and moves its load onto the others.
 */
@Injectable()
export class HeapHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  isHealthy(key: string): HealthIndicatorResult {
    const indicator = this.healthIndicatorService.check(key);
    const { used_heap_size: used, heap_size_limit: limit } =
      getHeapStatistics();
    // /health/ready is public, so the answer carries no sizes.
    if (limit > 0 && used > limit * HEAP_READINESS_FRACTION) {
      return indicator.down({ message: 'Used heap is close to its limit' });
    }
    return indicator.up();
  }
}
