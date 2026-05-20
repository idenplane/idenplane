export interface CliConfig {
  serverUrl: string;
  accessToken: string;
  apiKey?: string;
  defaultRealm?: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface UserListResponse {
  users: UserResponse[];
  total: number;
}

export interface UserResponse {
  id: string;
  username: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  enabled: boolean;
  emailVerified: boolean;
  createdAt: string;
}

export interface RealmResponse {
  id: string;
  name: string;
  displayName: string | null;
  enabled: boolean;
  createdAt: string;
}

export interface ClientResponse {
  id: string;
  clientId: string;
  name: string | null;
  clientType: string;
  enabled: boolean;
  clientSecret?: string;
  redirectUris: string[];
  grantTypes: string[];
}

export interface RoleResponse {
  id: string;
  name: string;
  description: string | null;
}

export interface GroupResponse {
  id: string;
  name: string;
  path: string;
  memberCount?: number;
}

export interface GroupListResponse {
  groups: GroupResponse[];
  total: number;
}

export interface BulkImportResult {
  imported: number;
  failed: number;
  errors: Array<{ row: number; username?: string; error: string }>;
}

export interface BulkUserInput {
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  password?: string;
  enabled?: boolean;
}

export interface MigrationEntityStats {
  created: number;
  skipped: number;
  failed: number;
}

export interface MigrationError {
  entity: string;
  name: string;
  error: string;
}

export interface MigrationWarning {
  entity: string;
  message: string;
}

export interface MigrationReport {
  source: 'keycloak' | 'auth0';
  dryRun: boolean;
  startedAt: string;
  completedAt: string;
  summary: Record<string, MigrationEntityStats>;
  errors: MigrationError[];
  warnings: MigrationWarning[];
}
