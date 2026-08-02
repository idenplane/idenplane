/**
 * Shapes below mirror the JSON returned by Zitadel's Management API v1
 * (protobuf-JSON mapping, lowerCamelCase field names) for `ListUsers`,
 * `ListProjects`/`ListProjectRoles`/`ListApps`, and `ListIDPs`. Zitadel has no
 * single "export realm" endpoint the way Keycloak does, so an export file for
 * this importer is expected to be hand-assembled by calling those endpoints
 * and combining the results into the `ZitadelExport` shape below.
 */

export interface ZitadelHumanProfile {
  givenName?: string;
  familyName?: string;
  displayName?: string;
}

export interface ZitadelHumanEmail {
  email?: string;
  isVerified?: boolean;
}

export interface ZitadelHashedPassword {
  hash?: string;
  /** Only 'bcrypt' is recognized for import today; anything else is dropped with a warning. */
  algorithm?: string;
}

export interface ZitadelUser {
  userId: string;
  username?: string;
  state?: string;
  human?: {
    profile?: ZitadelHumanProfile;
    email?: ZitadelHumanEmail;
    hashedPassword?: ZitadelHashedPassword;
  };
  /** Service-account users — not imported as regular users, see importUsers(). */
  machine?: {
    name?: string;
  };
}

export interface ZitadelProjectRole {
  key: string;
  displayName?: string;
}

export interface ZitadelOidcConfig {
  clientId?: string;
  clientSecret?: string;
  redirectUris?: string[];
  /** e.g. 'OIDC_APP_TYPE_WEB' | 'OIDC_APP_TYPE_NATIVE' | 'OIDC_APP_TYPE_USER_AGENT' */
  appType?: string;
  /** e.g. 'OIDC_AUTH_METHOD_TYPE_BASIC' | 'OIDC_AUTH_METHOD_TYPE_NONE' */
  authMethodType?: string;
  /** e.g. 'OIDC_GRANT_TYPE_AUTHORIZATION_CODE' | 'OIDC_GRANT_TYPE_REFRESH_TOKEN' | 'OIDC_GRANT_TYPE_DEVICE_CODE' */
  grantTypes?: string[];
}

export interface ZitadelApplication {
  appId: string;
  name?: string;
  /** Only OIDC apps are imported today; SAML apps are skipped with a warning. */
  oidcConfig?: ZitadelOidcConfig;
  samlConfig?: Record<string, unknown>;
}

export interface ZitadelProject {
  projectId: string;
  name?: string;
  roles?: ZitadelProjectRole[];
  apps?: ZitadelApplication[];
}

export interface ZitadelIdp {
  idpId: string;
  name?: string;
  /** e.g. 'IDP_TYPE_OIDC' | 'IDP_TYPE_SAML' | 'IDP_TYPE_GOOGLE' | 'IDP_TYPE_GITHUB' */
  type?: string;
  oidcConfig?: {
    issuer?: string;
    clientId?: string;
    clientSecret?: string;
    authorizationEndpoint?: string;
    tokenEndpoint?: string;
  };
}

export interface ZitadelExport {
  users?: ZitadelUser[];
  projects?: ZitadelProject[];
  idps?: ZitadelIdp[];
}
