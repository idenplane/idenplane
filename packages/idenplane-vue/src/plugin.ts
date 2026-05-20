/**
 * Vue plugin for Idenplane.
 *
 * Install via `app.use(IdenplanePlugin, options)`.  The plugin creates a shared
 * `IdenplaneClient` instance and makes it available to every component through
 * Vue's provide/inject mechanism.
 *
 * @example
 * ```typescript
 * // main.ts
 * import { createApp } from 'vue';
 * import { IdenplanePlugin } from '@idenplane/vue';
 * import App from './App.vue';
 *
 * const app = createApp(App);
 * app.use(IdenplanePlugin, {
 *   url: 'http://localhost:3000',
 *   realm: 'my-realm',
 *   clientId: 'my-app',
 *   redirectUri: 'http://localhost:5173/callback',
 * });
 * app.mount('#app');
 * ```
 */

import type { App } from 'vue';
import { IdenplaneClient } from 'idenplane-sdk';
import type { IdenplaneConfig } from 'idenplane-sdk';

/** The provide/inject key used internally. */
export const IDENPLANE_KEY = Symbol('idenplane');

/** Options accepted by the Vue plugin — same as `IdenplaneConfig`. */
export type IdenplanePluginOptions = IdenplaneConfig;

export const IdenplanePlugin = {
  install(app: App, options: IdenplanePluginOptions): void {
    const client = new IdenplaneClient(options);
    app.provide(IDENPLANE_KEY, client);
    // Kick off OIDC discovery and session restoration immediately so that
    // guards and composables see the correct auth state on first render.
    client.init().catch((err: unknown) => {
      console.error('[idenplane-vue] init() failed:', err);
    });
  },
};
