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
