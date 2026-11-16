/**
 * Vue plugin for Idenplane.
 *
 * Install via `app.use(IdenplanePlugin, options)`. The plugin provides one
 * `IdenplaneClient` to every component through Vue's provide/inject and starts
 * `init()` (discovery and session restore) right away.
 *
 * To use the same client in a router guard defined at module level (where
 * `inject()` is not available), create the client yourself and pass it to
 * both the plugin and `createAuthGuard`:
 *
 * @example
 * ```typescript
 * // auth.ts
 * import { IdenplaneClient } from 'idenplane-vue';
 * export const idenplane = new IdenplaneClient({
 *   url: 'http://localhost:3000',
 *   realm: 'my-realm',
 *   clientId: 'my-app',
 *   redirectUri: 'http://localhost:5173/callback',
 * });
 *
 * // router.ts
 * import { createAuthGuard } from 'idenplane-vue';
 * import { idenplane } from './auth';
 * router.beforeEach(createAuthGuard({ loginRoute: '/login' }, idenplane));
 *
 * // main.ts
 * import { IdenplanePlugin } from 'idenplane-vue';
 * import { idenplane } from './auth';
 * app.use(IdenplanePlugin, { client: idenplane });
 * ```
 *
 * Passing a configuration object instead (`app.use(IdenplanePlugin, { url,
 * realm, clientId, redirectUri })`) still works; the plugin then creates the
 * client, and only code running inside components can reach it.
 */

import type { App } from 'vue';
import { IdenplaneClient } from 'idenplane-sdk';
import type { IdenplaneConfig } from 'idenplane-sdk';
import { getOrStartInit } from './init.js';

/** The provide/inject key used internally. */
export const IDENPLANE_KEY = Symbol('idenplane');

/**
 * Options accepted by the Vue plugin: an `IdenplaneConfig` (the plugin creates
 * the client), or an existing client to share with code outside components,
 * such as a router guard — as `{ client }` or passed directly.
 */
export type IdenplanePluginOptions = IdenplaneConfig | { client: IdenplaneClient } | IdenplaneClient;

// Duck-typed rather than instanceof: an app can end up with two copies of
// idenplane-sdk.
function isClient(value: unknown): value is IdenplaneClient {
  const v = value as Partial<IdenplaneClient> | null;
  return !!v && typeof v.init === 'function' && typeof v.getAccessToken === 'function';
}

/** Resolve plugin options to a client. */
export function resolvePluginClient(options: IdenplanePluginOptions): IdenplaneClient {
  if (isClient(options)) return options;
  if (options && 'client' in options && options.client !== undefined) {
    if (!isClient(options.client)) {
      throw new TypeError('[idenplane-vue] IdenplanePlugin: `client` must be an IdenplaneClient');
    }
    return options.client;
  }
  return new IdenplaneClient(options as IdenplaneConfig);
}

export const IdenplanePlugin = {
  install(app: App, options: IdenplanePluginOptions): void {
    const client = resolvePluginClient(options);
    app.provide(IDENPLANE_KEY, client);
    // Kick off OIDC discovery and session restoration immediately so that
    // guards and composables see the correct auth state on first render.
    // Shared with the guard and composables, so it runs once per client.
    getOrStartInit(client).catch((err: unknown) => {
      console.error('[idenplane-vue] init() failed:', err);
    });
  },
};
