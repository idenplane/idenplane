import { useAuthContext } from '../context.js';

/**
 * Primary auth hook — returns auth state and actions.
 *
 * ```tsx
 * const { isAuthenticated, isLoading, login, logout, getToken, user } = useAuth();
 * ```
 */
export function useAuth() {
  const { client, isAuthenticated, isLoading, user, login, logout, getToken } = useAuthContext();
  return { isAuthenticated, isLoading, login, logout, getToken, user, client };
}
