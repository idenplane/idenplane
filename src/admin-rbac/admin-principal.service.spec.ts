import { ConfigService } from '@nestjs/config';
import { AdminPrincipalService } from './admin-principal.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';

const MASTER_ID = 'master-id';

function user(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    username: 'sample-admin',
    enabled: true,
    realmId: MASTER_ID,
    userRoles: [
      { role: { name: 'realm-admin', realmId: MASTER_ID, clientId: null } },
      // A client role named like an admin role does not count.
      { role: { name: 'super-admin', realmId: MASTER_ID, clientId: 'c1' } },
      { role: { name: 'offline_access', realmId: MASTER_ID, clientId: null } },
    ],
    adminRealmAssignments: [
      { realmId: 'id-a', realm: { name: 'realm-a' } },
      { realmId: MASTER_ID, realm: { name: 'master' } },
    ],
    userCredentials: [],
    webAuthnCredentials: [],
    ...overrides,
  };
}

describe('AdminPrincipalService', () => {
  let findFirst: jest.Mock;
  let findUnique: jest.Mock;
  let policyFindUnique: jest.Mock;
  let env: Record<string, string | undefined>;
  let service: AdminPrincipalService;

  beforeEach(() => {
    findFirst = jest.fn();
    findUnique = jest.fn();
    policyFindUnique = jest.fn().mockResolvedValue(null);
    env = { ADMIN_API_KEY: 'sample-api-key-placeholder' };
    service = new AdminPrincipalService(
      {
        user: { findFirst },
        realm: { findUnique, findMany: jest.fn() },
        adminSecurityPolicy: { findUnique: policyFindUnique },
      } as unknown as PrismaService,
      { get: (k: string) => env[k] } as unknown as ConfigService,
    );
  });

  it('treats the API key as super-admin while a key is configured', async () => {
    const p = await service.load({ userId: 'api-key:admin', roles: [] });
    expect(p).toMatchObject({ kind: 'api-key', roles: ['super-admin'] });
    env['ADMIN_API_KEY'] = undefined;
    const gone = await service.load({ userId: 'api-key:admin', roles: [] });
    expect(gone.roles).toEqual([]);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('reads current master realm roles, not the token roles', async () => {
    findFirst.mockResolvedValue(user());
    const p = await service.load({ userId: 'u1', roles: ['super-admin'] });
    expect(p.roles).toEqual(['realm-admin']);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1', realm: { name: 'master' } },
      }),
    );
  });

  it('drops the master realm from the scope', async () => {
    findFirst.mockResolvedValue(user());
    const p = await service.load({ userId: 'u1', roles: [] });
    expect([...p.realmIds]).toEqual(['id-a']);
  });

  it('gives a disabled or missing admin no role', async () => {
    findFirst.mockResolvedValue(user({ enabled: false }));
    expect(
      (await service.load({ userId: 'u1', roles: ['super-admin'] })).roles,
    ).toEqual([]);
    findFirst.mockResolvedValue(null);
    expect(
      (await service.load({ userId: 'u1', roles: ['super-admin'] })).roles,
    ).toEqual([]);
  });

  it('resolves a realm by name, or by id first when asked', async () => {
    findUnique.mockImplementation(
      ({ where }: { where: Record<string, string> }) =>
        Promise.resolve(
          where['id'] === 'id-a' || where['name'] === 'realm-a'
            ? { id: 'id-a', name: 'realm-a' }
            : null,
        ),
    );
    expect(await service.resolveRealm('realm-a', 'name')).toEqual({
      id: 'id-a',
      name: 'realm-a',
    });
    expect(await service.resolveRealm('id-a', 'name')).toEqual({
      id: null,
      name: null,
    });
    expect(await service.resolveRealm('id-a', 'id-or-name')).toEqual({
      id: 'id-a',
      name: 'realm-a',
    });
  });

  it('says whether the admin has a console second factor', async () => {
    findFirst.mockResolvedValue(user());
    expect((await service.load({ userId: 'u1', roles: [] })).mfaEnrolled).toBe(
      false,
    );
    findFirst.mockResolvedValue(user({ userCredentials: [{ id: 'c1' }] }));
    expect((await service.load({ userId: 'u1', roles: [] })).mfaEnrolled).toBe(
      true,
    );
    findFirst.mockResolvedValue(user({ webAuthnCredentials: [{ id: 'w1' }] }));
    expect((await service.load({ userId: 'u1', roles: [] })).mfaEnrolled).toBe(
      true,
    );
    // Only a verified TOTP counts, read in the same query.
    expect(findFirst.mock.calls[0][0].select.userCredentials).toEqual({
      where: { type: 'totp', verified: true },
      select: { id: true },
    });
  });

  describe('adminMfaPolicy', () => {
    it('is off without a stored row (an upgraded install)', async () => {
      await expect(service.adminMfaPolicy()).resolves.toEqual({
        required: false,
        source: 'setting',
      });
    });

    it('reads the stored setting', async () => {
      policyFindUnique.mockResolvedValue({ mfaRequired: true });
      await expect(service.adminMfaPolicy()).resolves.toEqual({
        required: true,
        source: 'setting',
      });
    });

    it('lets ADMIN_MFA_REQUIRED fix it either way', async () => {
      policyFindUnique.mockResolvedValue({ mfaRequired: true });
      env['ADMIN_MFA_REQUIRED'] = 'false';
      await expect(service.adminMfaPolicy()).resolves.toEqual({
        required: false,
        source: 'environment',
      });
      policyFindUnique.mockResolvedValue({ mfaRequired: false });
      env['ADMIN_MFA_REQUIRED'] = ' TRUE ';
      await expect(service.adminMfaPolicy()).resolves.toEqual({
        required: true,
        source: 'environment',
      });
      env['ADMIN_MFA_REQUIRED'] = 'maybe';
      await expect(service.adminMfaPolicy()).resolves.toEqual({
        required: false,
        source: 'setting',
      });
    });
  });
});
