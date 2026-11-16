/**
 * AuthProvider Vue component.
 *
 * An alternative to installing `IdenplanePlugin` globally — useful when you
 * want to scope the auth context to a subtree of your component tree. It
 * provides the client to its children and starts `init()` (discovery and
 * session restore) when it is set up in the browser, like the plugin does.
 *
 * Pass either the connection props, or `client` — an `IdenplaneClient` you
 * created yourself, for example to share it with a router guard.
 *
 * @example
 * ```vue
 * <!-- App.vue -->
 * <template>
 *   <AuthProvider
 *     url="http://localhost:3000"
 *     realm="my-realm"
 *     client-id="my-app"
 *     redirect-uri="http://localhost:5173/callback"
 *   >
 *     <RouterView />
 *   </AuthProvider>
 * </template>
 *
 * <script setup>
 * import { AuthProvider } from 'idenplane-vue';
 * </script>
 * ```
 *
 * @example
 * ```vue
 * <template>
 *   <AuthProvider :client="idenplane"><RouterView /></AuthProvider>
 * </template>
 *
 * <script setup>
 * import { AuthProvider } from 'idenplane-vue';
 * import { idenplane } from './auth'; // the same client the router guard uses
 * </script>
 * ```
 */

import { defineComponent, provide } from 'vue';
import type { PropType } from 'vue';
import { IdenplaneClient } from 'idenplane-sdk';
import type { IdenplaneConfig } from 'idenplane-sdk';
import { IDENPLANE_KEY } from './plugin.js';
import { getOrStartInit } from './init.js';

export const AuthProvider = defineComponent({
  name: 'AuthProvider',

  props: {
    /** An existing client to provide. When set, the connection props are ignored. */
    client: { type: Object as PropType<IdenplaneClient>, default: undefined },
    url: { type: String, default: undefined },
    realm: { type: String, default: undefined },
    clientId: { type: String, default: undefined },
    redirectUri: { type: String, default: undefined },
    scopes: { type: Array as PropType<string[]>, default: undefined },
    storage: {
      type: String as PropType<'sessionStorage' | 'localStorage' | 'memory'>,
      default: 'sessionStorage',
    },
    autoRefresh: { type: Boolean, default: true },
  },

  setup(props, { slots }) {
    let client: IdenplaneClient;
    if (props.client) {
      client = props.client;
    } else {
      const { url, realm, clientId, redirectUri } = props;
      if (!url || !realm || !clientId || !redirectUri) {
        throw new Error(
          '[idenplane-vue] AuthProvider needs either a `client` prop or `url`, `realm`, `client-id` and `redirect-uri`.',
        );
      }
      const config: IdenplaneConfig = {
        url,
        realm,
        clientId,
        redirectUri,
        scopes: props.scopes,
        storage: props.storage,
        autoRefresh: props.autoRefresh,
      };
      client = new IdenplaneClient(config);
    }

    provide(IDENPLANE_KEY, client);

    // Start discovery and session restore, once per client (shared with the
    // guard and the composables). Browser only: during SSR there is no
    // session to restore.
    if (typeof window !== 'undefined') {
      getOrStartInit(client).catch((err: unknown) => {
        console.error('[idenplane-vue] init() failed:', err);
      });
    }

    return () => slots.default?.();
  },
});
