import {
  accessForMethod,
  canReadRealm,
  canWriteRealm,
  decideAdminAccess,
  decideAdminMfa,
  hasRecentAdminMfa,
  RECENT_ADMIN_MFA_SECONDS,
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
  mfaExempt: null,
  recentMfa: false,
};
const globalRoute: AdminRoutePolicy = {
  scope: { kind: 'global' },
  sensitiveRead: false,
  requiredRoles: [],
  mfaExempt: null,
  recentMfa: false,
};
const selfRoute: AdminRoutePolicy = {
  scope: { kind: 'self' },
  sensitiveRead: false,
  requiredRoles: [],
  mfaExempt: null,
  recentMfa: false,
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

describe('decideAdminMfa', () => {
  const now = 1_800_000_000;
  const base = { tokenMfa: false, now, enrolled: false, required: false };
  const route = (
    mfaExempt: 'always' | 'first-factor' | null = null,
    recentMfa = false,
  ) => ({ mfaExempt, recentMfa });

  it('allows everything to an admin without a factor while not required', () => {
    expect(decideAdminMfa(base, route())).toBeNull();
    expect(decideAdminMfa(base, route('first-factor'))).toBeNull();
  });

  it('asks an admin without a factor for one before a sensitive action', () => {
    expect(decideAdminMfa(base, route(null, true))).toBe(
      'admin_recent_mfa_required',
    );
  });

  it('confines to exempt routes while required and not enrolled', () => {
    const ctx = { ...base, required: true };
    expect(decideAdminMfa(ctx, route())).toBe('admin_mfa_enrolment_required');
    expect(decideAdminMfa(ctx, route('always'))).toBeNull();
    expect(decideAdminMfa(ctx, route('first-factor'))).toBeNull();
    expect(
      decideAdminMfa({ ...ctx, tokenMfa: true, authTime: now }, route()),
    ).toBe('admin_mfa_enrolment_required');
  });

  it('sends a password-only token of an enrolled admin to step-up', () => {
    const ctx = { ...base, enrolled: true };
    expect(decideAdminMfa(ctx, route())).toBe('admin_mfa_step_up_required');
    expect(decideAdminMfa(ctx, route('first-factor'))).toBe(
      'admin_mfa_step_up_required',
    );
    expect(decideAdminMfa(ctx, route('always'))).toBeNull();
  });

  it('counts a check as recent for 15 minutes, and not from the future', () => {
    const ctx = { ...base, enrolled: true, tokenMfa: true };
    const at = (authTime: number) =>
      decideAdminMfa({ ...ctx, authTime }, route(null, true));
    expect(at(now - RECENT_ADMIN_MFA_SECONDS)).toBeNull();
    expect(at(now - RECENT_ADMIN_MFA_SECONDS - 1)).toBe(
      'admin_recent_mfa_required',
    );
    expect(at(now + 3600)).toBe('admin_recent_mfa_required');
    expect(
      decideAdminMfa({ ...ctx, authTime: undefined }, route(null, true)),
    ).toBe('admin_recent_mfa_required');
  });

  it('asks an enrolled admin for a recent check before adding a factor', () => {
    const ctx = { ...base, enrolled: true, tokenMfa: true };
    expect(
      decideAdminMfa({ ...ctx, authTime: now - 3000 }, route('first-factor')),
    ).toBe('admin_recent_mfa_required');
    expect(
      decideAdminMfa({ ...ctx, authTime: now - 10 }, route('first-factor')),
    ).toBeNull();
  });
});

describe('hasRecentAdminMfa', () => {
  const now = 1_800_000_000;
  it('is true only for a recent MFA token of an admin user', () => {
    const mfa = 'urn:idenplane:acr:mfa';
    expect(
      hasRecentAdminMfa({ userId: 'u', acr: mfa, authTime: now - 60 }, now),
    ).toBe(true);
    expect(
      hasRecentAdminMfa({ userId: 'u', acr: mfa, authTime: now - 3600 }, now),
    ).toBe(false);
    expect(
      hasRecentAdminMfa(
        { userId: 'u', acr: 'urn:idenplane:acr:password', authTime: now },
        now,
      ),
    ).toBe(false);
    expect(
      hasRecentAdminMfa(
        { userId: 'api-key:admin', acr: mfa, authTime: now },
        now,
      ),
    ).toBe(false);
    expect(hasRecentAdminMfa(undefined, now)).toBe(false);
  });
});
