/**
 * @authme/vue — Vue 3 SDK for AuthMe
 */

// Plugin
export { AuthmePlugin, AUTHME_KEY } from './plugin.js';
export type { AuthmePluginOptions } from './plugin.js';

// Composables
export { useAuth, useUser, usePermissions } from './composables.js';
export type { UseAuthReturn, UseUserReturn, UsePermissionsReturn } from './composables.js';

// Navigation guard
export { createAuthGuard } from './guard.js';
export type { AuthGuardOptions, AuthRouteMeta } from './guard.js';

// Components
export { AuthProvider } from './components.js';

// Re-export core types from authme-sdk for convenience
export { AuthmeClient } from 'authme-sdk';
export type {
  AuthmeConfig,
  TokenResponse,
  TokenClaims,
  UserInfo,
} from 'authme-sdk';
