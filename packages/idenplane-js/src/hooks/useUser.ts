import { useAuthContext } from '../context.js';
import type { UserInfo } from '../types.js';

/**
 * Hook for user information from the ID token or userinfo endpoint.
 * Automatically refreshes when the auth state changes.
 *
 * ```tsx
 * const user = useUser();
 * // user?.name, user?.email, user?.sub, etc.
 * ```
 */
export function useUser(): UserInfo | null {
  const { user } = useAuthContext();
  return user;
}
