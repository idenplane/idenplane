import { PATH_METADATA } from '@nestjs/common/constants';
import {
  ADMIN_REALM_PARAM_KEY,
  ADMIN_SCOPE_KEY,
  ADMIN_SENSITIVE_READ_KEY,
  type AdminRealmLookup,
  type AdminRealmParamOptions,
  type AdminScopeKind,
} from '../common/decorators/admin-access.decorator.js';
import {
  REQUIRED_ADMIN_ROLES_KEY,
  type AdminRolesOptions,
} from '../common/decorators/require-admin-roles.decorator.js';

/**
 * What kind of admin route a handler is. Worked out once per handler from
 * Nest metadata, by the guard at runtime and by the fitness test.
 */
export type AdminRouteScope =
  | { kind: 'self' }
  | { kind: 'global' }
  | { kind: 'realm'; param: string; lookup: AdminRealmLookup };

export interface AdminRoutePolicy {
  scope: AdminRouteScope;
  /** A GET that reveals a secret: it needs change rights. */
  sensitiveRead: boolean;
  /** Every `@RequireAdminRoles` on the handler and on the controller. */
  requiredRoles: AdminRolesOptions[];
  /**
   * Set when the policy could not be worked out and fell back to `global`
   * (fail closed). The fitness test fails on any route that has one.
   */
  problem?: string;
}

/** Route parameters recognised as a realm without a decorator. */
export const IMPLICIT_REALM_PARAMS = ['realmName', 'realm'] as const;

function own(key: string, target: unknown): unknown {
  return typeof target === 'function' || (typeof target === 'object' && target)
    ? (Reflect.getMetadata(key, target) as unknown)
    : undefined;
}

/** Handler metadata wins over controller metadata. */
function override<T>(key: string, handler: unknown, controller: unknown) {
  const fromHandler = own(key, handler);
  return (fromHandler ?? own(key, controller)) as T | undefined;
}

function asPathList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((p): p is string => typeof p === 'string');
  }
  return typeof value === 'string' ? [value] : [''];
}

/**
 * The `:param` names in an Express route path. Splits on `/` and reads each
 * segment by hand (no regular expression), dropping a trailing `?`, `*` or
 * `+` modifier and anything from a `(` pattern onwards.
 */
export function routeParamNames(path: string): string[] {
  const names: string[] = [];
  for (const segment of path.split('/')) {
    if (!segment.startsWith(':')) continue;
    let end = 1;
    while (end < segment.length) {
      const ch = segment[end];
      if (ch === '?' || ch === '*' || ch === '+' || ch === '(') break;
      end += 1;
    }
    const name = segment.slice(1, end);
    if (name) names.push(name);
  }
  return names;
}

/** Every full path (controller path + handler path) a handler serves. */
export function fullRoutePaths(
  controller: unknown,
  handler: unknown,
): string[] {
  const out: string[] = [];
  for (const base of asPathList(own(PATH_METADATA, controller))) {
    for (const sub of asPathList(own(PATH_METADATA, handler))) {
      const joined = [base, sub]
        .map((p) => p.split('/').filter(Boolean).join('/'))
        .filter(Boolean)
        .join('/');
      out.push(`/${joined}`);
    }
  }
  return out;
}

function requiredRolesOf(handler: unknown, controller: unknown) {
  const list: AdminRolesOptions[] = [];
  for (const target of [handler, controller]) {
    const options = own(REQUIRED_ADMIN_ROLES_KEY, target) as
      AdminRolesOptions | undefined;
    if (options && Array.isArray(options.roles) && options.roles.length > 0) {
      list.push(options);
    }
  }
  return list;
}

const GLOBAL: AdminRouteScope = { kind: 'global' };

/**
 * Works out the policy of one admin handler. Fails closed: anything that
 * cannot be resolved is server-wide (super-admin only), with `problem` set.
 *
 * 1. `@AdminScope('self')` or `@AdminScope('global')` on the handler, else
 *    on the controller, decides.
 * 2. `@AdminRealmParam(...)` names the realm parameter; it must be in every
 *    path the handler serves.
 * 3. Otherwise a `:realmName` or `:realm` parameter (only one of them) in
 *    every path makes the route realm-scoped by realm name.
 * 4. Otherwise the route has no recognisable realm: server-wide, and a
 *    problem unless it was declared `global`.
 */
export function resolveAdminRoutePolicy(
  controller: unknown,
  handler: unknown,
): AdminRoutePolicy {
  const sensitiveRead =
    override<boolean>(ADMIN_SENSITIVE_READ_KEY, handler, controller) === true;
  const requiredRoles = requiredRolesOf(handler, controller);
  const base = { sensitiveRead, requiredRoles };

  const scope = override<AdminScopeKind>(ADMIN_SCOPE_KEY, handler, controller);
  if (scope === 'self') return { ...base, scope: { kind: 'self' } };
  if (scope === 'global') return { ...base, scope: GLOBAL };
  if (scope !== undefined) {
    return {
      ...base,
      scope: GLOBAL,
      problem: `unknown @AdminScope value ${String(scope)}`,
    };
  }

  const paths = fullRoutePaths(controller, handler);
  const paramsPerPath = paths.map((p) => routeParamNames(p));

  const explicit = override<AdminRealmParamOptions>(
    ADMIN_REALM_PARAM_KEY,
    handler,
    controller,
  );
  if (explicit) {
    const everywhere = paramsPerPath.every((names) =>
      names.includes(explicit.param),
    );
    if (!everywhere) {
      return {
        ...base,
        scope: GLOBAL,
        problem: `@AdminRealmParam('${explicit.param}') is not a parameter of ${paths.join(', ')}`,
      };
    }
    return {
      ...base,
      scope: { kind: 'realm', param: explicit.param, lookup: explicit.lookup },
    };
  }

  const found = new Set<string>();
  for (const names of paramsPerPath) {
    const implicit = names.filter((n) =>
      (IMPLICIT_REALM_PARAMS as readonly string[]).includes(n),
    );
    if (implicit.length !== 1) {
      return {
        ...base,
        scope: GLOBAL,
        problem:
          implicit.length === 0
            ? `no realm parameter in ${paths.join(', ')}: mark it @AdminScope('global') or @AdminRealmParam(...)`
            : `more than one realm parameter in ${paths.join(', ')}: use @AdminRealmParam(...)`,
      };
    }
    found.add(implicit[0]);
  }
  if (found.size !== 1) {
    return {
      ...base,
      scope: GLOBAL,
      problem: `paths ${paths.join(', ')} disagree on the realm parameter`,
    };
  }
  const [param] = [...found];
  return { ...base, scope: { kind: 'realm', param, lookup: 'name' } };
}
