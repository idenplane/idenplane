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
  // SMS MFA
  smsMfaEnabled?: boolean;
  smsProvider?: SmsProviderType;
  smsFrom?: string;
  smsProviderConfig?: SmsProviderConfig;
  otpLength?: number;
  otpExpirySeconds?: number;
  smsMaxRequestsPerUser?: number;
  smsRateLimitWindow?: number;
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
