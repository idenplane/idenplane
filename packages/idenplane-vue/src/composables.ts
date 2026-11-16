/**
 * Vue composables for Idenplane.
 *
 * All composables rely on an `IdenplaneClient` injected by `IdenplanePlugin` or
 * provided manually via `AuthProvider.vue`.
 */

import { inject, ref, readonly, onMounted, onUnmounted, computed } from 'vue';
import type { Ref, ComputedRef } from 'vue';
import type { IdenplaneClient } from 'idenplane-sdk';
import type { UserInfo } from 'idenplane-sdk';
import { IDENPLANE_KEY } from './plugin.js';
import { getInitRecord, getOrStartInit } from './init.js';

// ── Internal helper ──────────────────────────────────────────────

function useClient(): IdenplaneClient {
  const client = inject<IdenplaneClient>(IDENPLANE_KEY);
  if (!client) {
    throw new Error(
      '[idenplane-vue] No IdenplaneClient found. Make sure you installed IdenplanePlugin or wrapped your component with <AuthProvider>.',
    );
  }
  return client;
}

// ── useAuth ───────────────────────────────────────────────────────

export interface UseAuthReturn {
  /** Whether the user is currently authenticated with a valid token */
  isAuthenticated: Readonly<Ref<boolean>>;
  /** The current user info (from ID token or userinfo endpoint) */
  user: Readonly<Ref<UserInfo | null>>;
  /** Whether the auth client is still initializing */
  isLoading: Readonly<Ref<boolean>>;
  /** Redirect to the Idenplane login page */
  login: (options?: { scope?: string[] }) => Promise<void>;
  /** Log the user out and clear tokens */
  logout: () => Promise<void>;
  /** Get the current access token string */
  getToken: () => string | null;
  /** Direct access to the underlying IdenplaneClient */
  client: IdenplaneClient;
}

/**
 * Primary auth composable — returns reactive auth state and actions.
 *
 * @example
 * ```vue
 * <script setup>
 * import { useAuth } from 'idenplane-vue';
 * const { isAuthenticated, user, login, logout, isLoading } = useAuth();
 * </script>
 * ```
 */
export function useAuth(): UseAuthReturn {
  const client = useClient();

  const isAuthenticated = ref(client.isAuthenticated());
  const user = ref<UserInfo | null>(client.getUserInfo());
  const isLoading = ref(true);

  let unsubLogin: (() => void) | undefined;
  let unsubLogout: (() => void) | undefined;
  let unsubRefresh: (() => void) | undefined;
  let unsubReady: (() => void) | undefined;

  onMounted(async () => {
    unsubLogin = client.on('login', () => {
      isAuthenticated.value = true;
      user.value = client.getUserInfo();
    });

    unsubLogout = client.on('logout', () => {
      isAuthenticated.value = false;
      user.value = null;
    });

    unsubRefresh = client.on('tokenRefresh', () => {
      user.value = client.getUserInfo();
    });

    unsubReady = client.on('ready', (authenticated) => {
      isAuthenticated.value = authenticated;
      if (authenticated) user.value = client.getUserInfo();
      isLoading.value = false;
    });

    // Handle OIDC callback if URL has a `code` param
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (url.searchParams.has('code')) {
        try {
          const success = await client.handleCallback();
          isAuthenticated.value = success;
          if (success) user.value = client.getUserInfo();
        } catch {
          isAuthenticated.value = false;
        }
        isLoading.value = false;
        return;
      }
    }

    // Bug #438-4 fix: use the module-level singleton so all components share
    // the same init Promise.  If init has already settled (a later-mounted
    // component), we read the cached result synchronously and skip the async
    // wait entirely — no loading flicker.
    const record = getInitRecord(client);
    if (record?.settled) {
      isAuthenticated.value = record.result;
      if (record.result) user.value = client.getUserInfo();
      isLoading.value = false;
      return;
    }

    try {
      const restored = await getOrStartInit(client);
      isAuthenticated.value = restored;
      if (restored) user.value = client.getUserInfo();
    } catch {
      isAuthenticated.value = false;
    }
    isLoading.value = false;
  });

  onUnmounted(() => {
    unsubLogin?.();
    unsubLogout?.();
    unsubRefresh?.();
    unsubReady?.();
  });

  return {
    isAuthenticated: readonly(isAuthenticated),
    user: readonly(user),
    isLoading: readonly(isLoading),
    login: (options) => client.login(options),
    logout: () => client.logout(),
    getToken: () => client.getAccessToken(),
    client,
  };
}

// ── useUser ───────────────────────────────────────────────────────

export interface UseUserReturn {
  user: Readonly<Ref<UserInfo | null>>;
  isLoading: Readonly<Ref<boolean>>;
  /** Re-fetch user info from the userinfo endpoint */
  refresh: () => Promise<void>;
}

/**
 * Composable that returns the current user and a `refresh` helper.
 *
 * @example
 * ```vue
 * <script setup>
 * import { useUser } from 'idenplane-vue';
 * const { user, refresh } = useUser();
 * </script>
 * ```
 */
export function useUser(): UseUserReturn {
  const client = useClient();

  const user = ref<UserInfo | null>(client.getUserInfo());
  const isLoading = ref(false);

  const refresh = async () => {
    isLoading.value = true;
    try {
      user.value = await client.fetchUserInfo();
    } finally {
      isLoading.value = false;
    }
  };

  const unsub = client.on('tokenRefresh', () => {
    user.value = client.getUserInfo();
  });

  onUnmounted(unsub);

  return {
    user: readonly(user),
    isLoading: readonly(isLoading),
    refresh,
  };
}

// ── usePermissions ────────────────────────────────────────────────

export interface UsePermissionsReturn {
  /** Check if the user has a specific realm role */
  hasRole: (role: string) => boolean;
  /** Check if the user has a specific permission (realm or client role) */
  hasPermission: (permission: string) => boolean;
  /** All realm roles for the current user */
  roles: ComputedRef<string[]>;
}

/**
 * Composable for permission and role checks.
 *
 * @example
 * ```vue
 * <script setup>
 * import { usePermissions } from 'idenplane-vue';
 * const { hasRole, hasPermission, roles } = usePermissions();
 * </script>
 * ```
 */
export function usePermissions(): UsePermissionsReturn {
  const client = useClient();
  const authenticated = ref(client.isAuthenticated());

  const unsub = client.on('login', () => {
    authenticated.value = true;
  });
  const unsubLogout = client.on('logout', () => {
    authenticated.value = false;
  });
  onUnmounted(() => {
    unsub();
    unsubLogout();
  });

  const roles = computed(() =>
    authenticated.value ? client.getRealmRoles() : [],
  );

  return {
    hasRole: (role) => (authenticated.value ? client.hasRealmRole(role) : false),
    hasPermission: (permission) =>
      authenticated.value ? client.hasPermission(permission) : false,
    roles,
  };
}
