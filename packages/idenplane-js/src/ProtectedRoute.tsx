import type { ReactNode } from 'react';
import { useAuthContext } from './context.js';

export interface ProtectedRouteProps {
  children: ReactNode;
  /**
   * Required realm roles. The user must have ALL of these roles.
   * If empty or not set, only authentication is required.
   */
  roles?: string[];
  /**
   * Component to render while auth state is loading.
   * Defaults to null (render nothing).
   */
  fallback?: ReactNode;
  /**
   * Called when the user is not authenticated.
   * Use this to perform a redirect or render a login button.
   * If not provided, renders null when unauthenticated.
   */
  onUnauthorized?: () => ReactNode | null;
  /**
   * Called when the user lacks the required roles.
   * If not provided, renders null when unauthorized.
   */
  onForbidden?: () => ReactNode | null;
}

/**
 * Wraps content that requires authentication (and optionally specific roles).
 * Renders children when the user is authenticated and has required roles.
 *
 * ```tsx
 * <ProtectedRoute roles={['admin']}>
 *   <AdminPanel />
 * </ProtectedRoute>
 * ```
 */
export function ProtectedRoute({
  children,
  roles = [],
  fallback = null,
  onUnauthorized,
  onForbidden,
}: ProtectedRouteProps): ReactNode {
  const { isAuthenticated, isLoading, client } = useAuthContext();

  if (isLoading) {
    return fallback;
  }

  if (!isAuthenticated) {
    return onUnauthorized ? onUnauthorized() : null;
  }

  if (roles.length > 0) {
    const hasAllRoles = roles.every((role) => client.hasRealmRole(role));
    if (!hasAllRoles) {
      return onForbidden ? onForbidden() : null;
    }
  }

  return children;
}
