import '@testing-library/jest-dom';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './mocks/server';

// MSW's XHR interceptor can fire a progress/load callback after jsdom tears down.
// At that point the lookup resolves against the bare Node global where ProgressEvent
// is not defined. The fix: always pin the polyfill unconditionally — jsdom may
// provide its own during tests, but the polyfill persists on the underlying worker
// global after jsdom cleanup. The previous conditional form never ran because jsdom
// always has ProgressEvent, leaving the Node global unpatched.
(globalThis as { ProgressEvent: unknown }).ProgressEvent = class ProgressEvent extends Event {
  readonly lengthComputable: boolean;
  readonly loaded: number;
  readonly total: number;
  constructor(type: string, init?: ProgressEventInit) {
    super(type, init);
    this.lengthComputable = init?.lengthComputable ?? false;
    this.loaded = init?.loaded ?? 0;
    this.total = init?.total ?? 0;
  }
};

// Start MSW server before all tests
beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));

// Reset handlers after each test to avoid state leaking between tests
afterEach(() => server.resetHandlers());

// Stop server after all tests
afterAll(() => server.close());
