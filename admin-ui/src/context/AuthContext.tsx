/**
 * AuthContext — in-memory credential store.
 *
 * Credentials (API key and bearer token) are kept only in JavaScript heap
 * memory, never written to sessionStorage/localStorage.  This eliminates the
 * XSS-theft vector described in issue #330.
 *
 * Trade-off: credentials are lost on a full page reload (F5).  Users will be
 * redirected to /console/login and must log in again, which is acceptable for
 * an admin console.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

interface AuthState {
  apiKey: string | null;
  token: string | null;
}

interface AuthContextValue extends AuthState {
  setApiKey: (key: string) => void;
  setToken: (token: string) => void;
  clearAuth: () => void;
  /** Ref giving the api/client interceptor synchronous access to the latest credentials. */
  credentialsRef: React.RefObject<AuthState>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState>({ apiKey: null, token: null });

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

  const value = useMemo<AuthContextValue>(
    () => ({ ...auth, setApiKey, setToken, clearAuth, credentialsRef }),
    [auth, setApiKey, setToken, clearAuth, credentialsRef],
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
