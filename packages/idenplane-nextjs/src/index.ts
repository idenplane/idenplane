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
  IdenplaneProvider,
  useAuth,
  useIdenplane,
  useUser,
  usePermissions,
  useRoles,
  ProtectedRoute,
  IdenplaneClient,
} from 'idenplane-sdk/react';

export type {
  AuthProviderProps,
  IdenplaneProviderProps,
  ProtectedRouteProps,
  IdenplaneConfig,
  TokenResponse,
  TokenClaims,
  UserInfo,
} from 'idenplane-sdk/react';
