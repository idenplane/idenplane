/**
 * @idenplane/nextjs — Next.js SDK for Idenplane
 *
 * Re-exports the core React components from `idenplane-sdk/react` so you can
 * import everything from a single package entry point.
 *
 * For server-side utilities import from the dedicated sub-paths:
 *   - `@idenplane/nextjs/middleware`  — Next.js Edge middleware
 *   - `@idenplane/nextjs/server`      — Server Component helpers
 *   - `@idenplane/nextjs/api`         — API route helpers
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
} from 'idenplane-sdk/react';

export type {
  AuthProviderProps,
  AuthmeProviderProps,
  ProtectedRouteProps,
  AuthmeConfig,
  TokenResponse,
  TokenClaims,
  UserInfo,
} from 'idenplane-sdk/react';
