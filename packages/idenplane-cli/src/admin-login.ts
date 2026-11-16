import type { LoginResponse } from './types.js';

/** What POST /admin/auth/login answers when the admin has a second factor. */
interface MfaChallenge {
  mfa_required: true;
  mfa_token: string;
  methods: Array<'totp' | 'passkey' | 'recovery'>;
}

/** Thrown with the server's message when a sign-in step is refused. */
export class AdminLoginError extends Error {}

async function postJson(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { message?: unknown };
  if (!res.ok) {
    const message = Array.isArray(data.message)
      ? data.message.join(', ')
      : typeof data.message === 'string'
        ? data.message
        : res.statusText;
    throw new AdminLoginError(message);
  }
  return data;
}

/**
 * Signs in to the admin API with a username and password and, when the
 * server asks for a second factor (Idenplane 0.11.0 and later), a code from
 * the authenticator app or a recovery code read with `askCode`. Passkeys
 * need a browser: use the console, or `--api-key`.
 */
export async function adminLogin(
  serverUrl: string,
  username: string,
  password: string,
  askCode: (question: string) => Promise<string>,
): Promise<LoginResponse & { mfa_enrolment_required?: boolean }> {
  const first = (await postJson(`${serverUrl}/admin/auth/login`, {
    username,
    password,
  })) as (LoginResponse & { mfa_enrolment_required?: boolean }) | MfaChallenge;

  if (!('mfa_required' in first)) return first;

  const canUseCode =
    first.methods.includes('totp') || first.methods.includes('recovery');
  if (!canUseCode) {
    throw new AdminLoginError(
      'This admin signs in with a passkey only. Sign in to the console, or use --api-key.',
    );
  }
  const answer = (
    await askCode(
      first.methods.includes('totp')
        ? 'Authenticator code (or a recovery code): '
        : 'Recovery code: ',
    )
  ).trim();
  // A six- to eight-digit answer is an authenticator code; anything else
  // is a recovery code (xxxxxx-xxxxxx-xxxxxx-xxxxxx).
  const method = /^\d{6,8}$/.test(answer) ? 'totp' : 'recovery';
  return (await postJson(`${serverUrl}/admin/auth/login/mfa`, {
    mfa_token: first.mfa_token,
    method,
    code: answer,
  })) as LoginResponse;
}
