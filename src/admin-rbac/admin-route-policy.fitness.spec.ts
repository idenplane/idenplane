import { writeFileSync } from 'node:fs';
import type { Type } from '@nestjs/common';
import { AppModule } from '../app.module.js';
import {
  adminRoutesOf,
  walkModules,
  type AdminRouteEntry,
} from './admin-route-inventory.js';
import { accessMatrix, accessMatrixMarkdown } from './admin-access-matrix.js';

/*
 * Fitness test: every admin route the application mounts has an
 * authorization policy that can be worked out from its metadata. A route
 * with no recognisable realm parameter that is not declared
 * @AdminScope('global') fails here (at runtime it would be super-admin only).
 *
 * Set ADMIN_RBAC_MATRIX_OUT=<file> to write the access matrix as Markdown.
 */

/** Routes any admin may call. Adding one needs a deliberate review. */
const SELF_ROUTES = [
  'GET /admin/auth/me',
  'GET /admin/realms',
  'GET /admin/realms/themes',
  // The signed-in admin's own console MFA (docs/docs/security/admin-mfa.md).
  'GET /admin/auth/mfa',
  'POST /admin/auth/mfa/totp',
  'POST /admin/auth/mfa/totp/activate',
  'DELETE /admin/auth/mfa/totp',
  'POST /admin/auth/mfa/passkeys/options',
  'POST /admin/auth/mfa/passkeys',
  'DELETE /admin/auth/mfa/passkeys/:id',
  'POST /admin/auth/mfa/recovery-codes',
  'POST /admin/auth/step-up',
  'POST /admin/auth/step-up/passkey/options',
  'POST /admin/auth/step-up/passkey',
];

/**
 * Routes a password-only admin token still reaches when the admin has a
 * factor or MFA is required. Everything else is refused until the admin
 * enrols or steps up. Adding one needs a deliberate review.
 */
const MFA_EXEMPT_ROUTES = {
  always: [
    'GET /admin/auth/me',
    'GET /admin/auth/mfa',
    'POST /admin/auth/step-up',
    'POST /admin/auth/step-up/passkey/options',
    'POST /admin/auth/step-up/passkey',
  ],
  'first-factor': [
    'POST /admin/auth/mfa/totp',
    'POST /admin/auth/mfa/totp/activate',
    'POST /admin/auth/mfa/passkeys/options',
    'POST /admin/auth/mfa/passkeys',
  ],
};

/** Routes that need a second factor checked in the last 15 minutes. */
const RECENT_MFA_ROUTES = [
  'DELETE /admin/auth/mfa/totp',
  'DELETE /admin/auth/mfa/passkeys/:id',
  'POST /admin/auth/mfa/recovery-codes',
  'DELETE /admin/admin-accounts/:userId/mfa',
];

const key = (e: AdminRouteEntry) => `${e.method} ${e.paths.join(', ')}`;

describe('admin route authorization (fitness)', () => {
  let modules: Set<unknown>;
  let controllers: Type<unknown>[];
  let routes: AdminRouteEntry[];

  beforeAll(async () => {
    ({ modules, controllers } = await walkModules(AppModule));
    routes = adminRoutesOf(controllers);
  }, 120_000);

  it('finds the admin API', () => {
    expect(controllers.length).toBeGreaterThan(40);
    expect(routes.length).toBeGreaterThan(300);
  });

  it('resolves a policy for every admin route', () => {
    const problems = routes
      .filter((r) => r.policy.problem)
      .map(
        (r) => `${key(r)} (${r.controller}.${r.handler}): ${r.policy.problem}`,
      );
    expect(problems).toEqual([]);
  });

  it('keeps own-account routes to the reviewed list', () => {
    const self = routes
      .filter((r) => r.policy.scope.kind === 'self')
      .map(key)
      .sort();
    expect(self).toEqual([...SELF_ROUTES].sort());
  });

  it('keeps the routes a password-only token reaches to the reviewed list', () => {
    for (const kind of ['always', 'first-factor'] as const) {
      const exempt = routes
        .filter((r) => r.policy.mfaExempt === kind)
        .map(key)
        .sort();
      expect([kind, exempt]).toEqual([
        kind,
        [...MFA_EXEMPT_ROUTES[kind]].sort(),
      ]);
    }
  });

  it('asks for a recent MFA check on the reviewed sensitive routes', () => {
    const recent = routes
      .filter((r) => r.policy.recentMfa)
      .map(key)
      .sort();
    expect(recent).toEqual([...RECENT_MFA_ROUTES].sort());
  });

  it('treats server-wide routes as server-wide', () => {
    const scopeOf = (method: string, path: string) =>
      routes.find((r) => r.method === method && r.paths.includes(path))?.policy
        .scope.kind;
    for (const [method, path] of [
      ['POST', '/admin/realms'],
      ['POST', '/admin/realms/import'],
      ['DELETE', '/admin/realms/:realmName'],
      ['GET', '/admin/realms/:realmName/export'],
      ['GET', '/admin/plugins'],
      ['GET', '/admin/plugins/:name'],
      ['POST', '/admin/upgrade'],
      ['GET', '/admin/system/version'],
      ['GET', '/admin/metrics'],
      ['POST', '/admin/migration/keycloak'],
      ['GET', '/setup-wizard/state'],
      ['PUT', '/admin/admin-accounts/:userId/realms'],
      ['DELETE', '/admin/admin-accounts/:userId/mfa'],
      ['GET', '/admin/admin-mfa/policy'],
      ['PUT', '/admin/admin-mfa/policy'],
    ]) {
      expect([method, path, scopeOf(method, path)]).toEqual([
        method,
        path,
        'global',
      ]);
    }
  });

  it('never reads a plugin name as a realm', () => {
    for (const r of routes.filter((e) =>
      e.paths[0].startsWith('/admin/plugins'),
    )) {
      expect(r.policy.scope.kind).toBe('global');
    }
  });

  it('scopes realm routes by their realm parameter', () => {
    const flows = routes.filter((r) =>
      r.paths[0].startsWith('/admin/realms/:realm/auth-flows'),
    );
    expect(flows.length).toBeGreaterThan(0);
    for (const r of flows) {
      expect(r.policy.scope).toEqual({
        kind: 'realm',
        param: 'realm',
        lookup: 'id-or-name',
      });
    }
    const approve = routes.find(
      (r) => r.paths[0] === '/realms/:realmName/registration/approve/:userId',
    );
    expect(approve?.policy.scope).toEqual({
      kind: 'realm',
      param: 'realmName',
      lookup: 'name',
    });
  });

  it('writes the access matrix when asked', () => {
    const out = process.env['ADMIN_RBAC_MATRIX_OUT'];
    const markdown = accessMatrixMarkdown(accessMatrix(routes));
    if (out) writeFileSync(out, `${markdown}\n`);
    expect(markdown.split('\n').length).toBe(routes.length + 2);
  });
});
