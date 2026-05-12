export interface Auth0User {
  user_id?: string;
  email?: string;
  email_verified?: boolean;
  username?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  blocked?: boolean;
  password_hash?: string;
  custom_password_hash?: {
    algorithm: string;
    hash: { value: string; encoding: string };
    salt?: { value: string; position: string };
  };
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
}

export interface Auth0Client {
  client_id: string;
  name?: string;
  client_secret?: string;
  app_type?: string;
  callbacks?: string[];
  allowed_origins?: string[];
  grant_types?: string[];
  token_endpoint_auth_method?: string;
  is_first_party?: boolean;
}

export interface Auth0Connection {
  name: string;
  strategy: string;
  enabled_clients?: string[];
  options?: Record<string, unknown>;
}

export interface Auth0Role {
  name: string;
  description?: string;
  permissions?: Array<{
    permission_name: string;
    resource_server_identifier: string;
  }>;
}

export interface Auth0Organization {
  name: string;
  display_name?: string;
  branding?: { logo_url?: string; colors?: Record<string, string> };
  members?: Array<{ user_id: string; roles?: string[] }>;
}

export interface Auth0Export {
  users?: Auth0User[];
  clients?: Auth0Client[];
  connections?: Auth0Connection[];
  roles?: Auth0Role[];
  organizations?: Auth0Organization[];
}
