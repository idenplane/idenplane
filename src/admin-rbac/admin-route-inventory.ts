import { Reflector } from '@nestjs/core';
import { RequestMethod, type Type } from '@nestjs/common';
import {
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator.js';
import { adminAuthenticationRequired } from '../common/guards/admin-api-key.guard.js';
import {
  fullRoutePaths,
  resolveAdminRoutePolicy,
  type AdminRoutePolicy,
} from './admin-route-policy.js';

/**
 * Every admin route of a module tree, found from Nest metadata without
 * booting the application (no database, no providers). Used by the fitness
 * test and to generate the access matrix in the docs.
 */
export interface AdminRouteEntry {
  controller: string;
  handler: string;
  method: string;
  paths: string[];
  policy: AdminRoutePolicy;
}

interface DynamicModuleLike {
  module: Type<unknown>;
  imports?: unknown[];
  controllers?: unknown[];
}

function isDynamic(value: unknown): value is DynamicModuleLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    'module' in value &&
    typeof value.module === 'function'
  );
}

function listMetadata(key: string, target: unknown): unknown[] {
  if (typeof target !== 'function') return [];
  return (Reflect.getMetadata(key, target) as unknown[] | undefined) ?? [];
}

/**
 * Walks a module tree through `imports` (static and dynamic modules,
 * awaiting async ones) and returns every module class it reaches and every
 * controller those modules declare.
 */
export async function walkModules(root: unknown): Promise<{
  modules: Set<unknown>;
  controllers: Type<unknown>[];
}> {
  const modules = new Set<unknown>();
  const visited = new Set<unknown>();
  const controllers = new Set<Type<unknown>>();

  const visit = async (entry: unknown): Promise<void> => {
    const resolved: unknown = await entry;
    if (!resolved || visited.has(resolved)) return;
    visited.add(resolved);
    const moduleClass = isDynamic(resolved) ? resolved.module : resolved;
    modules.add(moduleClass);
    const declared = [
      ...listMetadata(MODULE_METADATA.CONTROLLERS, moduleClass),
      ...(isDynamic(resolved) ? (resolved.controllers ?? []) : []),
    ];
    for (const c of declared) {
      if (typeof c === 'function') controllers.add(c as Type<unknown>);
    }
    const children = [
      ...listMetadata(MODULE_METADATA.IMPORTS, moduleClass),
      ...(isDynamic(resolved) ? (resolved.imports ?? []) : []),
    ];
    for (const child of children) await visit(child);
  };

  await visit(root);
  return { modules, controllers: [...controllers] };
}

function handlersOf(controller: Type<unknown>) {
  const out: { name: string; fn: object; method: RequestMethod }[] = [];
  const names = new Set<string>();
  let proto = controller.prototype as object | null;
  while (proto && proto !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === 'constructor' || names.has(name)) continue;
      const fn: unknown = Object.getOwnPropertyDescriptor(proto, name)?.value;
      if (typeof fn !== 'function') continue;
      const method = Reflect.getMetadata(METHOD_METADATA, fn) as
        RequestMethod | undefined;
      if (method === undefined || !Reflect.hasMetadata(PATH_METADATA, fn)) {
        continue;
      }
      names.add(name);
      out.push({ name, fn: fn, method });
    }
    proto = Object.getPrototypeOf(proto) as object | null;
  }
  return out;
}

/** Every route that admin authentication (and so authorization) covers. */
export function adminRoutesOf(controllers: Type<unknown>[]): AdminRouteEntry[] {
  const reflector = new Reflector();
  const entries: AdminRouteEntry[] = [];
  for (const controller of controllers) {
    for (const { name, fn, method } of handlersOf(controller)) {
      const isPublic = reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        fn as never,
        controller,
      ]);
      if (isPublic) continue;
      const paths = fullRoutePaths(controller, fn);
      const admin = paths.some((p) =>
        adminAuthenticationRequired(fn, controller, p, reflector),
      );
      if (!admin) continue;
      entries.push({
        controller: controller.name,
        handler: name,
        method: RequestMethod[method],
        paths,
        policy: resolveAdminRoutePolicy(controller, fn),
      });
    }
  }
  return entries.sort(
    (a, b) =>
      a.paths[0].localeCompare(b.paths[0]) || a.method.localeCompare(b.method),
  );
}
