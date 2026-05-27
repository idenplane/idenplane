import type { Realm, User, Client, Role, NhiIdentity, ConsentCategory } from '../../types';
import type { LoginEvent, AdminEvent } from '../../api/events';
import type { RealmStats } from '../../api/stats';
import type { AuthFlow } from '../../api/authFlows';
import type { UpgradeAuditEntry, PreUpgradeValidationResult, UpgradeHealthResult, RollbackCapability } from '../../api/upgrade';
import type { NhiIdentityType, NhiLifecycleStatus } from '../../api/nhi';

export function makeRealm(overrides: Partial<Realm> = {}): Realm {
  return {
    id: 'realm-1',
    name: 'test-realm',
    displayName: 'Test Realm',
    enabled: true,
    accessTokenLifespan: 300,
    refreshTokenLifespan: 1800,
    smtpHost: null,
    smtpPort: null,
    smtpUser: null,
    smtpPassword: null,
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
    lockoutDuration: 60,
    failureResetTime: 300,
    permanentLockoutAfter: 0,
    registrationAllowed: false,
    mfaRequired: false,
    offlineTokenLifespan: 2592000,
    eventsEnabled: false,
    eventsExpiration: 0,
    adminEventsEnabled: false,
    themeName: 'default',
    theme: null,
    loginTheme: 'default',
    accountTheme: 'default',
    emailTheme: 'default',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    realmId: 'realm-1',
    username: 'testuser',
    email: 'testuser@example.com',
    emailVerified: false,
    firstName: 'Test',
    lastName: 'User',
    enabled: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeClient(overrides: Partial<Client> = {}): Client {
  return {
    id: 'client-1',
    realmId: 'realm-1',
    clientId: 'my-app',
    clientType: 'CONFIDENTIAL',
    name: 'My Application',
    description: null,
    enabled: true,
    redirectUris: ['https://app.example.com/callback'],
    webOrigins: ['https://app.example.com'],
    grantTypes: ['authorization_code'],
    requireConsent: false,
    backchannelLogoutUri: null,
    backchannelLogoutSessionRequired: false,
    serviceAccountUserId: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeRole(overrides: Partial<Role> = {}): Role {
  return {
    id: 'role-1',
    realmId: 'realm-1',
    clientId: null,
    name: 'admin',
    description: 'Administrator role',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeLoginEvent(overrides: Partial<LoginEvent> = {}): LoginEvent {
  return {
    id: 'event-1',
    realmId: 'realm-1',
    userId: 'user-1',
    sessionId: 'session-1',
    type: 'LOGIN',
    clientId: 'my-app',
    ipAddress: '127.0.0.1',
    error: null,
    details: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeAdminEvent(overrides: Partial<AdminEvent> = {}): AdminEvent {
  return {
    id: 'admin-event-1',
    realmId: 'realm-1',
    adminUserId: 'admin-1',
    operationType: 'CREATE',
    resourceType: 'USER',
    resourcePath: '/users/user-1',
    representation: null,
    ipAddress: '127.0.0.1',
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeStats(overrides: Partial<RealmStats> = {}): RealmStats {
  return {
    activeUsers24h: 5,
    activeUsers7d: 20,
    activeUsers30d: 80,
    loginSuccessCount: 42,
    loginFailureCount: 3,
    activeSessionCount: 12,
    ...overrides,
  };
}

export function makeAuthFlow(overrides: Partial<AuthFlow> = {}): AuthFlow {
  return {
    id: 'flow-1',
    realmId: 'realm-1',
    name: 'Basic Login',
    description: 'Password authentication',
    isDefault: true,
    steps: [
      {
        id: 'password-1',
        type: 'password',
        required: true,
        order: 1,
        condition: null,
        fallbackStepId: null,
        config: {},
      },
    ],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeUpgradeAuditEntry(overrides: Partial<UpgradeAuditEntry> = {}): UpgradeAuditEntry {
  return {
    id: 'upgrade-1',
    fromVersion: '1.0.0',
    toVersion: '1.1.0',
    status: 'COMPLETED',
    startedAt: new Date('2024-01-01T10:00:00.000Z'),
    completedAt: new Date('2024-01-01T10:05:00.000Z'),
    backupId: 'backup-123',
    errorMessage: null,
    ...overrides,
  };
}

export function makePreUpgradeValidationResult(overrides: Partial<PreUpgradeValidationResult> = {}): PreUpgradeValidationResult {
  return {
    canProceed: true,
    checks: [
      { name: 'Database Connection', status: 'pass', message: 'Database connection successful' },
      { name: 'Pending Migrations', status: 'pass', message: 'No pending migrations' },
      { name: 'Disk Space', status: 'pass', message: 'Sufficient disk space available' },
    ],
    summary: { passed: 3, warnings: 0, failures: 0 },
    ...overrides,
  };
}

export function makeUpgradeHealthResult(overrides: Partial<UpgradeHealthResult> = {}): UpgradeHealthResult {
  return {
    healthy: true,
    version: '1.1.0',
    checks: [
      { name: 'Database Connection', status: 'pass', message: 'Database connection successful' },
      { name: 'Schema Integrity', status: 'pass', message: 'Schema integrity verified' },
    ],
    summary: { passed: 2, warnings: 0, failures: 0 },
    ...overrides,
  };
}

export function makeRollbackCapability(overrides: Partial<RollbackCapability> = {}): RollbackCapability {
  return {
    canRollback: true,
    lastSuccessfulUpgrade: {
      id: 'upgrade-1',
      fromVersion: '1.0.0',
      toVersion: '1.1.0',
      backupId: 'backup-123',
      completedAt: new Date('2024-01-01T10:05:00.000Z'),
    },
    reason: undefined,
    ...overrides,
  };
}

export function makeNhiIdentity(overrides: Partial<NhiIdentity> = {}): NhiIdentity {
  return {
    id: 'nhi-1',
    realmId: 'realm-1',
    name: 'test-identity',
    description: null,
    identityType: 'IOT_DEVICE' as NhiIdentityType,
    lifecycleStatus: 'ACTIVE' as NhiLifecycleStatus,
    enabled: true,
    permissionScopes: [],
    tags: [],
    agentPurpose: null,
    certificateFingerprint: null,
    certificateSubject: null,
    certificateNotBefore: null,
    certificateNotAfter: null,
    suspendedAt: null,
    decommissionedAt: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeConsentCategory(
  overrides: Partial<ConsentCategory> = {},
): ConsentCategory {
  return {
    id: 'cat-1',
    realmId: 'realm-1',
    key: 'marketing',
    displayName: 'Marketing',
    description: 'Marketing communications',
    required: false,
    configurableByUser: true,
    showInAccountPortal: true,
    order: 0,
    enabled: true,
    scopes: [],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}
