import '@testing-library/jest-dom';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './mocks/server';

// jsdom defines ProgressEvent on `window`, but a late XHR progress/load callback
// from MSW can fire after the jsdom realm is torn down, where the lookup resolves
// against the bare Node global instead — there `ProgressEvent` is undefined,
// surfacing as an intermittent "ProgressEvent is not defined" unhandled error
// that flakes the suite under CI parallelism. Pin a minimal global polyfill.
if (typeof (globalThis as { ProgressEvent?: unknown }).ProgressEvent === 'undefined') {
  class ProgressEventPolyfill extends Event {
    readonly lengthComputable: boolean;
    readonly loaded: number;
    readonly total: number;
    constructor(type: string, init?: ProgressEventInit) {
      super(type, init);
      this.lengthComputable = init?.lengthComputable ?? false;
      this.loaded = init?.loaded ?? 0;
      this.total = init?.total ?? 0;
    }
  }
  (globalThis as { ProgressEvent?: unknown }).ProgressEvent = ProgressEventPolyfill;
}

// Start MSW server before all tests
beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));

// Reset handlers after each test to avoid state leaking between tests
afterEach(() => server.resetHandlers());

// Stop server after all tests
afterAll(() => server.close());
