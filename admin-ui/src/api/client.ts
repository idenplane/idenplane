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
 * Returns true when an httpOnly admin session cookie is likely present.
 * The cookie itself is not readable from JS (httpOnly), so we use a
 * sibling, non-sensitive marker cookie set on login to know a session
 * *might* exist without exposing the token. Falls back to checking
 * hasCredentials() so the in-memory path still works.
 */
export function hasSessionMarker(): boolean {
  if (hasCredentials()) return true;
  return document.cookie.includes('IDENPLANE_ADMIN_SESSION_MARKER=1');
}

/**
 * Best-effort session restore after a page reload.
 *
 * Calls `/auth/me`; the backend reads the httpOnly session cookie and, if
 * valid, returns the admin user. We then hydrate the in-memory token store
 * with a sentinel so hasCredentials() returns true and the axios
 * interceptor stops trying to attach a missing Authorization header — the
 * cookie alone authenticates subsequent requests.
 *
 * Returns the admin user on success, or null when no valid session exists.
 */
export async function restoreSession(): Promise<{ userId: string; roles: string[] } | null> {
  // If we already have in-memory credentials, nothing to restore.
  if (hasCredentials()) return null;
  try {
    const { data } = await apiClient.get<{ userId: string; roles: string[] }>('/auth/me');
    // Mark the in-memory store so hasCredentials() is true. The actual token
    // lives in the httpOnly cookie; we use a sentinel value here only to
    // gate ProtectedRoute and avoid re-running restore.
    _token = '__session_cookie__';
    return data;
  } catch {
    return null;
  }
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
  const instance = axios.create({
    baseURL,
    // Send cookies (httpOnly IDENPLANE_ADMIN_SESSION) with every request so
    // the admin session survives full page reloads. The backend CORS config
    // already sets `credentials: true`.
    withCredentials: true,
  });

  instance.interceptors.request.use((config) => {
    // The sentinel token means "auth via httpOnly cookie" — don't attach an
    // Authorization header; the browser sends the cookie automatically.
    if (_token && _token !== '__session_cookie__') {
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
      return Promise.reject(error);
    },
  );

  return instance;
}

const apiClient = createClient(import.meta.env.VITE_API_BASE || '/admin');

/** Targets root-mounted controllers (no `/admin` prefix). */
export const rootClient = createClient('/');

export default apiClient;
