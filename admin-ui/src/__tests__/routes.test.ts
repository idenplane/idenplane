/**
 * routes.test.ts
 *
 * Guard that every navigation item declared in Layout.tsx has a corresponding
 * route registered in App.tsx.  Both sides are read from source at test-run
 * time so the test stays honest: it catches the real failure (someone adds a
 * nav item without wiring up the route) rather than just checking an internal
 * copy against itself.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const layoutSrc = readFileSync(
  path.resolve(__dirname, '../components/Layout.tsx'),
  'utf-8',
);
const appSrc = readFileSync(path.resolve(__dirname, '../App.tsx'), 'utf-8');

/**
 * Routes registered in App.tsx — extracted from `path="..."` JSX attributes.
 * Catch-all `*` entries are excluded because they don't represent real pages.
 */
const APP_ROUTES = new Set<string>(
  [...appSrc.matchAll(/path="([^"]+)"/g)]
    .map(([, p]) => p)
    .filter((p) => p !== '*'),
);

/**
 * Nav `to:` values from Layout.tsx — covers both the realm-scoped `navItems`
 * (template literals) and the top-level `globalNav` (string literals).
 * Template expressions like `${currentRealm}` are normalised to the React
 * Router param placeholder `:name` so they match the registered route shape.
 */
const NAV_PATHS: string[] = [
  // Template literals:  to: `/console/realms/${currentRealm}/users`
  ...[...layoutSrc.matchAll(/\bto:\s*`(\/[^`]+)`/g)].map(([, p]) =>
    p.replace(/\$\{[^}]+\}/g, ':name'),
  ),
  // String literals:  to: '/console'
  ...[...layoutSrc.matchAll(/\bto:\s*'(\/[^']+)'/g)].map(([, p]) => p),
];

/**
 * Routes that legitimately have no direct sidebar nav entry.
 * Add here when a route is intentionally reachable without appearing in the nav.
 */
const ROUTE_NAV_WHITELIST = new Set([
  '/console/login',
  '/setup',
  '/console/realms/:name',         // realm overview — clicked from the realm list
  '/console/realms/:name/nhi-analytics', // NHI analytics — linked from NHI list page
]);

describe('nav route coverage', () => {
  it('extracts at least one app route from App.tsx', () => {
    expect(APP_ROUTES.size).toBeGreaterThan(0);
  });

  it('extracts at least one nav path from Layout.tsx', () => {
    expect(NAV_PATHS.length).toBeGreaterThan(0);
  });

  it('every nav item has a corresponding registered route', () => {
    const orphaned = NAV_PATHS.filter((p) => !APP_ROUTES.has(p));
    expect(
      orphaned,
      `Orphaned nav items (no matching route in App.tsx):\n  ${orphaned.join('\n  ')}`,
    ).toHaveLength(0);
  });

  it('every navigable route has a nav entry or is whitelisted', () => {
    const routesNeedingNav = [...APP_ROUTES].filter((route) => {
      // Explicit whitelist (standalone / non-nav pages)
      if (ROUTE_NAV_WHITELIST.has(route)) return false;
      // Detail pages with two or more dynamic segments — reached via list-row clicks
      if ((route.match(/:/g) ?? []).length >= 2) return false;
      // Creation / new-item pages — reached via "Add" / "Create" buttons, not nav
      if (/\/(create|new)$/.test(route)) return false;
      return true;
    });

    const noNav = routesNeedingNav.filter((route) => !NAV_PATHS.includes(route));
    expect(
      noNav,
      `Routes with no nav entry (add to ROUTE_NAV_WHITELIST if intentional):\n  ${noNav.join('\n  ')}`,
    ).toHaveLength(0);
  });
});

/**
 * Route-param ↔ useParams consistency guard.
 *
 * Catches the silent failure where a route declares one param name but its page
 * component reads a different one (e.g. route `:webhookId`, component
 * `useParams<{ id }>()`). React Router hands back `undefined` for the missing
 * key, the page's data query is disabled, and the user sees a permanent
 * "not found" — with no error, no failed request, and nothing the nav-coverage
 * test above would catch. (idenplane#1141)
 *
 * Invariant enforced: every param a component reads via `useParams<{...}>()`
 * must be declared as `:param` in every route that renders that component.
 */

// Map of imported component name → resolved source path (default imports only).
const COMPONENT_IMPORTS = new Map<string, string>(
  [...appSrc.matchAll(/import\s+(\w+)\s+from\s+'(\.\/[^']+)'/g)].map(
    ([, comp, rel]) => [comp, path.resolve(__dirname, '..', rel + '.tsx')],
  ),
);

// Every <Route path="..." element={<Component ... />} /> pairing.
const ROUTE_ELEMENTS = [
  ...appSrc.matchAll(
    /<Route\s+path="([^"]+)"\s+element=\{<(\w+)\s*\/?>\s*\}/g,
  ),
].map(([, routePath, comp]) => ({ routePath, comp }));

/** Param names declared in a route path, e.g. `/x/:name/y/:webhookId` → [name, webhookId]. */
function declaredParams(routePath: string): string[] {
  return [...routePath.matchAll(/:(\w+)/g)].map(([, p]) => p);
}

/** Param keys a component expects, read from its `useParams<{...}>()` generic. */
function readParamKeys(source: string): string[] {
  const keys = new Set<string>();
  for (const [, body] of source.matchAll(/useParams<\{([^}]*)\}>/g)) {
    for (const [, key] of body.matchAll(/(\w+)\s*\??\s*:/g)) keys.add(key);
  }
  return [...keys];
}

describe('route param consistency', () => {
  it('finds routes wired to imported page components', () => {
    const wired = ROUTE_ELEMENTS.filter((r) => COMPONENT_IMPORTS.has(r.comp));
    expect(wired.length).toBeGreaterThan(0);
  });

  it('every param a page reads is declared in its route path', () => {
    const violations: string[] = [];

    for (const { comp } of ROUTE_ELEMENTS) {
      const file = COMPONENT_IMPORTS.get(comp);
      if (!file) continue; // inline/wrapped element, not a default-imported page

      let source: string;
      try {
        source = readFileSync(file, 'utf-8');
      } catch {
        continue; // component resolved to a non-.tsx path; skip
      }

      const expected = readParamKeys(source);
      if (expected.length === 0) continue; // page reads no route params

      // Union of params across every route that renders this component.
      const provided = new Set(
        ROUTE_ELEMENTS.filter((r) => r.comp === comp).flatMap((r) =>
          declaredParams(r.routePath),
        ),
      );

      for (const key of expected) {
        if (!provided.has(key)) {
          violations.push(
            `${comp} reads useParams key '${key}', but no route rendering it declares ':${key}' ` +
              `(declared: ${[...provided].map((p) => ':' + p).join(', ') || 'none'})`,
          );
        }
      }
    }

    expect(
      violations,
      `Route param mismatches (page reads a param its route never provides):\n  ${violations.join('\n  ')}`,
    ).toHaveLength(0);
  });
});
