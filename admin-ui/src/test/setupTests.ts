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

// jsdom implements neither URL.createObjectURL nor revokeObjectURL. Vitest fills
// the gap with a shim that converts the Blob through jsdom's private internals
// (`blob[implSymbol]._buffer`), which jsdom 30.1 no longer has — so any component
// building a preview or download URL (ImageUploader, theme export, migration
// report) threw an uncaught TypeError. Tests never need the bytes behind the
// URL, only a stable string, so pin a self-contained stand-in. Individual tests
// can still spy on or replace these to assert on what was passed.
let objectUrlCounter = 0;
URL.createObjectURL = () => `blob:test/${++objectUrlCounter}`;
URL.revokeObjectURL = () => {};

// Start MSW server before all tests
beforeAll(() => server.listen({ onUnhandledFrame: 'warn' }));

// Reset handlers after each test to avoid state leaking between tests
afterEach(() => server.resetHandlers());

// Stop server after all tests
afterAll(() => server.close());
