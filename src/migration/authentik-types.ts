/**
 * Shapes below mirror the JSON returned by Authentik's REST API
 * (`/api/v3/core/users/`, `/api/v3/core/groups/`,
 * `/api/v3/providers/oauth2/`, `/api/v3/sources/oauth/`). Like Zitadel,
 * Authentik has no single "export realm" endpoint, so an export file for
 * this importer is expected to be hand-assembled by calling those endpoints
 * and combining the results into the `AuthentikExport` shape below.
 *
 * Applications are deliberately not part of this shape: an Application just
 * links a slug/launch URL to a Provider for Authentik's own UI, and every
 * field this importer needs for a client (client_id, secret, redirect URIs)
 * already lives on the Provider itself.
 */

export interface AuthentikUser {
  pk: number;
  username: string;
  email?: string;
  /** Authentik's "name" field is a single display name, not given/family. */
  name?: string;
  is_active?: boolean;
  /** Group names this user belongs to (resolved client-side when assembling the export, not group PKs). */
  groups?: string[];
  /**
   * Django-format hash (e.g. "pbkdf2_sha256$...", "argon2$..."). Only
   * argon2 is recognized for import today — anything else is dropped with
   * a warning, same policy as unsupported hashes in the other importers.
   */
  password?: string;
}

export interface AuthentikGroup {
  pk: number;
  name: string;
}

export interface AuthentikOAuth2Provider {
  pk: number;
  name: string;
  client_id: string;
  client_secret?: string;
  /** 'confidential' | 'public' */
  client_type?: string;
  redirect_uris?: string[];
}

export interface AuthentikOAuthSource {
  pk: number;
  name: string;
  /** Only 'openidconnect'/'oidc' sources are imported today; other provider types (SAML, social) are skipped with a warning. */
  provider_type?: string;
  authorization_url?: string;
  access_token_url?: string;
  consumer_key?: string;
  consumer_secret?: string;
}

export interface AuthentikExport {
  users?: AuthentikUser[];
  groups?: AuthentikGroup[];
  providers?: AuthentikOAuth2Provider[];
  sources?: AuthentikOAuthSource[];
}
