/**
 * AuthContext — in-memory credential store with cookie-based persistence.
 *
 * Credentials (API key and bearer token) are kept only in JavaScript heap
 * memory, never written to sessionStorage/localStorage.  This eliminates the
 * XSS-theft vector described in issue #330.
 *
 * For login persistence across full page reloads (F5), the backend sets an
 * httpOnly `IDENPLANE_ADMIN_SESSION` cookie on login. On mount, the provider
 * probes `/admin/auth/me`; if the cookie is valid, the in-memory store is
 * hydrated with a sentinel and subsequent requests authenticate via the
 * cookie (axios `withCredentials: true`).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { hasSessionMarker, restoreSession } from '../api/client';

interface AuthState {
  apiKey: string | null;
  token: string | null;
}

interface AuthContextValue extends AuthState {
  setApiKey: (key: string) => void;
  setToken: (token: string) => void;
  clearAuth: () => void;
  /** True while a session restore probe is in flight on initial mount. */
  restoring: boolean;
  /** Ref giving the api/client interceptor synchronous access to the latest credentials. */
  credentialsRef: React.RefObject<AuthState>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState>({ apiKey: null, token: null });
  const [restoring, setRestoring] = useState<boolean>(() => hasSessionMarker());

  // Keep a ref in sync so the axios interceptor (which runs outside React's
  // render cycle) can read the latest value synchronously without a closure
  // over a stale state snapshot.
  const credentialsRef = useRef<AuthState>(auth);

  const update = useCallback((next: AuthState) => {
    credentialsRef.current = next;
    setAuth(next);
  }, []);

  const setApiKey = useCallback(
    (key: string) => update({ apiKey: key, token: null }),
    [update],
  );

  const setToken = useCallback(
    (tok: string) => update({ apiKey: null, token: tok }),
    [update],
  );

  const clearAuth = useCallback(
    () => update({ apiKey: null, token: null }),
    [update],
  );

  // On mount, if a session marker cookie is present, probe the backend to
  // restore the session without requiring the user to log in again.
  useEffect(() => {
    if (!hasSessionMarker()) {
      setRestoring(false);
      return;
    }
    let cancelled = false;
    restoreSession()
      .then((user) => {
        if (cancelled) return;
        if (!user) {
          // Probe failed — no valid session. Make sure the sentinel is cleared
          // so hasCredentials() reflects reality.
          setRestoring(false);
        } else {
          // restoreSession already set the sentinel token in the module store.
          // Mirror it into React state so hasCredentials() is true.
          setAuth({ apiKey: null, token: '__session_cookie__' });
          credentialsRef.current = { apiKey: null, token: '__session_cookie__' };
          setRestoring(false);
        }
      })
      .catch(() => {
        if (!cancelled) setRestoring(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ ...auth, setApiKey, setToken, clearAuth, restoring, credentialsRef }),
    [auth, setApiKey, setToken, clearAuth, restoring, credentialsRef],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Returns the full AuthContext value — must be used inside <AuthProvider>. */
// eslint-disable-next-line react-refresh/only-export-components -- hook is intentionally co-located with its provider; only affects Fast Refresh granularity.
export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuthContext must be used inside <AuthProvider>');
  }
  return ctx;
}
