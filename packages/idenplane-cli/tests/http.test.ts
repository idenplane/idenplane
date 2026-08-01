import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpClient } from '../src/http.js';

function withMockedFetch(handler: typeof fetch, fn: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

test('HttpClient.get: builds the URL with query params and returns the parsed body', async () => {
  let capturedUrl = '';
  await withMockedFetch(
    (async (url: string | URL) => {
      capturedUrl = url.toString();
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch,
    async () => {
      const client = new HttpClient({ serverUrl: 'http://x.local/', headers: {} });
      const result = await client.get<{ ok: boolean }>('/admin/realms', { search: 'a', skip: undefined as never });
      assert.equal(result.ok, true);
      assert.equal(capturedUrl, 'http://x.local/admin/realms?search=a');
    },
  );
});

test('HttpClient: returns undefined for a 204 response', async () => {
  await withMockedFetch(
    (async () => new Response(null, { status: 204 })) as typeof fetch,
    async () => {
      const client = new HttpClient({ serverUrl: 'http://x.local', headers: {} });
      const result = await client.delete('/admin/realms/r');
      assert.equal(result, undefined);
    },
  );
});

test('HttpClient: throws a chalk-colored error with the parsed message on a non-2xx response', async () => {
  await withMockedFetch(
    (async () =>
      new Response(JSON.stringify({ message: 'realm not found' }), {
        status: 404,
        statusText: 'Not Found',
      })) as typeof fetch,
    async () => {
      const client = new HttpClient({ serverUrl: 'http://x.local', headers: {} });
      await assert.rejects(client.get('/admin/realms/missing'), (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /Error 404: realm not found/);
        return true;
      });
    },
  );
});

test('HttpClient: strips a trailing slash from serverUrl', async () => {
  let capturedUrl = '';
  await withMockedFetch(
    (async (url: string | URL) => {
      capturedUrl = url.toString();
      return new Response(JSON.stringify({}), { status: 200 });
    }) as typeof fetch,
    async () => {
      const client = new HttpClient({ serverUrl: 'http://x.local/', headers: {} });
      await client.get('/admin/realms');
      assert.equal(capturedUrl, 'http://x.local/admin/realms');
    },
  );
});
