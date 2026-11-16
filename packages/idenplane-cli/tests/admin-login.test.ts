import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adminLogin, AdminLoginError } from '../src/admin-login.js';

type Call = { url: string; body: Record<string, unknown> };

function withServer(
  answers: Array<{ status: number; body: unknown }>,
  fn: (calls: Call[]) => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch;
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: url.toString(), body: JSON.parse(String(init?.body)) });
    const next = answers.shift();
    if (!next) throw new Error('unexpected request');
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as typeof fetch;
  return fn(calls).finally(() => {
    globalThis.fetch = original;
  });
}

const TOKEN = { access_token: 'sample-token', token_type: 'Bearer', expires_in: 3600 };

test('adminLogin: returns the token when no second factor is asked for', async () => {
  await withServer([{ status: 200, body: TOKEN }], async (calls) => {
    const data = await adminLogin('http://x.local', 'admin', 'pw', async () => {
      throw new Error('must not ask');
    });
    assert.equal(data.access_token, 'sample-token');
    assert.equal(calls.length, 1);
  });
});

test('adminLogin: sends an authenticator code to the second step', async () => {
  await withServer(
    [
      { status: 200, body: { mfa_required: true, mfa_token: 'm-dummy', methods: ['totp', 'recovery'] } },
      { status: 200, body: TOKEN },
    ],
    async (calls) => {
      const data = await adminLogin('http://x.local', 'admin', 'pw', async () => ' 123456 ');
      assert.equal(data.access_token, 'sample-token');
      assert.equal(calls[1].url, 'http://x.local/admin/auth/login/mfa');
      assert.deepEqual(calls[1].body, { mfa_token: 'm-dummy', method: 'totp', code: '123456' });
    },
  );
});

test('adminLogin: sends anything else as a recovery code', async () => {
  await withServer(
    [
      { status: 200, body: { mfa_required: true, mfa_token: 'm-dummy', methods: ['totp', 'recovery'] } },
      { status: 200, body: TOKEN },
    ],
    async (calls) => {
      await adminLogin('http://x.local', 'admin', 'pw', async () => 'abcdef-ghijkl-mnopqr-stuvwx');
      assert.equal(calls[1].body['method'], 'recovery');
    },
  );
});

test('adminLogin: explains a passkey-only admin and a refused code', async () => {
  await withServer(
    [{ status: 200, body: { mfa_required: true, mfa_token: 'm-dummy', methods: ['passkey'] } }],
    async () => {
      await assert.rejects(
        adminLogin('http://x.local', 'admin', 'pw', async () => ''),
        (err: unknown) => err instanceof AdminLoginError && /passkey/.test(err.message),
      );
    },
  );
  await withServer(
    [
      { status: 200, body: { mfa_required: true, mfa_token: 'm-dummy', methods: ['totp'] } },
      { status: 401, body: { message: 'Invalid code' } },
    ],
    async () => {
      await assert.rejects(
        adminLogin('http://x.local', 'admin', 'pw', async () => '000000'),
        (err: unknown) => err instanceof AdminLoginError && err.message === 'Invalid code',
      );
    },
  );
});
