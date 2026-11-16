/**
 * Axios client for the admin API.
 *
 * Credentials are stored in module-level variables (heap memory) rather than
 * sessionStorage, preventing XSS scripts from reading them via the Storage API
 * (issue #330).  The React AuthContext keeps these variables up to date through
 * the exported helpers below.
 */

import axios from 'axios';

// ---------------------------------------------------------------------------
// In-memory credential store — module-level, never written to Web Storage.
// ---------------------------------------------------------------------------
let _apiKey: string | null = null;
let _token: string | null = null;

/** Called by AuthContext after a successful login. */
export function setCredentials(opts: { apiKey?: string; token?: string }) {
  _apiKey = opts.apiKey ?? null;
  _token = opts.token ?? null;
}

/** Called on logout or a 401 response. */
export function clearCredentials() {
  _apiKey = null;
  _token = null;
}

/** Returns true when any credential is present (used by ProtectedRoute). */
export function hasCredentials(): boolean {
  return _apiKey !== null || _token !== null;
}

/**
 * Attempts to rehydrate the in-memory access token from the httpOnly
 * admin_rt cookie via GET /admin/auth/refresh.  Returns the token on
 * success, null if the cookie is missing or expired.
 */
export async function refreshSession(): Promise<string | null> {
  try {
    const resp = await axios.get<{ access_token: string }>('/admin/auth/refresh', {
      withCredentials: true,
    });
    const token = resp.data.access_token;
    if (token) {
      setCredentials({ token });
    }
    return token ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 403 announcements
// ---------------------------------------------------------------------------
/** The window event ForbiddenNotice listens for. */
export const FORBIDDEN_EVENT = 'idenplane:forbidden';

export interface ForbiddenDetail {
  message: string;
}

/** Tells the console a request was refused with 403, with the server's reason. */
export function announceForbidden(body: unknown) {
  const raw =
    body && typeof body === 'object' && 'message' in body
      ? (body as { message: unknown }).message
      : undefined;
  const message =
    typeof raw === 'string' && raw.length > 0
      ? raw
      : Array.isArray(raw) && typeof raw[0] === 'string'
        ? raw[0]
        : 'Your admin role does not allow this action';
  window.dispatchEvent(
    new CustomEvent<ForbiddenDetail>(FORBIDDEN_EVENT, { detail: { message } }),
  );
}

// ---------------------------------------------------------------------------
// Admin console MFA
// ---------------------------------------------------------------------------
/**
 * The window event StepUpPrompt listens for: the server refused a request
 * because of admin MFA (`detail.code`).
 */
export const ADMIN_MFA_EVENT = 'idenplane:admin-mfa';
/** Fired by StepUpPrompt when a step-up ends: `detail.ok` says how. */
export const STEP_UP_DONE_EVENT = 'idenplane:step-up-done';

const ADMIN_MFA_CODES = new Set([
  'admin_mfa_enrolment_required',
  'admin_mfa_step_up_required',
  'admin_recent_mfa_required',
]);

export interface AdminMfaEventDetail {
  code: string;
}

/** The admin-MFA refusal code in a 403 body, if there is one. */
export function adminMfaCodeOf(body: unknown): string | null {
  const code =
    body && typeof body === 'object' && 'code' in body
      ? (body as { code: unknown }).code
      : undefined;
  return typeof code === 'string' && ADMIN_MFA_CODES.has(code) ? code : null;
}

/** Resolves when the step-up the server asked for ends: true if verified. */
export function waitForStepUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (event: Event) => {
      window.removeEventListener(STEP_UP_DONE_EVENT, done);
      resolve((event as CustomEvent<{ ok: boolean }>).detail?.ok === true);
    };
    window.addEventListener(STEP_UP_DONE_EVENT, done);
  });
}

// ---------------------------------------------------------------------------
// Axios instances
// ---------------------------------------------------------------------------
// Both instances share the same in-memory credential injection and 401
// handling; they differ only in baseURL. `apiClient` targets the admin API
// (mounted under `/admin/...`), while `rootClient` targets root-mounted
// controllers that have no `/admin` prefix (e.g. setup-wizard, the realm
// registration endpoints) — mirroring how getHealthStatus reaches `/health`.
function createClient(baseURL: string) {
  const instance = axios.create({ baseURL });

  instance.interceptors.request.use((config) => {
    if (_token) {
      config.headers['Authorization'] = `Bearer ${_token}`;
    }
    if (_apiKey) {
      config.headers['x-admin-api-key'] = _apiKey;
    }
    return config;
  });

  instance.interceptors.response.use(
    (response) => response,
    (error) => {
      const isOnLoginPage = window.location.pathname === '/console/login';
      if (error.response?.status === 401 && !isOnLoginPage) {
        clearCredentials();
        window.location.href = '/console/login';
      }
      // 403: signed in, but the admin role doesn't allow it. Tell the admin
      // (ForbiddenNotice) and keep the session; the page still gets the error.
      // An admin-MFA refusal goes to StepUpPrompt instead: enrol, or verify
      // the second factor again.
      if (error.response?.status === 403) {
        const mfaCode = adminMfaCodeOf(error.response?.data);
        if (mfaCode) {
          window.dispatchEvent(
            new CustomEvent<AdminMfaEventDetail>(ADMIN_MFA_EVENT, {
              detail: { code: mfaCode },
            }),
          );
        } else {
          announceForbidden(error.response?.data);
        }
      }
      return Promise.reject(error);
    },
  );

  return instance;
}

const apiClient = createClient(import.meta.env.VITE_API_BASE || '/admin');

/** Targets root-mounted controllers (no `/admin` prefix). */
export const rootClient = createClient('/');

export default apiClient;
