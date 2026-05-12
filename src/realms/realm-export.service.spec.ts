import { NotFoundException } from '@nestjs/common';
import { RealmExportService } from './realm-export.service.js';
import {
  createMockPrismaService,
  type MockPrismaService,
} from '../prisma/prisma.mock.js';

describe('RealmExportService', () => {
  let service: RealmExportService;
  let prisma: MockPrismaService;

  const mockRealm = {
    id: 'realm-1',
    name: 'test-realm',
    displayName: 'Test Realm',
    enabled: true,
    accessTokenLifespan: 300,
    refreshTokenLifespan: 1800,
    offlineTokenLifespan: 2592000,
    smtpHost: null,
    smtpPort: 587,
    smtpUser: null,
    smtpFrom: null,
    smtpSecure: false,
    passwordMinLength: 8,
    passwordRequireUppercase: false,
    passwordRequireLowercase: false,
    passwordRequireDigits: false,
    passwordRequireSpecialChars: false,
    passwordHistoryCount: 0,
    passwordMaxAgeDays: 0,
    bruteForceEnabled: false,
    maxLoginFailures: 5,
    lockoutDuration: 900,
    failureResetTime: 600,
    permanentLockoutAfter: 0,
    mfaRequired: false,
    eventsEnabled: false,
    eventsExpiration: 604800,
    adminEventsEnabled: false,
    theme: {},
  };

  const mockClient = {
    id: 'client-db-1',
    realmId: 'realm-1',
    clientId: 'my-app',
    clientType: 'CONFIDENTIAL',
    clientSecret: 'secret-value',
    name: 'My App',
    description: 'Test client',
    enabled: true,
    requireConsent: false,
    redirectUris: ['http://localhost/callback'],
    webOrigins: ['http://localhost'],
    grantTypes: ['authorization_code'],
    backchannelLogoutUri: null,
    backchannelLogoutSessionRequired: true,
  };

  const mockRole = {
    id: 'role-1',
    realmId: 'realm-1',
    clientId: null,
    name: 'admin',
    description: 'Admin role',
  };

  const mockClientRole = {
    id: 'role-2',
    realmId: 'realm-1',
    clientId: 'client-db-1',
    name: 'client-admin',
    description: 'Client admin role',
  };

  const mockGroup = {
    id: 'group-1',
    realmId: 'realm-1',
    name: 'developers',
    description: 'Dev group',
    parentId: null,
  };

  const mockScope = {
    id: 'scope-1',
    realmId: 'realm-1',
    name: 'openid',
    description: 'OpenID scope',
    protocol: 'openid-connect',
    builtIn: true,
    protocolMappers: [
      {
        name: 'sub',
        protocol: 'openid-connect',
        mapperType: 'oidc-usermodel-attribute-mapper',
        config: {},
      },
    ],
  };

  const mockIdp = {
    id: 'idp-1',
    realmId: 'realm-1',
    alias: 'google',
    displayName: 'Google',
    enabled: true,
    providerType: 'oidc',
    clientId: 'google-client-id',
    clientSecret: 'google-secret',
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userinfoUrl: null,
    jwksUrl: null,
    issuer: null,
    defaultScopes: 'openid email profile',
    trustEmail: true,
    linkOnly: false,
    syncUserProfile: true,
  };

  beforeEach(() => {
    prisma = createMockPrismaService();
    service = new RealmExportService(prisma as any);
  });

  describe('exportRealm', () => {
    it('should throw NotFoundException when realm does not exist', async () => {
      prisma.realm.findUnique.mockResolvedValue(null);

      await expect(service.exportRealm('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.exportRealm('nonexistent')).rejects.toThrow(
        "Realm 'nonexistent' not found",
      );
    });

    it('should export realm with all entities', async () => {
      prisma.realm.findUnique.mockResolvedValue(mockRealm);
      prisma.client.findMany.mockResolvedValue([mockClient]);
      prisma.role.findMany.mockResolvedValue([mockRole, mockClientRole]);
      prisma.group.findMany.mockResolvedValue([mockGroup]);
      prisma.clientScope.findMany.mockResolvedValue([mockScope]);
      prisma.identityProvider.findMany.mockResolvedValue([mockIdp]);
      prisma.clientDefaultScope.findMany.mockResolvedValue([
        { clientId: 'client-db-1', clientScopeId: 'scope-1' },
      ]);
      prisma.clientOptionalScope.findMany.mockResolvedValue([]);

      const result = await service.exportRealm('test-realm');

      expect(result['version']).toBe(1);
      expect(result['realm']).toBeDefined();
      expect((result['realm'] as any).name).toBe('test-realm');

      // Clients
      const clients = result['clients'] as any[];
      expect(clients).toHaveLength(1);
      expect(clients[0].clientId).toBe('my-app');

      // Roles
      const roles = result['roles'] as any[];
      expect(roles).toHaveLength(2);
      expect(roles[0].name).toBe('admin');
      expect(roles[0].clientId).toBeNull();
      expect(roles[1].name).toBe('client-admin');
      expect(roles[1].clientId).toBe('my-app'); // mapped to natural key

      // Groups
      expect(result['groups'] as any[]).toHaveLength(1);

      // Client scopes
      const scopes = result['clientScopes'] as any[];
      expect(scopes).toHaveLength(1);
      expect(scopes[0].protocolMappers).toHaveLength(1);

      // IDPs
      expect(result['identityProviders'] as any[]).toHaveLength(1);

      // Scope assignments
      const assignments = result['clientScopeAssignments'] as any[];
      expect(assignments).toHaveLength(1);
      expect(assignments[0].defaultScopes).toContain('openid');
    });

    it('should exclude secrets by default', async () => {
      prisma.realm.findUnique.mockResolvedValue(mockRealm);
      prisma.client.findMany.mockResolvedValue([mockClient]);
      prisma.role.findMany.mockResolvedValue([]);
      prisma.group.findMany.mockResolvedValue([]);
      prisma.clientScope.findMany.mockResolvedValue([]);
      prisma.identityProvider.findMany.mockResolvedValue([mockIdp]);
      prisma.clientDefaultScope.findMany.mockResolvedValue([]);
      prisma.clientOptionalScope.findMany.mockResolvedValue([]);

      const result = await service.exportRealm('test-realm');

      const clients = result['clients'] as any[];
      expect(clients[0].clientSecret).toBeUndefined();

      const idps = result['identityProviders'] as any[];
      expect(idps[0].clientSecret).toBeUndefined();
    });

    it('should include secrets when option is set', async () => {
      prisma.realm.findUnique.mockResolvedValue(mockRealm);
      prisma.client.findMany.mockResolvedValue([mockClient]);
      prisma.role.findMany.mockResolvedValue([]);
      prisma.group.findMany.mockResolvedValue([]);
      prisma.clientScope.findMany.mockResolvedValue([]);
      prisma.identityProvider.findMany.mockResolvedValue([mockIdp]);
      prisma.clientDefaultScope.findMany.mockResolvedValue([]);
      prisma.clientOptionalScope.findMany.mockResolvedValue([]);

      const result = await service.exportRealm('test-realm', {
        includeSecrets: true,
      });

      const clients = result['clients'] as any[];
      expect(clients[0].clientSecret).toBe('secret-value');

      const idps = result['identityProviders'] as any[];
      expect(idps[0].clientSecret).toBe('google-secret');
    });

    it('should include users when option is set', async () => {
      prisma.realm.findUnique.mockResolvedValue(mockRealm);
      prisma.client.findMany.mockResolvedValue([mockClient]);
      prisma.role.findMany.mockResolvedValue([mockRole]);
      prisma.group.findMany.mockResolvedValue([mockGroup]);
      prisma.clientScope.findMany.mockResolvedValue([]);
      prisma.identityProvider.findMany.mockResolvedValue([]);
      prisma.clientDefaultScope.findMany.mockResolvedValue([]);
      prisma.clientOptionalScope.findMany.mockResolvedValue([]);
      prisma.user.findMany.mockResolvedValue([
        {
          username: 'testuser',
          email: 'test@example.com',
          emailVerified: true,
          firstName: 'Test',
          lastName: 'User',
          enabled: true,
          userRoles: [{ role: { name: 'admin', clientId: null } }],
          userGroups: [{ group: { name: 'developers' } }],
        },
      ]);

      const result = await service.exportRealm('test-realm', {
        includeUsers: true,
      });

      const users = result['users'] as any[];
      expect(users).toHaveLength(1);
      expect(users[0].username).toBe('testuser');
      expect(users[0].roles).toHaveLength(1);
      expect(users[0].groups).toContain('developers');
    });

    it('should not include users by default', async () => {
      prisma.realm.findUnique.mockResolvedValue(mockRealm);
      prisma.client.findMany.mockResolvedValue([]);
      prisma.role.findMany.mockResolvedValue([]);
      prisma.group.findMany.mockResolvedValue([]);
      prisma.clientScope.findMany.mockResolvedValue([]);
      prisma.identityProvider.findMany.mockResolvedValue([]);
      prisma.clientDefaultScope.findMany.mockResolvedValue([]);
      prisma.clientOptionalScope.findMany.mockResolvedValue([]);

      const result = await service.exportRealm('test-realm');

      expect(result['users']).toBeUndefined();
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    it('should handle groups with parent references', async () => {
      const parentGroup = {
        id: 'g1',
        name: 'parent',
        description: null,
        parentId: null,
        realmId: 'realm-1',
      };
      const childGroup = {
        id: 'g2',
        name: 'child',
        description: null,
        parentId: 'g1',
        realmId: 'realm-1',
      };

      prisma.realm.findUnique.mockResolvedValue(mockRealm);
      prisma.client.findMany.mockResolvedValue([]);
      prisma.role.findMany.mockResolvedValue([]);
      prisma.group.findMany.mockResolvedValue([parentGroup, childGroup]);
      prisma.clientScope.findMany.mockResolvedValue([]);
      prisma.identityProvider.findMany.mockResolvedValue([]);
      prisma.clientDefaultScope.findMany.mockResolvedValue([]);
      prisma.clientOptionalScope.findMany.mockResolvedValue([]);

      const result = await service.exportRealm('test-realm');

      const groups = result['groups'] as any[];
      expect(groups[0].parentName).toBeNull();
      expect(groups[1].parentName).toBe('parent');
    });
  });
});
