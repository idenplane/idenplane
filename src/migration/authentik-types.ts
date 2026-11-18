/**
 * Shapes below mirror the JSON returned by Authentik's REST API
 * (`/api/v3/core/users/`, `/api/v3/core/groups/`,
 * `/api/v3/providers/oauth2/`, `/api/v3/sources/oauth/`). Authentik has no
 * single "export realm" endpoint, so an import file is the four list
 * responses side by side. Each section may be the plain `results` array or
 * a whole paginated response (`{ pagination, results }`); see
 * authentik-export.ts, which validates and unwraps them.
 *
 * Password hashes are not in the API: `password` comes from the
 * `authentik_core_user` table and is merged in by the operator.
 *
 * Applications are deliberately not part of this shape: an Application just
 * links a slug/launch URL to a Provider for Authentik's own UI, and every
 * field this importer needs for a client (client_id, secret, redirect URIs)
 * already lives on the Provider itself.
 */

export interface AuthentikUser {
  pk: number;
  username: string;
  /** Authentik returns `""` for a user without an address. */
  email?: string | null;
  /** Authentik's "name" field is a single display name, not given/family. */
  name?: string;
  is_active?: boolean;
  /**
   * The user's groups: Authentik's API lists group pks (UUIDs); group names
   * are accepted too. Each is resolved against the `groups` section.
   */
  groups?: string[];
  /** 'internal' | 'external' | 'service_account' | 'internal_service_account' */
  type?: string;
  attributes?: Record<string, unknown>;
  /**
   * Django-format hash from the database. Carried over:
   * `pbkdf2_sha256$…`, `pbkdf2_sha1$…`, `argon2$argon2id$…` and
   * `bcrypt$$2b$…` (see authentikPassword in password-import.ts). Anything
   * else is dropped with a warning and the user resets their password.
   */
  password?: string;
}

export interface AuthentikGroup {
  /** A UUID string in Authentik. */
  pk: string;
  name: string;
  /** pk of the parent group, or null for a top-level group. */
  parent?: string | null;
  is_superuser?: boolean;
  /** pks of RBAC roles assigned to the group. */
  roles?: string[];
  attributes?: Record<string, unknown>;
}

/** One entry of a provider's `redirect_uris` (Authentik 2024.10 and later). */
export interface AuthentikRedirectUri {
  /** 'strict' | 'regex' */
  matching_mode?: string;
  url: string;
}

export interface AuthentikOAuth2Provider {
  pk: number;
  name: string;
  client_id: string;
  client_secret?: string;
  /** 'confidential' | 'public' */
  client_type?: string;
  /**
   * A newline-separated string (before Authentik 2024.10), a list of
   * `{ matching_mode, url }` (since), or a list of URL strings.
   */
  redirect_uris?: string | (string | AuthentikRedirectUri)[];
}

export interface AuthentikOAuthSource {
  /** A UUID string in Authentik. */
  pk: string | number;
  name: string;
  /** URL-safe identifier; becomes the identity provider alias. */
  slug?: string;
  /** Only 'openidconnect'/'oidc' sources are imported; SAML sources (no signing certificate in the export) and social ones are skipped with a warning. */
  provider_type?: string;
  authorization_url?: string | null;
  access_token_url?: string | null;
  /** The user-info endpoint. */
  profile_url?: string | null;
  oidc_jwks_url?: string | null;
  oidc_well_known_url?: string | null;
  consumer_key?: string;
  consumer_secret?: string;
}

export interface AuthentikExport {
  users?: AuthentikUser[];
  groups?: AuthentikGroup[];
  providers?: AuthentikOAuth2Provider[];
  sources?: AuthentikOAuthSource[];
}
