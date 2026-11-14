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
      if (error.response?.status === 403) {
        announceForbidden(error.response?.data);
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
