/**
 * @idenplane/vue — Vue 3 SDK for Idenplane
 */

// Plugin
export { IdenplanePlugin, IDENPLANE_KEY } from './plugin.js';
export type { IdenplanePluginOptions } from './plugin.js';

// Composables
export { useAuth, useUser, usePermissions } from './composables.js';
export type { UseAuthReturn, UseUserReturn, UsePermissionsReturn } from './composables.js';

// Navigation guard
export { createAuthGuard } from './guard.js';
export type { AuthGuardOptions, AuthRouteMeta } from './guard.js';

// Components
export { AuthProvider } from './components.js';

// Re-export core types from idenplane-sdk for convenience
export { IdenplaneClient } from 'idenplane-sdk';
export type {
  IdenplaneConfig,
  TokenResponse,
  TokenClaims,
  UserInfo,
} from 'idenplane-sdk';
