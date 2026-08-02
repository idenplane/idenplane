// Re-export core for convenience
export { IdenplaneClient } from './client.js';
export type {
  IdenplaneConfig,
  IdenplaneEventMap,
  TokenClaims,
  TokenResponse,
  UserInfo,
} from './types.js';

export { AuthProvider } from './provider.js';
export type { AuthProviderProps } from './provider.js';

export { useAuth } from './hooks/useAuth.js';
export { useUser } from './hooks/useUser.js';
export { usePermissions } from './hooks/usePermissions.js';
export { useRoles } from './hooks/useRoles.js';

export { ProtectedRoute } from './ProtectedRoute.js';
export type { ProtectedRouteProps } from './ProtectedRoute.js';

export { IdenplaneProvider, useIdenplane } from './deprecated.js';
export type { IdenplaneProviderProps } from './deprecated.js';
