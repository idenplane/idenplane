import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUrlWithQuery, extractErrorMessage, rawRequest } from '../src/index.js';

test('buildUrlWithQuery: joins base + path with no query', () => {
  assert.equal(buildUrlWithQuery('http://x.local', '/admin/realms'), 'http://x.local/admin/realms');
});

test('buildUrlWithQuery: appends query params, skipping undefined values', () => {
  const url = buildUrlWithQuery('http://x.local', '/admin/realms/r/users', {
    limit: '50',
    skip: undefined,
    search: 'alice',
  });
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('limit'), '50');
  assert.equal(parsed.searchParams.has('skip'), false);
  assert.equal(parsed.searchParams.get('search'), 'alice');
});

test('extractErrorMessage: prefers `message` over `error` over statusText', () => {
  assert.equal(
    extractErrorMessage({ json: { message: 'bad request' }, statusText: 'Bad Request' }),
    'bad request',
  );
  assert.equal(
    extractErrorMessage({ json: { error: 'nope' }, statusText: 'Bad Request' }),
    'nope',
  );
  assert.equal(extractErrorMessage({ json: null, statusText: 'Not Found' }), 'Not Found');
});

test('extractErrorMessage: joins array messages', () => {
  assert.equal(
    extractErrorMessage({ json: { message: ['field a is required', 'field b is required'] }, statusText: '' }),
    'field a is required, field b is required',
  );
});

test('rawRequest: returns a null json body and ok=true for a 204', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(null, { status: 204 })) as typeof fetch;
  try {
    const response = await rawRequest({ method: 'DELETE', url: 'http://x.local/thing', headers: {} });
    assert.equal(response.status, 204);
    assert.equal(response.ok, true);
    assert.equal(response.json, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rawRequest: parses a JSON body and reports non-2xx as not ok', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ message: 'realm not found' }), {
      status: 404,
      statusText: 'Not Found',
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch;
  try {
    const response = await rawRequest({ method: 'GET', url: 'http://x.local/thing', headers: {} });
    assert.equal(response.status, 404);
    assert.equal(response.ok, false);
    assert.deepEqual(response.json, { message: 'realm not found' });
    assert.equal(extractErrorMessage(response), 'realm not found');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rawRequest: sends a JSON body only when one is provided', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<RequestInit | undefined> = [];
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    calls.push(init);
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  try {
    await rawRequest({ method: 'POST', url: 'http://x.local/thing', headers: {}, body: { a: 1 } });
    await rawRequest({ method: 'DELETE', url: 'http://x.local/thing', headers: {} });
    assert.equal(calls[0]?.body, JSON.stringify({ a: 1 }));
    assert.equal(calls[1]?.body, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
