/**
 * Vue Router navigation guard for Idenplane.
 *
 * @example
 * ```typescript
 * // router/index.ts
 * import { createRouter, createWebHistory } from 'vue-router';
 * import { createAuthGuard } from 'idenplane-vue';
 * import { idenplane } from '../auth'; // the client also passed to IdenplanePlugin
 *
 * const router = createRouter({ history: createWebHistory(), routes });
 *
 * router.beforeEach(createAuthGuard({
 *   loginRoute: '/login',
 *   roles: ['admin'],  // optional — require roles on all guarded routes
 * }, idenplane));
 *
 * export default router;
 * ```
 *
 * Or use the guard selectively via route meta:
 * ```typescript
 * const routes = [
 *   {
 *     path: '/dashboard',
 *     component: Dashboard,
 *     meta: { requiresAuth: true, roles: ['admin'] },
 *   },
 * ];
 * ```
 */

import type { NavigationGuard, RouteLocationNormalized } from 'vue-router';
import * as Vue from 'vue';
import type { IdenplaneClient } from 'idenplane-sdk';
import { IDENPLANE_KEY } from './plugin.js';
import { getOrStartInit } from './init.js';

/**
 * inject() without warnings where possible: Vue 3.3+ exposes
 * hasInjectionContext(), and vue-router 4.2+ runs guards inside the app's
 * injection context (app.runWithContext), so a guard created at module level
 * can still find the client the plugin provided. On older versions this
 * returns undefined and the client must be passed explicitly.
 */
function tryInject(): IdenplaneClient | undefined {
  const has = (Vue as { hasInjectionContext?: () => boolean }).hasInjectionContext;
  if (typeof has === 'function' && !has()) return undefined;
  if (typeof has !== 'function' && !Vue.getCurrentInstance()) return undefined;
  try {
    return Vue.inject<IdenplaneClient | undefined>(IDENPLANE_KEY, undefined);
  } catch {
    return undefined;
  }
}

export interface AuthGuardOptions {
  /**
   * Route name or path to redirect unauthenticated users to.
   * Default: '/login'
   */
  loginRoute?: string;
  /**
   * Global required roles — the user must have ALL of them to proceed.
   * Per-route roles in `route.meta.roles` override this.
   */
  roles?: string[];
}

/** Extended route meta fields recognised by createAuthGuard. */
export interface AuthRouteMeta {
  /** If true (or roles are set), the route is protected. */
  requiresAuth?: boolean;
  /** Roles required to access this specific route. */
  roles?: string[];
}

/**
 * Create a Vue Router `NavigationGuard` that enforces authentication and
 * optional role requirements.
 *
 * Pass the client as the second argument: the same instance you give to
 * `IdenplanePlugin` (`app.use(IdenplanePlugin, { client })`) or to
 * `<AuthProvider :client>`, so the guard and the components share one
 * session and one `init()`:
 *
 * ```typescript
 * import { createAuthGuard, IdenplaneClient } from 'idenplane-vue';
 *
 * export const idenplane = new IdenplaneClient({ ... });
 * router.beforeEach(createAuthGuard({ loginRoute: '/login' }, idenplane));
 * app.use(IdenplanePlugin, { client: idenplane });
 * ```
 *
 * Without the second argument the guard looks the client up with
 * `inject()`: when it is created inside a component's setup, or — on Vue
 * 3.3+ with vue-router 4.2+ — when the guard runs, since the router then
 * provides the app's injection context. If no client can be found the guard
 * fails closed and redirects to the login route.
 */
export function createAuthGuard(
  options: AuthGuardOptions = {},
  clientOverride?: IdenplaneClient,
): NavigationGuard {
  const { loginRoute = '/login', roles: globalRoles = [] } = options;

  // inject() only works synchronously, in setup() or (Vue 3.3+ with
  // vue-router 4.2+) while the router calls the guard. Try both: here, for a
  // guard created in setup(), and again at the start of each navigation.
  const injectedClient: IdenplaneClient | undefined = clientOverride ? undefined : tryInject();

  return async (
    to: RouteLocationNormalized,
    _from: RouteLocationNormalized,
  ) => {
    // Prefer the explicit client, then one injected at creation, then one
    // injected now — before any await, while the router's injection
    // context is active.
    const client: IdenplaneClient | undefined =
      clientOverride ?? injectedClient ?? tryInject();

    // The login route itself is never guarded: redirecting it to itself
    // would loop forever (it did whenever no client was found, or with
    // global `roles`).
    if (to.path === loginRoute || to.name === loginRoute) return true;

    const meta = to.meta as AuthRouteMeta | undefined;
    const routeRequiresAuth =
      meta?.requiresAuth === true ||
      (meta?.roles && meta.roles.length > 0) ||
      globalRoles.length > 0;

    if (!routeRequiresAuth) return true;

    if (!client) {
      console.warn(
        '[idenplane-vue] createAuthGuard: no IdenplaneClient available. ' +
          'Pass the client as the second argument or install IdenplanePlugin.',
      );
      // Fail closed: no client means we cannot verify identity, so block
      // navigation to this protected route and redirect to the login route.
      return { path: loginRoute, query: { next: to.fullPath } };
    }

    // Ensure the client is initialized before checking auth state
    if (!client.isAuthenticated()) {
      try {
        await getOrStartInit(client);
      } catch {
        // init failed — treat as unauthenticated
      }
    }

    if (!client.isAuthenticated()) {
      return { path: loginRoute, query: { next: to.fullPath } };
    }

    // Role check — per-route roles take precedence over global
    const requiredRoles = (meta?.roles ?? globalRoles);
    if (requiredRoles.length > 0) {
      const hasAll = requiredRoles.every((role) => client!.hasRealmRole(role));
      if (!hasAll) {
        // Redirect to login (or a dedicated forbidden page if you want)
        return { path: loginRoute, query: { error: 'forbidden' } };
      }
    }

    return true;
  };
}
