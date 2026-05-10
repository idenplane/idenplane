export interface Realm {
  id: string;
  name: string;
  displayName: string | null;
  enabled: boolean;
  accessTokenLifespan: number;
  refreshTokenLifespan: number;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  smtpPassword: string | null;
  smtpFrom: string | null;
  smtpSecure: boolean;
  // Password policies
  passwordMinLength: number;
  passwordRequireUppercase: boolean;
  passwordRequireLowercase: boolean;
  passwordRequireDigits: boolean;
  passwordRequireSpecialChars: boolean;
  passwordHistoryCount: number;
  passwordMaxAgeDays: number;
  // Brute force
  bruteForceEnabled: boolean;
  maxLoginFailures: number;
  lockoutDuration: number;
  failureResetTime: number;
  permanentLockoutAfter: number;
  // Registration
  registrationAllowed: boolean;
  // MFA
  mfaRequired: boolean;
  // Offline tokens
  offlineTokenLifespan: number;
  // Events
  eventsEnabled: boolean;
  eventsExpiration: number;
  adminEventsEnabled: boolean;
  // Theming
  themeName: string;
  theme: RealmTheme | null;
  loginTheme: string;
  accountTheme: string;
  emailTheme: string;
  createdAt: string;
  updatedAt: string;
}

export interface RealmTheme {
  logoUrl?: string;
  faviconUrl?: string;
  primaryColor?: string;
  primaryHoverColor?: string;
  backgroundColor?: string;
  cardColor?: string;
  textColor?: string;
  customCss?: string;
  appTitle?: string;
}

export interface User {
  id: string;
  realmId: string;
  username: string;
  email: string | null;
  emailVerified: boolean;
  firstName: string | null;
  lastName: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Client {
  id: string;
  realmId: string;
  clientId: string;
  clientType: 'CONFIDENTIAL' | 'PUBLIC';
  clientSecret?: string;
  name: string | null;
  description: string | null;
  enabled: boolean;
  redirectUris: string[];
  webOrigins: string[];
  grantTypes: string[];
  requireConsent: boolean;
  backchannelLogoutUri: string | null;
  backchannelLogoutSessionRequired: boolean;
  serviceAccountUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Role {
  id: string;
  realmId: string;
  clientId: string | null;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IdentityProvider {
  id: string;
  realmId: string;
  alias: string;
  displayName: string | null;
  enabled: boolean;
  providerType: string;
  clientId: string;
  clientSecret: string;
  authorizationUrl: string;
  tokenUrl: string;
  userinfoUrl: string | null;
  jwksUrl: string | null;
  issuer: string | null;
  defaultScopes: string;
  trustEmail: boolean;
  linkOnly: boolean;
  syncUserProfile: boolean;
  samlConfig?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface SamlServiceProvider {
  id: string;
  realmId: string;
  entityId: string;
  name: string;
  enabled: boolean;
  acsUrl: string;
  sloUrl: string | null;
  certificate: string | null;
  nameIdFormat: string;
  signAssertions: boolean;
  signResponses: boolean;
  attributeStatements: Record<string, unknown>;
  validRedirectUris: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Group {
  id: string;
  realmId: string;
  name: string;
  description: string | null;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
  children?: Group[];
  _count?: { userGroups: number; groupRoles: number };
}

export interface ClientScope {
  id: string;
  realmId: string;
  name: string;
  description: string | null;
  protocol: string;
  builtIn: boolean;
  createdAt: string;
  updatedAt: string;
  protocolMappers?: ProtocolMapper[];
}

export interface ProtocolMapper {
  id: string;
  clientScopeId: string;
  name: string;
  protocol: string;
  mapperType: string;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface OfflineSession {
  id: string;
  sessionId: string;
  sessionStarted: string;
  expiresAt: string;
  createdAt: string;
}

export interface UserFederation {
  id: string;
  realmId: string;
  name: string;
  providerType: string;
  enabled: boolean;
  priority: number;
  connectionUrl: string;
  bindDn: string;
  bindCredential: string;
  startTls: boolean;
  connectionTimeout: number;
  usersDn: string;
  userObjectClass: string;
  usernameLdapAttr: string;
  rdnLdapAttr: string;
  uuidLdapAttr: string;
  searchFilter: string | null;
  syncMode: string;
  syncPeriod: number;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  importEnabled: boolean;
  editMode: string;
  createdAt: string;
  updatedAt: string;
}

// ── NHI Types ────────────────────────────────────────────────────────────────

export type NhiIdentityType = 'IOT_DEVICE' | 'AI_AGENT' | 'BOT' | 'MACHINE_TO_MACHINE';
export type NhiLifecycleStatus = 'PROVISIONING' | 'ACTIVE' | 'SUSPENDED' | 'DECOMMISSIONED';
export type NhiCredentialType = 'API_KEY' | 'CERTIFICATE' | 'JWT_BEARER';

export interface NhiIdentity {
  id: string;
  realmId: string;
  identityType: NhiIdentityType;
  name: string;
  description: string | null;
  enabled: boolean;
  lifecycleStatus: NhiLifecycleStatus;
  suspendedAt: string | null;
  decommissionedAt: string | null;
  certificateSubject: string | null;
  certificateFingerprint: string | null;
  certificateNotBefore: string | null;
  certificateNotAfter: string | null;
  agentPurpose: string | null;
  permissionScopes: string[];
  metadata: Record<string, unknown>;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface NhiCredential {
  id: string;
  nhiIdentityId: string;
  credentialType: NhiCredentialType;
  name: string;
  keyPrefix: string | null;
  expiresAt: string | null;
  rotatedAt: string | null;
  rotationRequired: boolean;
  enabled: boolean;
  revoked: boolean;
  revokedAt: string | null;
  lastUsedAt: string | null;
  requestCount: number;
  allowedIpRanges: string[];
  createdAt: string;
  updatedAt: string;
}

export interface NhiCredentialPolicy {
  id: string;
  realmId: string;
  name: string;
  description: string | null;
  enabled: boolean;
  priority: number;
  credentialType: NhiCredentialType;
  rotationIntervalDays: number;
  rotationBeforeDays: number;
  autoRotate: boolean;
  maxCredentialAgeDays: number;
  maxRequestsPerDay: number | null;
  maxRequestsPerMonth: number | null;
  rateLimitPerMinute: number | null;
  requireCertificate: boolean;
  requireIpRestriction: boolean;
  requireAuditLogging: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NhiUsageStats {
  id: string;
  nhiIdentityId: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  lastActiveAt: string | null;
  lastSuccessfulAt: string | null;
  lastFailedAt: string | null;
  oldestCredentialAgeDays: number | null;
  newestCredentialAgeDays: number | null;
  credentialsExpiringSoon: number;
  updatedAt: string;
}

export interface NhiAuditLog {
  id: string;
  realmId: string;
  nhiIdentityId: string;
  action: string;
  credentialId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  success: boolean;
  errorCode: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}
