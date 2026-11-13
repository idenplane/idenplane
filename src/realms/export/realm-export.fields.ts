/**
 * What a realm export (format version 2) carries, field by field.
 *
 * Every model the export touches has an entry in EXPORT_MODELS, and every
 * column of that model is in exactly one of its lists:
 *
 * - `fields`: exported as is, under the same name;
 * - `secrets`: exported only with `includeSecrets` (see SecretKind);
 * - `refs`: a foreign key, exported as the natural key of the row it names;
 * - `excluded`: never exported, with the reason.
 *
 * Every other model of the schema is in EXCLUDED_MODELS with the reason.
 *
 * `realm-export.fields.spec.ts` reads prisma/schema.prisma and fails when a
 * model or a column is in none of these lists, or when a declared type no
 * longer matches the schema. A new setting can therefore never be dropped
 * from exports silently: whoever adds the column must decide here.
 *
 * Field types use the schema's own notation, so the test can compare them:
 * `Base`, `Base?` (nullable) or `Base[]` (list), followed by ` @default` when
 * the column has a default. `Base` is a Prisma scalar or an enum name. A
 * field with neither `?`, `[]` nor `@default` is required in an import.
 */

export type FieldType = string;

/**
 * How a secret is stored, which decides how it travels:
 *
 * - `hash`: a one-way hash (client secrets). The hash is exported; an import
 *   keeps a hash as it is and hashes anything else.
 * - `encrypted`: encrypted at rest with CryptoService.encryptSecret (tolerates
 *   legacy plaintext). Exported decrypted; re-encrypted with the target's
 *   key on import, so the two instances' WEBHOOK_SECRET_KEY need not match.
 * - `encrypted-strict`: encrypted with CryptoService.encrypt and always read
 *   with decrypt (webhook secrets). Same as `encrypted` in transit.
 * - `plain`: stored as is. Exported and imported as is.
 */
export type SecretKind = 'hash' | 'encrypted' | 'encrypted-strict' | 'plain';

export interface SecretSpec {
  type: FieldType;
  kind: SecretKind;
}

export interface ModelExportSpec {
  /** Where rows of the model appear in the export file. */
  section: string;
  fields: Record<string, FieldType>;
  secrets?: Record<string, SecretSpec>;
  /** Foreign key column → the key it is exported as and what it names. */
  refs?: Record<string, string>;
  excluded?: Record<string, string>;
  /**
   * Json fields that are exported but contain secret keys of their own
   * (removed without `includeSecrets`, decrypted with it).
   */
  jsonWithSecrets?: Record<string, 'email-provider' | 'sms-provider'>;
}

const ID = 'database id; rows are matched by their natural key';
const REALM_ID = 'the realm being exported or imported';
const CREATED = 'creation timestamp; set again on import';
const UPDATED = 'update timestamp; set again on import';

export const EXPORT_MODELS = {
  Realm: {
    section: 'realm',
    fields: {
      name: 'String',
      displayName: 'String?',
      enabled: 'Boolean @default',
      accessTokenLifespan: 'Int @default',
      refreshTokenLifespan: 'Int @default',
      offlineTokenLifespan: 'Int @default',
      smtpHost: 'String?',
      smtpPort: 'Int? @default',
      smtpUser: 'String?',
      smtpFrom: 'String?',
      smtpSecure: 'Boolean @default',
      emailProvider: 'String @default',
      emailProviderConfig: 'Json?',
      authFlowsEnabled: 'Boolean @default',
      magicLinkEnabled: 'Boolean @default',
      magicLinkExpirySeconds: 'Int @default',
      magicLinkRateLimitPerEmail: 'Int @default',
      magicLinkRateLimitWindowSeconds: 'Int @default',
      magicLinkEmailSubject: 'String?',
      magicLinkEmailTemplate: 'String?',
      passwordMinLength: 'Int @default',
      passwordRequireUppercase: 'Boolean @default',
      passwordRequireLowercase: 'Boolean @default',
      passwordRequireDigits: 'Boolean @default',
      passwordRequireSpecialChars: 'Boolean @default',
      passwordHistoryCount: 'Int @default',
      passwordMaxAgeDays: 'Int @default',
      bruteForceEnabled: 'Boolean @default',
      maxLoginFailures: 'Int @default',
      lockoutDuration: 'Int @default',
      failureResetTime: 'Int @default',
      permanentLockoutAfter: 'Int @default',
      registrationAllowed: 'Boolean @default',
      registrationApprovalRequired: 'Boolean @default',
      allowedEmailDomains: 'String[] @default',
      termsOfServiceUrl: 'String?',
      privacyPolicyUrl: 'String?',
      captchaEnabled: 'Boolean @default',
      captchaProvider: 'String?',
      recaptchaSiteKey: 'String?',
      hcaptchaSiteKey: 'String?',
      captchaScoreThreshold: 'Float @default',
      requireEmailVerification: 'Boolean @default',
      mfaRequired: 'Boolean @default',
      webAuthnEnabled: 'Boolean @default',
      webAuthnRpName: 'String?',
      webAuthnRpId: 'String?',
      webAuthnUserVerificationRequired: 'Boolean @default',
      smsMfaEnabled: 'Boolean @default',
      smsProvider: 'String @default',
      smsProviderConfig: 'Json? @default',
      smsFrom: 'String?',
      otpLength: 'Int @default',
      otpExpirySeconds: 'Int @default',
      smsMaxRequestsPerUser: 'Int @default',
      smsRateLimitWindow: 'Int @default',
      impersonationEnabled: 'Boolean @default',
      impersonationMaxDuration: 'Int @default',
      eventsEnabled: 'Boolean @default',
      eventsExpiration: 'Int @default',
      adminEventsEnabled: 'Boolean @default',
      loginEventRetentionDays: 'Int @default',
      adminEventRetentionDays: 'Int @default',
      rateLimitEnabled: 'Boolean @default',
      clientRateLimitPerMinute: 'Int @default',
      clientRateLimitPerHour: 'Int @default',
      userRateLimitPerMinute: 'Int @default',
      userRateLimitPerHour: 'Int @default',
      ipRateLimitPerMinute: 'Int @default',
      ipRateLimitPerHour: 'Int @default',
      themeName: 'String @default',
      theme: 'Json? @default',
      loginTheme: 'String @default',
      accountTheme: 'String @default',
      emailTheme: 'String @default',
      defaultLocale: 'String @default',
      supportedLocales: 'String[] @default',
      maxSessionsPerUser: 'Int @default',
      adaptiveAuthEnabled: 'Boolean @default',
      riskThresholdStepUp: 'Int @default',
      riskThresholdBlock: 'Int @default',
      scimEnabled: 'Boolean @default',
      scimUserAutocreate: 'Boolean @default',
      scimGroupSyncEnabled: 'Boolean @default',
      deletionGracePeriodDays: 'Int @default',
      mtlsClientAuthEnabled: 'Boolean @default',
      mtlsTrustGlobalAnchors: 'Boolean @default',
    },
    secrets: {
      smtpPassword: { type: 'String?', kind: 'encrypted' },
      recaptchaSecretKey: { type: 'String?', kind: 'encrypted' },
      hcaptchaSecretKey: { type: 'String?', kind: 'encrypted' },
    },
    jsonWithSecrets: {
      emailProviderConfig: 'email-provider',
      smsProviderConfig: 'sms-provider',
    },
    refs: { browserFlowId: 'browserFlow: the flow name' },
    excluded: { id: ID, createdAt: CREATED, updatedAt: UPDATED },
  },

  AuthenticationFlow: {
    section: 'authenticationFlows[]',
    fields: {
      name: 'String',
      description: 'String?',
      isDefault: 'Boolean @default',
      steps: 'Json',
    },
    excluded: {
      id: ID,
      realmId: REALM_ID,
      version: 'revision counter of this instance; starts again at 1',
      createdAt: CREATED,
      updatedAt: UPDATED,
    },
  },

  ClientScope: {
    section: 'clientScopes[]',
    fields: {
      name: 'String',
      description: 'String?',
      protocol: 'String @default',
      builtIn: 'Boolean @default',
    },
    excluded: {
      id: ID,
      realmId: REALM_ID,
      createdAt: CREATED,
      updatedAt: UPDATED,
    },
  },

  ProtocolMapper: {
    section: 'clientScopes[].protocolMappers[]',
    fields: {
      name: 'String',
      protocol: 'String @default',
      mapperType: 'String',
      config: 'Json @default',
    },
    excluded: {
      id: ID,
      clientScopeId: 'implied by the scope it is nested in',
      createdAt: CREATED,
      updatedAt: UPDATED,
    },
  },

  Client: {
    section: 'clients[]',
    fields: {
      clientId: 'String',
      clientType: 'ClientType @default',
      name: 'String?',
      description: 'String?',
      enabled: 'Boolean @default',
      requireConsent: 'Boolean @default',
      redirectUris: 'String[]',
      webOrigins: 'String[]',
      grantTypes: 'String[] @default',
      postLogoutRedirectUris: 'String[] @default',
      backchannelLogoutUri: 'String?',
      backchannelLogoutSessionRequired: 'Boolean @default',
      requiredAcr: 'String?',
      stepUpCacheDuration: 'Int @default',
      tokenEndpointAuthMethod: 'TokenEndpointAuthMethod?',
      tlsClientAuthSubjectDn: 'String?',
      tlsClientAuthSanDns: 'String?',
      tlsClientAuthSanUri: 'String?',
      tlsClientAuthSanIp: 'String?',
      tlsClientAuthSanEmail: 'String?',
      tlsClientCertificateBoundAccessTokens: 'Boolean @default',
    },
    secrets: {
      clientSecret: { type: 'String?', kind: 'hash' },
    },
    refs: {
      authFlowId: 'authFlow: the flow name',
      serviceAccountUserId:
        'serviceAccount: the service-account user, by username, with its role and group mappings',
    },
    excluded: {
      id: ID,
      realmId: REALM_ID,
      nhiIdentityId:
        'clients of NHI identities are not exported (listed under "omitted"); the identity and its credentials are not exported either',
      createdAt: CREATED,
      updatedAt: UPDATED,
    },
  },

  ClientDefaultScope: {
    section: 'clients[].defaultScopes[]',
    fields: {},
    refs: {
      clientId: 'implied by the client it is nested in',
      clientScopeId: 'the scope name',
    },
    excluded: { id: ID },
  },

  ClientOptionalScope: {
    section: 'clients[].optionalScopes[]',
    fields: {},
    refs: {
      clientId: 'implied by the client it is nested in',
      clientScopeId: 'the scope name',
    },
    excluded: { id: ID },
  },

  ClientTlsCertificate: {
    section: 'clients[].tlsCertificates[]',
    fields: { certificatePem: 'String' },
    refs: { clientId: 'implied by the client it is nested in' },
    excluded: {
      id: ID,
      realmId: REALM_ID,
      x5tS256: 'derived from certificatePem on import',
      subject: 'derived from certificatePem on import',
      notBefore: 'derived from certificatePem on import',
      notAfter: 'derived from certificatePem on import',
      createdAt: CREATED,
    },
  },

  RealmTlsTrustAnchor: {
    section: 'tlsTrustAnchors[]',
    fields: { certificatePem: 'String' },
    excluded: {
      id: ID,
      realmId: REALM_ID,
      x5tS256: 'derived from certificatePem on import',
      subject: 'derived from certificatePem on import',
      notAfter: 'derived from certificatePem on import',
      createdAt: CREATED,
    },
  },

  TlsRevokedCertificate: {
    section: 'tlsRevokedCertificates[]',
    fields: {
      x5tS256: 'String?',
      issuerDn: 'String?',
      serialNumber: 'String?',
      reason: 'String?',
    },
    excluded: { id: ID, realmId: REALM_ID, createdAt: CREATED },
  },

  Role: {
    section: 'roles[]',
    fields: { name: 'String', description: 'String?' },
    refs: { clientId: 'clientId: the OAuth client_id, null for a realm role' },
    excluded: {
      id: ID,
      realmId: REALM_ID,
      createdAt: CREATED,
      updatedAt: UPDATED,
    },
  },

  Group: {
    section: 'groups[]',
    fields: { name: 'String', description: 'String?' },
    refs: { parentId: 'parentName: the parent group name' },
    excluded: {
      id: ID,
      realmId: REALM_ID,
      createdAt: CREATED,
      updatedAt: UPDATED,
    },
  },

  GroupRole: {
    section: 'groups[].roles[]',
    fields: {},
    refs: {
      groupId: 'implied by the group it is nested in',
      roleId: 'the role, by name and clientId',
    },
    excluded: { id: ID, assignedAt: 'assignment timestamp' },
  },

  IdentityProvider: {
    section: 'identityProviders[]',
    fields: {
      alias: 'String',
      displayName: 'String?',
      enabled: 'Boolean @default',
      providerType: 'String @default',
      clientId: 'String',
      authorizationUrl: 'String',
      tokenUrl: 'String',
      userinfoUrl: 'String?',
      jwksUrl: 'String?',
      issuer: 'String?',
      defaultScopes: 'String @default',
      trustEmail: 'Boolean @default',
      linkOnly: 'Boolean @default',
      syncUserProfile: 'Boolean @default',
      samlConfig: 'Json?',
    },
    secrets: { clientSecret: { type: 'String', kind: 'plain' } },
    excluded: {
      id: ID,
      realmId: REALM_ID,
      createdAt: CREATED,
      updatedAt: UPDATED,
    },
  },

  SamlServiceProvider: {
    section: 'samlServiceProviders[]',
    fields: {
      entityId: 'String',
      name: 'String',
      enabled: 'Boolean @default',
      acsUrl: 'String',
      sloUrl: 'String?',
      certificate: 'String?',
      nameIdFormat: 'String @default',
      signAssertions: 'Boolean @default',
      signResponses: 'Boolean @default',
      attributeStatements: 'Json @default',
      validRedirectUris: 'String[]',
    },
    excluded: {
      id: ID,
      realmId: REALM_ID,
      createdAt: CREATED,
      updatedAt: UPDATED,
    },
  },

  UserFederation: {
    section: 'userFederations[]',
    fields: {
      name: 'String',
      providerType: 'String @default',
      enabled: 'Boolean @default',
      priority: 'Int @default',
      connectionUrl: 'String',
      bindDn: 'String',
      startTls: 'Boolean @default',
      connectionTimeout: 'Int @default',
      usersDn: 'String',
      userObjectClass: 'String @default',
      usernameLdapAttr: 'String @default',
      rdnLdapAttr: 'String @default',
      uuidLdapAttr: 'String @default',
      searchFilter: 'String?',
      syncMode: 'String @default',
      syncPeriod: 'Int @default',
      importEnabled: 'Boolean @default',
      editMode: 'String @default',
    },
    secrets: { bindCredential: { type: 'String', kind: 'plain' } },
    excluded: {
      id: ID,
      realmId: REALM_ID,
      lastSyncAt: 'runtime sync state',
      lastSyncStatus: 'runtime sync state',
      createdAt: CREATED,
      updatedAt: UPDATED,
    },
  },

  UserFederationMapper: {
    section: 'userFederations[].mappers[]',
    fields: {
      name: 'String',
      mapperType: 'String',
      ldapAttribute: 'String',
      userAttribute: 'String',
      config: 'Json @default',
    },
    excluded: {
      id: ID,
      federationId: 'implied by the federation it is nested in',
      createdAt: CREATED,
    },
  },

  Webhook: {
    section: 'webhooks[]',
    fields: {
      url: 'String',
      enabled: 'Boolean @default',
      eventTypes: 'String[] @default',
      description: 'String?',
    },
    secrets: { secret: { type: 'String', kind: 'encrypted-strict' } },
    excluded: {
      id: ID,
      realmId: REALM_ID,
      createdAt: CREATED,
      updatedAt: UPDATED,
    },
  },

  AuditLogStream: {
    section: 'auditLogStreams[]',
    fields: {
      name: 'String',
      streamType: 'String',
      enabled: 'Boolean @default',
      url: 'String?',
      syslogHost: 'String?',
      syslogPort: 'Int?',
      syslogProtocol: 'String @default',
      syslogFacility: 'Int @default',
    },
    // Headers of an HTTP stream usually carry the destination's credentials.
    secrets: { httpHeaders: { type: 'Json?', kind: 'plain' } },
    excluded: {
      id: ID,
      realmId: REALM_ID,
      createdAt: CREATED,
      updatedAt: UPDATED,
    },
  },

  Policy: {
    section: 'policies[]',
    fields: {
      name: 'String',
      description: 'String?',
      enabled: 'Boolean @default',
      effect: 'String @default',
      priority: 'Int @default',
      subjectConditions: 'Json?',
      resourceConditions: 'Json?',
      actionConditions: 'Json?',
      environmentConditions: 'Json?',
      logic: 'String @default',
      // Already the OAuth client_id string, not a row id.
      clientId: 'String?',
    },
    excluded: {
      id: ID,
      realmId: REALM_ID,
      createdAt: CREATED,
      updatedAt: UPDATED,
    },
  },

  CustomAttribute: {
    section: 'customAttributes[]',
    fields: {
      name: 'String',
      displayName: 'String',
      type: 'String @default',
      required: 'Boolean @default',
      showOnRegistration: 'Boolean @default',
      showOnProfile: 'Boolean @default',
      options: 'Json?',
      mapToOidcClaim: 'String?',
      sortOrder: 'Int @default',
    },
    excluded: {
      id: ID,
      realmId: REALM_ID,
      createdAt: CREATED,
      updatedAt: UPDATED,
    },
  },

  ContinuousRiskPolicy: {
    section: 'continuousRiskPolicies[]',
    fields: {
      // Already the OAuth client_id string, not a row id.
      clientId: 'String?',
      name: 'String',
      description: 'String?',
      enabled: 'Boolean @default',
      priority: 'Int @default',
      conditions: 'Json',
      action: 'String @default',
      actionData: 'Json?',
      riskScoreContribution: 'Int @default',
      cooldownSeconds: 'Int @default',
    },
    excluded: {
      id: ID,
      realmId: REALM_ID,
      createdAt: CREATED,
      updatedAt: UPDATED,
    },
  },

  Organization: {
    section: 'organizations[]',
    fields: {
      name: 'String',
      slug: 'String',
      displayName: 'String?',
      description: 'String?',
      enabled: 'Boolean @default',
      logoUrl: 'String?',
      primaryColor: 'String?',
      requireMfa: 'Boolean @default',
      verifiedDomains: 'String[] @default',
    },
    excluded: {
      id: ID,
      realmId: REALM_ID,
      createdAt: CREATED,
      updatedAt: UPDATED,
    },
  },

  OrganizationSsoConnection: {
    section: 'organizations[].ssoConnections[]',
    fields: {
      type: 'String',
      name: 'String',
      enabled: 'Boolean @default',
    },
    // Provider configuration of free shape, which holds client secrets.
    secrets: { config: { type: 'Json', kind: 'plain' } },
    excluded: {
      id: ID,
      organizationId: 'implied by the organization it is nested in',
      createdAt: CREATED,
      updatedAt: UPDATED,
    },
  },

  OrganizationMember: {
    section: 'organizations[].members[] (with includeUsers only)',
    fields: { role: 'String @default' },
    refs: { userId: 'username' },
    excluded: {
      id: ID,
      organizationId: 'implied by the organization it is nested in',
      joinedAt: 'membership timestamp',
    },
  },

  ServiceAccount: {
    section: 'serviceAccounts[]',
    fields: {
      name: 'String',
      description: 'String?',
      enabled: 'Boolean @default',
    },
    excluded: {
      id: ID,
      realmId: REALM_ID,
      createdAt: CREATED,
      updatedAt: UPDATED,
    },
  },

  ScimAttributeMapping: {
    section: 'scimAttributeMappings[]',
    fields: {
      resourceType: 'String',
      scimAttribute: 'String',
      idenplaneAttribute: 'String',
      enabled: 'Boolean @default',
      direction: 'String @default',
    },
    excluded: {
      id: ID,
      realmId: REALM_ID,
      createdAt: CREATED,
      updatedAt: UPDATED,
    },
  },

  RegistrationField: {
    section: 'registrationFields[]',
    fields: {
      name: 'String',
      displayName: 'String',
      type: 'String @default',
      required: 'Boolean @default',
      placeholder: 'String?',
      helpText: 'String?',
      options: 'String[] @default',
      validationPattern: 'String?',
      defaultValue: 'String?',
      sortOrder: 'Int @default',
      enabled: 'Boolean @default',
    },
    excluded: {
      id: ID,
      realmId: REALM_ID,
      createdAt: CREATED,
      updatedAt: UPDATED,
    },
  },

  NhiCredentialPolicy: {
    section: 'nhiCredentialPolicies[]',
    fields: {
      name: 'String',
      description: 'String?',
      enabled: 'Boolean @default',
      priority: 'Int @default',
      credentialType: 'NhiCredentialType @default',
      rotationIntervalDays: 'Int @default',
      rotationBeforeDays: 'Int @default',
      autoRotate: 'Boolean @default',
      maxCredentialAgeDays: 'Int @default',
      maxRequestsPerDay: 'Int?',
      maxRequestsPerMonth: 'Int?',
      rateLimitPerMinute: 'Int?',
      requireCertificate: 'Boolean @default',
      requireIpRestriction: 'Boolean @default',
      requireAuditLogging: 'Boolean @default',
      rotationOverlapSeconds: 'Int @default',
    },
    excluded: {
      id: ID,
      realmId: REALM_ID,
      createdAt: CREATED,
      updatedAt: UPDATED,
    },
  },

  ConsentCategory: {
    section: 'consentCategories[]',
    fields: {
      key: 'String',
      displayName: 'String',
      description: 'String?',
      required: 'Boolean @default',
      configurableByUser: 'Boolean @default',
      showInAccountPortal: 'Boolean @default',
      order: 'Int @default',
      enabled: 'Boolean @default',
      scopes: 'String[] @default',
    },
    excluded: {
      id: ID,
      realmId: REALM_ID,
      createdAt: CREATED,
      updatedAt: UPDATED,
    },
  },

  ConsentPolicy: {
    section: 'consentCategories[].policies[]',
    fields: {
      version: 'String',
      content: 'String?',
      isActive: 'Boolean @default',
      publishedAt: 'DateTime?',
    },
    excluded: {
      id: ID,
      categoryId: 'implied by the category it is nested in',
      createdAt: CREATED,
      updatedAt: UPDATED,
    },
  },

  Theme: {
    section: 'themes[]',
    fields: {
      name: 'String',
      displayName: 'String?',
      description: 'String?',
      themeType: 'String @default',
      published: 'Boolean @default',
      publishedAt: 'DateTime?',
      styles: 'Json @default',
      components: 'Json @default',
      assets: 'Json @default',
      settings: 'Json @default',
    },
    excluded: {
      id: ID,
      realmId: REALM_ID,
      version:
        'counter of the version history, which is not exported; starts again at 1',
      createdBy: 'admin user id of this instance',
      updatedBy: 'admin user id of this instance',
      createdAt: CREATED,
      updatedAt: UPDATED,
    },
  },

  ProxyApplication: {
    section: 'proxyApplications[]',
    fields: {
      slug: 'String',
      name: 'String',
      enabled: 'Boolean @default',
      allowedRedirectUris: 'String[]',
      cookieDomain: 'String',
      cookieTtl: 'Int @default',
      userHeader: 'String @default',
      emailHeader: 'String @default',
      nameHeader: 'String @default',
      groupsHeader: 'String @default',
    },
    refs: { clientId: 'client: the OAuth client_id' },
    excluded: {
      id: ID,
      realmId: REALM_ID,
      createdAt: CREATED,
      updatedAt: UPDATED,
    },
  },

  // ─── Users: only with includeUsers ──────────────────────────────────────

  User: {
    section: 'users[] (with includeUsers only)',
    fields: {
      username: 'String',
      email: 'String?',
      emailVerified: 'Boolean @default',
      firstName: 'String?',
      lastName: 'String?',
      enabled: 'Boolean @default',
    },
    excluded: {
      id: ID,
      realmId: REALM_ID,
      passwordHash: 'credential; users set a password again',
      passwordAlgorithm: 'goes with passwordHash',
      federationLink:
        'id of an LDAP entry link; re-established by the next federation sync',
      phoneNumber: 'enrolled SMS factor (encrypted); users enrol again',
      passwordChangedAt: 'credential state',
      lockedUntil: 'brute-force runtime state',
      createdAt: CREATED,
      updatedAt: UPDATED,
    },
  },

  UserRole: {
    section: 'users[].roles[]',
    fields: {},
    refs: {
      userId: 'implied by the user it is nested in',
      roleId: 'the role, by name and clientId',
    },
    excluded: { id: ID, assignedAt: 'assignment timestamp' },
  },

  UserGroup: {
    section: 'users[].groups[]',
    fields: {},
    refs: {
      userId: 'implied by the user it is nested in',
      groupId: 'the group name',
    },
    excluded: { id: ID, assignedAt: 'assignment timestamp' },
  },

  UserAttribute: {
    section: 'users[].attributes (custom attribute name → value)',
    fields: { value: 'String' },
    refs: {
      userId: 'implied by the user it is nested in',
      attributeId: 'the custom attribute name',
    },
    excluded: { id: ID, createdAt: CREATED, updatedAt: UPDATED },
  },
} as const satisfies Record<string, ModelExportSpec>;

export type ExportedModel = keyof typeof EXPORT_MODELS;

const RUNTIME = 'runtime state, never exported';
const SECRET = 'credentials, never exported';
const LOG = 'event log, never exported';

/** Every schema model that is not exported, with the reason. */
export const EXCLUDED_MODELS: Record<string, string> = {
  // Not realm data at all.
  WizardState: 'instance setup wizard, not realm data',
  InstalledPlugin: 'instance-wide plugin registry, not realm data',
  UpgradeAuditLog: 'instance upgrade log, not realm data',
  RateLimitEntry: 'instance-wide rate limit counters',
  RevokedToken: 'token deny-list; ' + RUNTIME,
  AdminRevokedToken: 'admin token deny-list; ' + RUNTIME,
  PendingAction: 'in-flight login/MFA/consent state; ' + RUNTIME,
  StepUpRecord: 'step-up session state; ' + RUNTIME,

  // Keys and credentials.
  RealmSigningKey:
    'private signing keys never leave the instance; the target realm gets a new key pair',
  UserCredential: 'TOTP/SMS factors; ' + SECRET,
  RecoveryCode: 'MFA recovery codes; ' + SECRET,
  WebAuthnCredential: 'passkeys; ' + SECRET,
  ApiKey: 'service account API keys (hashes); ' + SECRET,
  ScimProvisioningToken: 'SCIM bearer tokens (hashes); ' + SECRET,
  NhiCredential: 'NHI keys and certificates; ' + SECRET,
  PasswordHistory: 'old password hashes; ' + SECRET,
  NhiIdentity:
    'non-human identities are identity data like users, and useless without their credentials; their OAuth clients are listed under "omitted"',

  // Sessions, tokens and one-time codes.
  Session: RUNTIME,
  RefreshToken: RUNTIME,
  AuthorizationCode: RUNTIME,
  LoginSession: RUNTIME,
  UserConsent: 'per-user consent grants; ' + RUNTIME,
  VerificationToken: RUNTIME,
  MagicLinkRequest: RUNTIME,
  UsedTotpCode: RUNTIME,
  DeviceCode: RUNTIME,
  OtpAttempt: RUNTIME,
  ImpersonationSession: RUNTIME,
  ProxySession: RUNTIME,
  OrganizationInvitation: 'pending invitations carry live tokens; ' + RUNTIME,
  PendingDeletion: 'scheduled account deletions; ' + RUNTIME,

  // Counters, risk state and logs.
  LoginFailure: 'brute-force counters; ' + RUNTIME,
  TotpFailureTracking: 'brute-force counters; ' + RUNTIME,
  WebAuthnFailureTracking: 'brute-force counters; ' + RUNTIME,
  LoginRiskAssessment: LOG,
  UserLoginProfile: 'learned login behaviour; ' + RUNTIME,
  SessionRiskProfile: RUNTIME,
  DevicePostureRecord: RUNTIME,
  NetworkContextRecord: RUNTIME,
  BehavioralBiometricProfile: 'learned behaviour; ' + RUNTIME,
  BehavioralSample: RUNTIME,
  ContinuousRiskEvent: LOG,
  NhiUsageStats: RUNTIME,
  LoginEvent: LOG,
  AdminEvent: LOG,
  NhiAuditLog: LOG,
  SmsDeliveryLog: LOG,
  WebhookDelivery: LOG,
  WebhookEvent: 'webhook outbox queue; ' + RUNTIME,
  FederatedIdentity:
    'links of users to external accounts; re-created at their next federated sign-in',
  UserConsentHistory: LOG,
  ThemeVersion: 'theme version history; only the current theme is exported',
};
