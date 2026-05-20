/**
 * AuthProvider Vue component.
 *
 * An alternative to installing `IdenplanePlugin` globally — useful when you want
 * to scope the auth context to a subtree of your component tree, or when you
 * prefer to instantiate the client inline in a template.
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
 * import { AuthProvider } from '@idenplane/vue';
 * </script>
 * ```
 */

import {
  defineComponent,
  provide,
  h,
  onUnmounted,
} from 'vue';
import { IdenplaneClient } from 'idenplane-sdk';
import type { IdenplaneConfig } from 'idenplane-sdk';
import { IDENPLANE_KEY } from './plugin.js';

export const AuthProvider = defineComponent({
  name: 'AuthProvider',

  props: {
    url: { type: String, required: true },
    realm: { type: String, required: true },
    clientId: { type: String, required: true },
    redirectUri: { type: String, required: true },
    scopes: { type: Array as () => string[], default: undefined },
    storage: {
      type: String as () => 'sessionStorage' | 'localStorage' | 'memory',
      default: 'sessionStorage',
    },
    autoRefresh: { type: Boolean, default: true },
  },

  setup(props, { slots }) {
    const config: IdenplaneConfig = {
      url: props.url,
      realm: props.realm,
      clientId: props.clientId,
      redirectUri: props.redirectUri,
      scopes: props.scopes,
      storage: props.storage,
      autoRefresh: props.autoRefresh,
    };

    const client = new IdenplaneClient(config);
    provide(IDENPLANE_KEY, client);

    onUnmounted(() => {
      // future: client.destroy();
    });

    return () => slots.default?.();
  },
});
