/**
 * A credential in a Keycloak realm export. Keycloak 7+ writes `secretData`
 * and `credentialData` (JSON strings); older exports have the hash fields
 * directly on the credential.
 */
export interface KeycloakCredential {
  type: string;
  value?: string;
  /** Keycloak 7+: JSON `{"value":"<base64 hash>","salt":"<base64 salt>"}`. */
  secretData?: string;
  /** Keycloak 7+: JSON `{"hashIterations":n,"algorithm":"pbkdf2-sha256",…}`. */
  credentialData?: string;
  hashedSaltedValue?: string;
  salt?: string;
  hashIterations?: number;
  algorithm?: string;
  temporary?: boolean;
}

export interface KeycloakUser {
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  enabled?: boolean;
  emailVerified?: boolean;
  credentials?: KeycloakCredential[];
  realmRoles?: string[];
  clientRoles?: Record<string, string[]>;
  groups?: string[];
  attributes?: Record<string, string[]>;
}

export interface KeycloakClient {
  clientId: string;
  name?: string;
  enabled?: boolean;
  publicClient?: boolean;
  secret?: string;
  redirectUris?: string[];
  webOrigins?: string[];
  standardFlowEnabled?: boolean;
  implicitFlowEnabled?: boolean;
  directAccessGrantsEnabled?: boolean;
  serviceAccountsEnabled?: boolean;
  consentRequired?: boolean;
  protocol?: string;
  defaultClientScopes?: string[];
  optionalClientScopes?: string[];
}

export interface KeycloakRole {
  name: string;
  description?: string;
  composite?: boolean;
  composites?: { realm?: string[]; client?: Record<string, string[]> };
}

export interface KeycloakGroup {
  name: string;
  path?: string;
  subGroups?: KeycloakGroup[];
  realmRoles?: string[];
  clientRoles?: Record<string, string[]>;
}

export interface KeycloakProtocolMapper {
  name: string;
  protocol: string;
  protocolMapper: string;
  consentRequired?: boolean;
  config?: Record<string, string>;
}

export interface KeycloakClientScope {
  name: string;
  description?: string;
  protocol?: string;
  protocolMappers?: KeycloakProtocolMapper[];
}

export interface KeycloakIdentityProvider {
  alias: string;
  providerId: string;
  enabled?: boolean;
  trustEmail?: boolean;
  config?: Record<string, string>;
  displayName?: string;
}

export interface KeycloakSmtpServer {
  host?: string;
  port?: string;
  from?: string;
  fromDisplayName?: string;
  ssl?: string;
  starttls?: string;
  auth?: string;
  user?: string;
  password?: string;
}

export interface KeycloakRealmExport {
  realm: string;
  displayName?: string;
  enabled?: boolean;
  registrationAllowed?: boolean;
  accessTokenLifespan?: number;
  ssoSessionMaxLifespan?: number;
  ssoSessionIdleTimeout?: number;
  refreshTokenMaxReuse?: number;
  offlineSessionMaxLifespan?: number;
  smtpServer?: KeycloakSmtpServer;
  passwordPolicy?: string;
  bruteForceProtected?: boolean;
  maxFailureWaitSeconds?: number;
  failureFactor?: number;
  users?: KeycloakUser[];
  clients?: KeycloakClient[];
  roles?: {
    realm?: KeycloakRole[];
    client?: Record<string, KeycloakRole[]>;
  };
  groups?: KeycloakGroup[];
  clientScopes?: KeycloakClientScope[];
  identityProviders?: KeycloakIdentityProvider[];
  defaultDefaultClientScopes?: string[];
  defaultOptionalClientScopes?: string[];
}
