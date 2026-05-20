/**
 * Vue plugin for AuthMe.
 *
 * Install via `app.use(AuthmePlugin, options)`.  The plugin creates a shared
 * `AuthmeClient` instance and makes it available to every component through
 * Vue's provide/inject mechanism.
 *
 * @example
 * ```typescript
 * // main.ts
 * import { createApp } from 'vue';
 * import { AuthmePlugin } from '@authme/vue';
 * import App from './App.vue';
 *
 * const app = createApp(App);
 * app.use(AuthmePlugin, {
 *   url: 'http://localhost:3000',
 *   realm: 'my-realm',
 *   clientId: 'my-app',
 *   redirectUri: 'http://localhost:5173/callback',
 * });
 * app.mount('#app');
 * ```
 */

import type { App } from 'vue';
import { AuthmeClient } from 'authme-sdk';
import type { AuthmeConfig } from 'authme-sdk';

/** The provide/inject key used internally. */
export const AUTHME_KEY = Symbol('authme');

/** Options accepted by the Vue plugin — same as `AuthmeConfig`. */
export type AuthmePluginOptions = AuthmeConfig;

export const AuthmePlugin = {
  install(app: App, options: AuthmePluginOptions): void {
    const client = new AuthmeClient(options);
    app.provide(AUTHME_KEY, client);
    // Kick off OIDC discovery and session restoration immediately so that
    // guards and composables see the correct auth state on first render.
    client.init().catch((err: unknown) => {
      console.error('[authme-vue] init() failed:', err);
    });
  },
};
