/**
 * @authme/nextjs — Next.js SDK for AuthMe
 *
 * Re-exports the core React components from `authme-sdk/react` so you can
 * import everything from a single package entry point.
 *
 * For server-side utilities import from the dedicated sub-paths:
 *   - `@authme/nextjs/middleware`  — Next.js Edge middleware
 *   - `@authme/nextjs/server`      — Server Component helpers
 *   - `@authme/nextjs/api`         — API route helpers
 */
export {
  AuthProvider,
  AuthmeProvider,
  useAuth,
  useAuthme,
  useUser,
  usePermissions,
  useRoles,
  ProtectedRoute,
  AuthmeClient,
} from 'authme-sdk/react';

export type {
  AuthProviderProps,
  AuthmeProviderProps,
  ProtectedRouteProps,
  AuthmeConfig,
  TokenResponse,
  TokenClaims,
  UserInfo,
} from 'authme-sdk/react';
