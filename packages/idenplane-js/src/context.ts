import { createContext, useContext } from 'react';
import type { IdenplaneClient } from './client.js';
import type { UserInfo } from './types.js';

/**
 * Internal shape of the auth context value. Not part of the public API —
 * consumers read auth state via `useAuth()`/`useUser()`/etc., not this type.
 */
export interface AuthContextValue {
  client: IdenplaneClient;
  isAuthenticated: boolean;
  isLoading: boolean;
  user: UserInfo | null;
  login: (options?: { scope?: string[] }) => Promise<void>;
  logout: () => Promise<void>;
  getToken: () => string | null;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

/** Read the auth context, throwing if used outside an `<AuthProvider>`. */
export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('Auth hooks must be used within an <AuthProvider>');
  }
  return ctx;
}
