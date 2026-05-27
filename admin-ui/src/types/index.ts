export type SmsProviderType = 'none' | 'twilio' | 'vonage' | 'aws-sns' | 'webhook';

export interface SmsProviderConfig {
  // Twilio
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  // Vonage
  vonageApiKey?: string;
  vonageApiSecret?: string;
  // AWS SNS
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  awsRegion?: string;
  // Webhook
  webhookUrl?: string;
  webhookHeaders?: string;
  webhookTimeout?: number;
}

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
  passwordMinLength: number;
  passwordRequireUppercase: boolean;
  passwordRequireLowercase: boolean;
  passwordRequireDigits: boolean;
  passwordRequireSpecialChars: boolean;
  passwordHistoryCount: number;
  passwordMaxAgeDays: number;
  bruteForceEnabled: boolean;
  maxLoginFailures: number;
  lockoutDuration: number;
  failureResetTime: number;
  permanentLockoutAfter: number;
  registrationAllowed: boolean;
  registrationApprovalRequired: boolean;
  requireEmailVerification: boolean;
  allowedEmailDomains: string[];
  termsOfServiceUrl: string;
  privacyPolicyUrl: string;
  captchaEnabled: boolean;
  captchaProvider: string;
  recaptchaSiteKey: string;
  recaptchaSecretKey: string;
  hcaptchaSiteKey: string;
  hcaptchaSecretKey: string;
  captchaScoreThreshold: number;
  mfaRequired: boolean;
  smsMfaEnabled?: boolean;
  smsProvider?: SmsProviderType;
  smsFrom?: string;
  smsProviderConfig?: SmsProviderConfig;
  otpLength?: number;
  otpExpirySeconds?: number;
  smsMaxRequestsPerUser?: number;
  smsRateLimitWindow?: number;
  offlineTokenLifespan: number;
  eventsEnabled: boolean;
  eventsExpiration: number;
  adminEventsEnabled: boolean;
  themeName: string;
  theme: RealmTheme | null;
  loginTheme: string;
  accountTheme: string;
  emailTheme: string;
  magicLinkEnabled: boolean;
  magicLinkExpirySeconds: number;
  magicLinkRateLimitPerEmail: number;
  magicLinkRateLimitWindowSeconds: number;
  magicLinkEmailSubject: string | null;
  magicLinkEmailTemplate: string | null;
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

export interface MagicLinkSettings {
  enabled: boolean;
  expirySeconds: number;
  rateLimitPerEmail: number;
  rateLimitWindowSeconds: number;
  emailSubject: string | null;
  emailTemplate: string | null;
}

export type NhiIdentityType = 'IOT_DEVICE' | 'AI_AGENT' | 'BOT' | 'MACHINE_TO_MACHINE';
export type NhiLifecycleStatus = 'PROVISIONING' | 'ACTIVE' | 'SUSPENDED' | 'DECOMMISSIONED';
export type NhiCredentialType = 'API_KEY' | 'CERTIFICATE' | 'JWT_BEARER';

export interface NhiIdentity {
  id: string;
  realmId: string;
  name: string;
  description: string | null;
  identityType: NhiIdentityType;
  lifecycleStatus: NhiLifecycleStatus;
  enabled: boolean;
  permissionScopes: string[];
  tags: string[];
  agentPurpose: string | null;
  certificateFingerprint: string | null;
  certificateSubject: string | null;
  certificateNotBefore: string | null;
  certificateNotAfter: string | null;
  suspendedAt: string | null;
  decommissionedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NhiCredential {
  id: string;
  name: string;
  credentialType: NhiCredentialType;
  keyPrefix: string | null;
  expiresAt: string | null;
  revoked: boolean;
  enabled: boolean;
  rotationRequired: boolean;
}

export interface NhiCredentialPolicy {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  priority: number;
  credentialType: NhiCredentialType;
  rotationIntervalDays: number;
  rotationBeforeDays: number;
  autoRotate: boolean;
  maxCredentialAgeDays: number;
  maxRequestsPerDay: number;
  maxRequestsPerMonth: number;
  rateLimitPerMinute: number;
  requireCertificate: boolean;
  requireIpRestriction: boolean;
  requireAuditLogging: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NhiUsageStats {
  identityId: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  lastUsedAt: string | null;
  averageRequestsPerDay: number;
  peakRequestsPerDay: number;
}

export interface NhiAuditLog {
  id: string;
  nhiIdentityId: string;
  action: string;
  success: boolean;
  ipAddress: string | null;
  userAgent: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface ConsentCategory {
  id: string;
  realmId: string;
  /** Stable, unique-per-realm identifier (immutable in practice). */
  key: string;
  /** Human-readable label. */
  displayName: string;
  description: string | null;
  required: boolean;
  configurableByUser: boolean;
  showInAccountPortal: boolean;
  order: number;
  enabled: boolean;
  /**
   * OIDC scope names this category governs. Empty falls back to the convention
   * that the category governs the scope whose name equals its `key`.
   */
  scopes: string[];
  createdAt: string;
  updatedAt: string;
}
