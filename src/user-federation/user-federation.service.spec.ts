import { NotFoundException, ConflictException } from '@nestjs/common';

jest.mock('./ldap.client.js', () => ({
  LdapClientWrapper: jest.fn().mockImplementation(() => ({
    testConnection: jest.fn(),
    authenticate: jest.fn(),
    searchUser: jest.fn(),
    searchAllUsers: jest.fn(),
  })),
}));

import { UserFederationService } from './user-federation.service.js';
import {
  createMockPrismaService,
  MockPrismaService,
} from '../prisma/prisma.mock.js';
import { LdapClientWrapper } from './ldap.client.js';

const MockLdapClientWrapper = LdapClientWrapper as jest.MockedClass<
  typeof LdapClientWrapper
>;

describe('UserFederationService', () => {
  let service: UserFederationService;
  let prisma: MockPrismaService;

  const mockRealm = { id: 'realm-1', name: 'test-realm' };

  const mockFederation = {
    id: 'fed-1',
    realmId: 'realm-1',
    name: 'my-ldap',
    providerType: 'ldap',
    enabled: true,
    priority: 0,
    connectionUrl: 'ldap://localhost:389',
    bindDn: 'cn=admin,dc=example,dc=com',
    bindCredential: 'secret',
    startTls: false,
    connectionTimeout: 5000,
    usersDn: 'ou=users,dc=example,dc=com',
    userObjectClass: 'inetOrgPerson',
    usernameLdapAttr: 'uid',
    rdnLdapAttr: 'uid',
    uuidLdapAttr: 'entryUUID',
    searchFilter: null,
    syncMode: 'on_demand',
    syncPeriod: 3600,
    importEnabled: true,
    editMode: 'READ_ONLY',
    realm: { id: 'realm-1', name: 'test-realm' },
    mappers: [],
  };

  beforeEach(() => {
    prisma = createMockPrismaService();
    service = new UserFederationService(prisma as any);
    MockLdapClientWrapper.mockClear();
  });

  // ── create ───────────────────────────────────────────────────────────

  describe('create', () => {
    const minimalDto = {
      name: 'my-ldap',
      connectionUrl: 'ldap://localhost:389',
      bindDn: 'cn=admin,dc=example,dc=com',
      bindCredential: 'secret',
      usersDn: 'ou=users,dc=example,dc=com',
    };

    it('should create a federation with defaults', async () => {
      prisma.realm.findUnique.mockResolvedValue(mockRealm);
      prisma.userFederation.findUnique.mockResolvedValue(null);
      prisma.userFederation.create.mockResolvedValue(mockFederation);

      const result = await service.create('test-realm', minimalDto);

      expect(prisma.realm.findUnique).toHaveBeenCalledWith({
        where: { name: 'test-realm' },
      });
      expect(prisma.userFederation.findUnique).toHaveBeenCalledWith({
        where: { realmId_name: { realmId: 'realm-1', name: 'my-ldap' } },
      });
      expect(prisma.userFederation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          realmId: 'realm-1',
          name: 'my-ldap',
          providerType: 'ldap',
          enabled: true,
          priority: 0,
          startTls: false,
          connectionTimeout: 5000,
          userObjectClass: 'inetOrgPerson',
          usernameLdapAttr: 'uid',
          rdnLdapAttr: 'uid',
          uuidLdapAttr: 'entryUUID',
          searchFilter: null,
          syncMode: 'on_demand',
          syncPeriod: 3600,
          importEnabled: true,
          editMode: 'READ_ONLY',
        }),
      });
      expect(result).toEqual(mockFederation);
    });

    it('should create a federation with all fields provided', async () => {
      const fullDto = {
        ...minimalDto,
        providerType: 'ad',
        enabled: false,
        priority: 5,
        startTls: true,
        connectionTimeout: 10000,
        userObjectClass: 'person',
        usernameLdapAttr: 'sAMAccountName',
        rdnLdapAttr: 'cn',
        uuidLdapAttr: 'objectGUID',
        searchFilter: '(memberOf=cn=users)',
        syncMode: 'full',
        syncPeriod: 7200,
        importEnabled: false,
        editMode: 'WRITABLE',
      };

      prisma.realm.findUnique.mockResolvedValue(mockRealm);
      prisma.userFederation.findUnique.mockResolvedValue(null);
      prisma.userFederation.create.mockResolvedValue({
        ...mockFederation,
        ...fullDto,
      });

      await service.create('test-realm', fullDto);

      expect(prisma.userFederation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          providerType: 'ad',
          enabled: false,
          priority: 5,
          startTls: true,
          connectionTimeout: 10000,
          userObjectClass: 'person',
          usernameLdapAttr: 'sAMAccountName',
          rdnLdapAttr: 'cn',
          uuidLdapAttr: 'objectGUID',
          searchFilter: '(memberOf=cn=users)',
          syncMode: 'full',
          syncPeriod: 7200,
          importEnabled: false,
          editMode: 'WRITABLE',
        }),
      });
    });

    it('should throw NotFoundException when realm does not exist', async () => {
      prisma.realm.findUnique.mockResolvedValue(null);

      await expect(service.create('unknown', minimalDto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ConflictException when federation name already exists', async () => {
      prisma.realm.findUnique.mockResolvedValue(mockRealm);
      prisma.userFederation.findUnique.mockResolvedValue(mockFederation);

      await expect(service.create('test-realm', minimalDto)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // ── findAll ──────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('should return all federations ordered by priority', async () => {
      prisma.realm.findUnique.mockResolvedValue(mockRealm);
      prisma.userFederation.findMany.mockResolvedValue([mockFederation]);

      const result = await service.findAll('test-realm');

      expect(prisma.userFederation.findMany).toHaveBeenCalledWith({
        where: { realmId: 'realm-1' },
        orderBy: { priority: 'asc' },
      });
      expect(result).toEqual([mockFederation]);
    });

    it('should throw NotFoundException when realm does not exist', async () => {
      prisma.realm.findUnique.mockResolvedValue(null);

      await expect(service.findAll('unknown')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── findById ─────────────────────────────────────────────────────────

  describe('findById', () => {
    it('should return the federation when found and realm matches', async () => {
      prisma.userFederation.findUnique.mockResolvedValue(mockFederation);

      const result = await service.findById('test-realm', 'fed-1');

      expect(prisma.userFederation.findUnique).toHaveBeenCalledWith({
        where: { id: 'fed-1' },
        include: { realm: true, mappers: true },
      });
      expect(result).toEqual(mockFederation);
    });

    it('should throw NotFoundException when federation does not exist', async () => {
      prisma.userFederation.findUnique.mockResolvedValue(null);

      await expect(service.findById('test-realm', 'fed-x')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException when realm name does not match', async () => {
      prisma.userFederation.findUnique.mockResolvedValue(mockFederation);

      await expect(service.findById('other-realm', 'fed-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── update ───────────────────────────────────────────────────────────

  describe('update', () => {
    it('should update a federation', async () => {
      prisma.userFederation.findUnique.mockResolvedValue(mockFederation);
      const updated = { ...mockFederation, priority: 10 };
      prisma.userFederation.update.mockResolvedValue(updated);

      const result = await service.update('test-realm', 'fed-1', {
        priority: 10,
      });

      expect(prisma.userFederation.update).toHaveBeenCalledWith({
        where: { id: 'fed-1' },
        data: expect.objectContaining({ priority: 10 }),
      });
      expect(result).toEqual(updated);
    });

    it('should throw NotFoundException when federation not found', async () => {
      prisma.userFederation.findUnique.mockResolvedValue(null);

      await expect(
        service.update('test-realm', 'fed-x', { priority: 10 }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── remove ───────────────────────────────────────────────────────────

  describe('remove', () => {
    it('should delete the federation', async () => {
      prisma.userFederation.findUnique.mockResolvedValue(mockFederation);
      prisma.userFederation.delete.mockResolvedValue(mockFederation);

      const result = await service.remove('test-realm', 'fed-1');

      expect(prisma.userFederation.delete).toHaveBeenCalledWith({
        where: { id: 'fed-1' },
      });
      expect(result).toEqual(mockFederation);
    });

    it('should throw NotFoundException when federation not found', async () => {
      prisma.userFederation.findUnique.mockResolvedValue(null);

      await expect(service.remove('test-realm', 'fed-x')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── testConnection ───────────────────────────────────────────────────

  describe('testConnection', () => {
    it('should return success when LDAP connection succeeds', async () => {
      prisma.userFederation.findUnique.mockResolvedValue(mockFederation);

      const ldapInstance = MockLdapClientWrapper.mock.results[0]?.value ?? {
        testConnection: jest.fn(),
      };
      // After findById resolves, createLdapClient will instantiate a new mock.
      // We pre-configure what the next instance will return.
      const mockTestConn = jest.fn().mockResolvedValue({ success: true });
      MockLdapClientWrapper.mockImplementationOnce(() => ({
        testConnection: mockTestConn,
        authenticate: jest.fn(),
        searchUser: jest.fn(),
        searchAllUsers: jest.fn(),
      }));

      const result = await service.testConnection('test-realm', 'fed-1');

      expect(MockLdapClientWrapper).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionUrl: 'ldap://localhost:389',
          bindDn: 'cn=admin,dc=example,dc=com',
          bindCredential: 'secret',
        }),
        expect.objectContaining({
          usersDn: 'ou=users,dc=example,dc=com',
        }),
      );
      expect(result).toEqual({ success: true });
    });

    it('should return failure when LDAP connection fails', async () => {
      prisma.userFederation.findUnique.mockResolvedValue(mockFederation);

      const mockTestConn = jest
        .fn()
        .mockResolvedValue({ success: false, error: 'Connection refused' });
      MockLdapClientWrapper.mockImplementationOnce(() => ({
        testConnection: mockTestConn,
        authenticate: jest.fn(),
        searchUser: jest.fn(),
        searchAllUsers: jest.fn(),
      }));

      const result = await service.testConnection('test-realm', 'fed-1');

      expect(result).toEqual({ success: false, error: 'Connection refused' });
    });
  });

  // ── syncUsers ────────────────────────────────────────────────────────

  describe('syncUsers', () => {
    it('should return early when import is disabled', async () => {
      const disabledFed = { ...mockFederation, importEnabled: false };
      prisma.userFederation.findUnique.mockResolvedValue(disabledFed);

      const result = await service.syncUsers('test-realm', 'fed-1');

      expect(result).toEqual({
        synced: 0,
        message: 'Import is disabled for this federation',
      });
      expect(MockLdapClientWrapper).not.toHaveBeenCalled();
    });

    it('should sync new users and skip existing ones', async () => {
      prisma.userFederation.findUnique.mockResolvedValue(mockFederation);

      const ldapUsers = [
        {
          dn: 'uid=alice',
          uid: 'alice',
          uuid: 'u1',
          email: 'alice@test.com',
          firstName: 'Alice',
          lastName: 'A',
        },
        {
          dn: 'uid=bob',
          uid: 'bob',
          uuid: 'u2',
          email: null,
          firstName: 'Bob',
          lastName: 'B',
        },
        {
          dn: 'uid=charlie',
          uid: 'charlie',
          uuid: 'u3',
          email: 'charlie@test.com',
        },
      ];

      MockLdapClientWrapper.mockImplementationOnce(() => ({
        testConnection: jest.fn(),
        authenticate: jest.fn(),
        searchUser: jest.fn(),
        searchAllUsers: jest.fn().mockResolvedValue(ldapUsers),
      }));

      // alice exists, bob is new, charlie is new
      prisma.user.findUnique
        .mockResolvedValueOnce({ id: 'u-alice', username: 'alice' }) // alice exists
        .mockResolvedValueOnce(null) // bob is new
        .mockResolvedValueOnce(null); // charlie is new

      prisma.user.create.mockResolvedValue({ id: 'u-new' });
      prisma.userFederation.update.mockResolvedValue(mockFederation);

      const result = await service.syncUsers('test-realm', 'fed-1');

      expect(result).toEqual({ synced: 2, total: 3 });
      expect(prisma.user.create).toHaveBeenCalledTimes(2);

      // Verify bob was created with email null and emailVerified false
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          username: 'bob',
          email: null,
          emailVerified: false,
          federationLink: 'fed-1',
        }),
      });

      // Verify charlie was created with email and emailVerified true
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          username: 'charlie',
          email: 'charlie@test.com',
          emailVerified: true,
          federationLink: 'fed-1',
        }),
      });
    });

    it('should update lastSyncAt and lastSyncStatus after sync', async () => {
      prisma.userFederation.findUnique.mockResolvedValue(mockFederation);

      MockLdapClientWrapper.mockImplementationOnce(() => ({
        testConnection: jest.fn(),
        authenticate: jest.fn(),
        searchUser: jest.fn(),
        searchAllUsers: jest
          .fn()
          .mockResolvedValue([{ dn: 'uid=alice', uid: 'alice', uuid: 'u1' }]),
      }));

      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ id: 'u-alice' });
      prisma.userFederation.update.mockResolvedValue(mockFederation);

      await service.syncUsers('test-realm', 'fed-1');

      expect(prisma.userFederation.update).toHaveBeenCalledWith({
        where: { id: 'fed-1' },
        data: {
          lastSyncAt: expect.any(Date),
          lastSyncStatus: 'Synced 1 new users (1 total in LDAP)',
        },
      });
    });

    it('should skip LDAP entries without uid', async () => {
      prisma.userFederation.findUnique.mockResolvedValue(mockFederation);

      MockLdapClientWrapper.mockImplementationOnce(() => ({
        testConnection: jest.fn(),
        authenticate: jest.fn(),
        searchUser: jest.fn(),
        searchAllUsers: jest.fn().mockResolvedValue([
          { dn: 'uid=alice', uid: 'alice', uuid: 'u1' },
          { dn: 'cn=system', uid: '', uuid: 'u2' },
          { dn: 'cn=nouid', uuid: 'u3' },
        ]),
      }));

      // Only alice has a truthy uid
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ id: 'u-new' });
      prisma.userFederation.update.mockResolvedValue(mockFederation);

      const result = await service.syncUsers('test-realm', 'fed-1');

      // alice is synced; the empty-uid and undefined-uid entries are skipped
      expect(result).toEqual({ synced: 1, total: 3 });
      expect(prisma.user.create).toHaveBeenCalledTimes(1);
    });
  });

  // ── authenticateViaFederation ────────────────────────────────────────

  describe('authenticateViaFederation', () => {
    const mockUser = { id: 'user-1', username: 'alice', realmId: 'realm-1' };

    it('should authenticate and return userId when user exists locally', async () => {
      prisma.userFederation.findMany.mockResolvedValue([mockFederation]);

      MockLdapClientWrapper.mockImplementationOnce(() => ({
        testConnection: jest.fn(),
        authenticate: jest.fn().mockResolvedValue(true),
        searchUser: jest.fn(),
        searchAllUsers: jest.fn(),
      }));

      prisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.authenticateViaFederation(
        'realm-1',
        'alice',
        'password123',
      );

      expect(result).toEqual({ authenticated: true, userId: 'user-1' });
    });

    it('should import user from LDAP when not found locally and import enabled', async () => {
      prisma.userFederation.findMany.mockResolvedValue([mockFederation]);

      const ldapUser = {
        dn: 'uid=alice,ou=users,dc=example,dc=com',
        uid: 'alice',
        uuid: 'ldap-uuid-1',
        email: 'alice@example.com',
        firstName: 'Alice',
        lastName: 'Wonderland',
      };

      MockLdapClientWrapper.mockImplementationOnce(() => ({
        testConnection: jest.fn(),
        authenticate: jest.fn().mockResolvedValue(true),
        searchUser: jest.fn().mockResolvedValue(ldapUser),
        searchAllUsers: jest.fn(),
      }));

      // User not found locally, then created
      prisma.user.findUnique.mockResolvedValue(null);
      const createdUser = { id: 'user-new', username: 'alice' };
      prisma.user.create.mockResolvedValue(createdUser);

      const result = await service.authenticateViaFederation(
        'realm-1',
        'alice',
        'password123',
      );

      expect(result).toEqual({ authenticated: true, userId: 'user-new' });
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          realmId: 'realm-1',
          username: 'alice',
          email: 'alice@example.com',
          firstName: 'Alice',
          lastName: 'Wonderland',
          enabled: true,
          emailVerified: true,
          federationLink: 'fed-1',
        }),
      });
    });

    it('should return not authenticated when no federations match', async () => {
      prisma.userFederation.findMany.mockResolvedValue([]);

      const result = await service.authenticateViaFederation(
        'realm-1',
        'alice',
        'password123',
      );

      expect(result).toEqual({ authenticated: false });
    });

    it('should return not authenticated when LDAP auth fails', async () => {
      prisma.userFederation.findMany.mockResolvedValue([mockFederation]);

      MockLdapClientWrapper.mockImplementationOnce(() => ({
        testConnection: jest.fn(),
        authenticate: jest.fn().mockResolvedValue(false),
        searchUser: jest.fn(),
        searchAllUsers: jest.fn(),
      }));

      const result = await service.authenticateViaFederation(
        'realm-1',
        'alice',
        'wrong-password',
      );

      expect(result).toEqual({ authenticated: false });
    });

    it('should return not authenticated when user not found locally and import disabled', async () => {
      const noImportFed = { ...mockFederation, importEnabled: false };
      prisma.userFederation.findMany.mockResolvedValue([noImportFed]);

      MockLdapClientWrapper.mockImplementationOnce(() => ({
        testConnection: jest.fn(),
        authenticate: jest.fn().mockResolvedValue(true),
        searchUser: jest.fn(),
        searchAllUsers: jest.fn(),
      }));

      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.authenticateViaFederation(
        'realm-1',
        'alice',
        'password123',
      );

      // authenticated via LDAP but no local user and import disabled → no user → authenticated false
      expect(result).toEqual({ authenticated: false });
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('should try next federation when first one fails LDAP auth', async () => {
      const fed2 = {
        ...mockFederation,
        id: 'fed-2',
        name: 'backup-ldap',
        priority: 1,
      };
      prisma.userFederation.findMany.mockResolvedValue([mockFederation, fed2]);

      // First federation: LDAP auth fails
      MockLdapClientWrapper.mockImplementationOnce(() => ({
        testConnection: jest.fn(),
        authenticate: jest.fn().mockResolvedValue(false),
        searchUser: jest.fn(),
        searchAllUsers: jest.fn(),
      }));
      // Second federation: LDAP auth succeeds
      MockLdapClientWrapper.mockImplementationOnce(() => ({
        testConnection: jest.fn(),
        authenticate: jest.fn().mockResolvedValue(true),
        searchUser: jest.fn(),
        searchAllUsers: jest.fn(),
      }));

      prisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.authenticateViaFederation(
        'realm-1',
        'alice',
        'password123',
      );

      expect(MockLdapClientWrapper).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ authenticated: true, userId: 'user-1' });
    });

    it('should return not authenticated when LDAP auth succeeds but searchUser returns null', async () => {
      prisma.userFederation.findMany.mockResolvedValue([mockFederation]);

      MockLdapClientWrapper.mockImplementationOnce(() => ({
        testConnection: jest.fn(),
        authenticate: jest.fn().mockResolvedValue(true),
        searchUser: jest.fn().mockResolvedValue(null),
        searchAllUsers: jest.fn(),
      }));

      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.authenticateViaFederation(
        'realm-1',
        'alice',
        'password123',
      );

      // LDAP auth passed but user could not be imported (searchUser returned null)
      // and no local user exists, so user is null → authenticated: false
      expect(result).toEqual({ authenticated: false });
    });
  });
});
