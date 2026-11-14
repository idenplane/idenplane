import {
  accessForMethod,
  canReadRealm,
  canWriteRealm,
  decideAdminAccess,
  type AdminPrincipal,
  type AdminRole,
} from './admin-access-policy.js';
import type { AdminRoutePolicy } from './admin-route-policy.js';

const REALM_A = { id: 'id-a', name: 'realm-a' };
const REALM_B = { id: 'id-b', name: 'realm-b' };
const MASTER = { id: 'id-master', name: 'master' };
const UNKNOWN = { id: null, name: null };

function admin(roles: AdminRole[], realmIds: string[] = []): AdminPrincipal {
  return {
    kind: 'user',
    userId: 'sample-admin',
    username: 'sample-admin',
    roles,
    realmIds: new Set(realmIds),
  };
}

const superAdmin = admin(['super-admin']);
const realmAdminA = admin(['realm-admin'], [REALM_A.id]);
const unscopedRealmAdmin = admin(['realm-admin']);
const viewer = admin(['view-only']);
const realmAdminAndViewer = admin(['realm-admin', 'view-only'], [REALM_A.id]);
const masterScoped = admin(['realm-admin'], [MASTER.id]);
const noRole = admin([]);

const realmRoute: AdminRoutePolicy = {
  scope: { kind: 'realm', param: 'realmName', lookup: 'name' },
  sensitiveRead: false,
  requiredRoles: [],
};
const globalRoute: AdminRoutePolicy = {
  scope: { kind: 'global' },
  sensitiveRead: false,
  requiredRoles: [],
};
const selfRoute: AdminRoutePolicy = {
  scope: { kind: 'self' },
  sensitiveRead: false,
  requiredRoles: [],
};

const allowed = (
  p: AdminPrincipal,
  policy: AdminRoutePolicy,
  method: string,
  realm: { id: string | null; name: string | null } | null = REALM_A,
) =>
  decideAdminAccess(p, policy, accessForMethod(method, policy), realm).allowed;

describe('admin access policy', () => {
  describe('accessForMethod', () => {
    it.each(['GET', 'HEAD', 'OPTIONS', 'get'])('%s reads', (m) => {
      expect(accessForMethod(m, { sensitiveRead: false })).toBe('read');
    });
    it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'ALL', 'PROPFIND'])(
      '%s changes',
      (m) => {
        expect(accessForMethod(m, { sensitiveRead: false })).toBe('write');
      },
    );
    it('a secret-revealing GET needs change rights', () => {
      expect(accessForMethod('GET', { sensitiveRead: true })).toBe('write');
    });
  });

  describe('realm-scoped routes', () => {
    it.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])(
      'super-admin: %s in any realm, master included',
      (m) => {
        for (const realm of [REALM_A, REALM_B, MASTER, UNKNOWN]) {
          expect(allowed(superAdmin, realmRoute, m, realm)).toBe(true);
        }
      },
    );

    it('realm-admin reads and changes its realm only', () => {
      for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
        expect(allowed(realmAdminA, realmRoute, m, REALM_A)).toBe(true);
        expect(allowed(realmAdminA, realmRoute, m, REALM_B)).toBe(false);
        expect(allowed(realmAdminA, realmRoute, m, MASTER)).toBe(false);
        expect(allowed(realmAdminA, realmRoute, m, UNKNOWN)).toBe(false);
      }
    });

    it('an unscoped realm-admin manages no realm', () => {
      for (const m of ['GET', 'POST', 'DELETE']) {
        expect(allowed(unscopedRealmAdmin, realmRoute, m, REALM_A)).toBe(false);
      }
    });

    it('the master realm is never in a realm-admin scope', () => {
      expect(allowed(masterScoped, realmRoute, 'GET', MASTER)).toBe(false);
      expect(allowed(masterScoped, realmRoute, 'POST', MASTER)).toBe(false);
    });

    it('view-only reads every existing realm and changes none', () => {
      for (const realm of [REALM_A, REALM_B, MASTER]) {
        expect(allowed(viewer, realmRoute, 'GET', realm)).toBe(true);
        expect(allowed(viewer, realmRoute, 'HEAD', realm)).toBe(true);
        for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
          expect(allowed(viewer, realmRoute, m, realm)).toBe(false);
        }
      }
      expect(allowed(viewer, realmRoute, 'GET', UNKNOWN)).toBe(false);
    });

    it('view-only cannot make a secret-revealing read', () => {
      const secret = { ...realmRoute, sensitiveRead: true };
      expect(allowed(viewer, secret, 'GET', REALM_A)).toBe(false);
      expect(allowed(realmAdminA, secret, 'GET', REALM_A)).toBe(true);
      expect(allowed(realmAdminA, secret, 'GET', REALM_B)).toBe(false);
    });

    it('realm-admin plus view-only: reads all, changes its own', () => {
      expect(allowed(realmAdminAndViewer, realmRoute, 'GET', REALM_B)).toBe(
        true,
      );
      expect(allowed(realmAdminAndViewer, realmRoute, 'POST', REALM_B)).toBe(
        false,
      );
      expect(allowed(realmAdminAndViewer, realmRoute, 'POST', REALM_A)).toBe(
        true,
      );
    });

    it('refuses when the realm could not be resolved', () => {
      expect(allowed(realmAdminA, realmRoute, 'GET', null)).toBe(false);
      expect(allowed(viewer, realmRoute, 'GET', null)).toBe(false);
    });
  });

  describe('server-wide routes', () => {
    it('are for super-admin only, reads included', () => {
      for (const m of ['GET', 'POST', 'DELETE']) {
        expect(allowed(superAdmin, globalRoute, m, null)).toBe(true);
        expect(allowed(realmAdminA, globalRoute, m, null)).toBe(false);
        expect(allowed(viewer, globalRoute, m, null)).toBe(false);
      }
    });
    it('ignore a realm parameter (a realm-admin of that realm is refused)', () => {
      expect(allowed(realmAdminA, globalRoute, 'GET', REALM_A)).toBe(false);
    });
  });

  describe('own-account routes', () => {
    it('are open to every admin role', () => {
      for (const p of [superAdmin, realmAdminA, unscopedRealmAdmin, viewer]) {
        expect(allowed(p, selfRoute, 'GET', null)).toBe(true);
      }
    });
    it('are closed to an account without an admin role', () => {
      expect(allowed(noRole, selfRoute, 'GET', null)).toBe(false);
    });
  });

  describe('@RequireAdminRoles', () => {
    const strict: AdminRoutePolicy = {
      ...realmRoute,
      requiredRoles: [{ roles: ['super-admin'] }],
    };
    it('only makes access stricter', () => {
      expect(allowed(realmAdminA, strict, 'DELETE', REALM_A)).toBe(false);
      expect(allowed(viewer, strict, 'GET', REALM_A)).toBe(false);
      expect(allowed(superAdmin, strict, 'DELETE', REALM_A)).toBe(true);
    });
    it('cannot widen a server-wide route', () => {
      const loose: AdminRoutePolicy = {
        ...globalRoute,
        requiredRoles: [{ roles: ['view-only'] }],
      };
      expect(allowed(viewer, loose, 'GET', null)).toBe(false);
    });
    it('checks every listed requirement, requireAll included', () => {
      const both: AdminRoutePolicy = {
        ...realmRoute,
        requiredRoles: [
          { roles: ['realm-admin', 'view-only'], requireAll: true },
        ],
      };
      expect(allowed(realmAdminA, both, 'GET', REALM_A)).toBe(false);
      expect(allowed(realmAdminAndViewer, both, 'GET', REALM_A)).toBe(true);
    });
  });

  describe('canReadRealm / canWriteRealm', () => {
    it('match the route decisions', () => {
      expect(canReadRealm(realmAdminA, REALM_A)).toBe(true);
      expect(canReadRealm(realmAdminA, REALM_B)).toBe(false);
      expect(canWriteRealm(viewer, REALM_A)).toBe(false);
      expect(canReadRealm(viewer, MASTER)).toBe(true);
      expect(canWriteRealm(masterScoped, MASTER)).toBe(false);
    });
  });
});
