import { describe, expect, it } from 'vitest';
import type { AdminMe } from '../../api/adminAccess';
import { permissionsFrom, roleLabel, UNKNOWN_PERMISSIONS } from '../permissions';

function me(overrides: Partial<AdminMe>): AdminMe {
  return {
    userId: 'sample-user',
    username: 'sample',
    kind: 'user',
    roles: [],
    superAdmin: false,
    readAllRealms: false,
    writeAllRealms: false,
    managedRealms: [],
    ...overrides,
  };
}

describe('permissionsFrom', () => {
  it('lets a super-admin do everything', () => {
    const p = permissionsFrom(me({ roles: ['super-admin'], superAdmin: true }));
    expect(p.canManageServer).toBe(true);
    expect(p.canWriteRealm('master')).toBe(true);
    expect(p.canWriteRealm('acme')).toBe(true);
    expect(p.canReadRealm('acme')).toBe(true);
  });

  it('treats the API key as a super-admin', () => {
    const p = permissionsFrom(
      me({ kind: 'api-key', roles: ['super-admin'], superAdmin: true, username: null }),
    );
    expect(p.isApiKey).toBe(true);
    expect(p.canManageServer).toBe(true);
    expect(roleLabel(p)).toBe('API key');
  });

  it('scopes a realm-admin to its realms, never master', () => {
    const p = permissionsFrom(
      me({ roles: ['realm-admin'], managedRealms: ['acme', 'master'] }),
    );
    expect(p.canManageServer).toBe(false);
    expect(p.canWriteRealm('acme')).toBe(true);
    expect(p.canReadRealm('acme')).toBe(true);
    expect(p.canWriteRealm('other')).toBe(false);
    expect(p.canReadRealm('other')).toBe(false);
    expect(p.canWriteRealm('master')).toBe(false);
    expect(p.canWriteRealm(undefined)).toBe(false);
  });

  it('gives an unscoped realm-admin nothing', () => {
    const p = permissionsFrom(me({ roles: ['realm-admin'] }));
    expect(p.canReadRealm('acme')).toBe(false);
    expect(p.canWriteRealm('acme')).toBe(false);
  });

  it('lets view-only read every realm and change none', () => {
    const p = permissionsFrom(me({ roles: ['view-only'], readAllRealms: true }));
    expect(p.canReadRealm('acme')).toBe(true);
    expect(p.canReadRealm('master')).toBe(true);
    expect(p.canWriteRealm('acme')).toBe(false);
    expect(p.canManageServer).toBe(false);
    expect(roleLabel(p)).toBe('view-only');
  });

  it('ignores managed realms without the realm-admin role', () => {
    const p = permissionsFrom(me({ roles: ['view-only'], managedRealms: ['acme'] }));
    expect(p.canWriteRealm('acme')).toBe(false);
  });

  it('combines realm-admin and view-only', () => {
    const p = permissionsFrom(
      me({ roles: ['realm-admin', 'view-only'], managedRealms: ['acme'] }),
    );
    expect(p.canReadRealm('other')).toBe(true);
    expect(p.canWriteRealm('other')).toBe(false);
    expect(p.canWriteRealm('acme')).toBe(true);
    expect(roleLabel(p)).toBe('realm-admin + view-only');
  });

  it('hides nothing before the server has answered', () => {
    expect(UNKNOWN_PERMISSIONS.known).toBe(false);
    expect(UNKNOWN_PERMISSIONS.canManageServer).toBe(true);
    expect(UNKNOWN_PERMISSIONS.canWriteRealm('acme')).toBe(true);
  });
});
