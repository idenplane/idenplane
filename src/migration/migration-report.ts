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
  startedAt: Date;
  completedAt: Date;
  summary: {
    realms: MigrationEntityStats;
    users: MigrationEntityStats;
    clients: MigrationEntityStats;
    roles: MigrationEntityStats;
    groups: MigrationEntityStats;
    scopes: MigrationEntityStats;
    identityProviders: MigrationEntityStats;
  };
  errors: MigrationError[];
  warnings: MigrationWarning[];
}

export function createEmptyReport(
  source: 'keycloak' | 'auth0',
  dryRun: boolean,
): MigrationReport {
  const zero = (): MigrationEntityStats => ({
    created: 0,
    skipped: 0,
    failed: 0,
  });
  return {
    source,
    dryRun,
    startedAt: new Date(),
    completedAt: new Date(),
    summary: {
      realms: zero(),
      users: zero(),
      clients: zero(),
      roles: zero(),
      groups: zero(),
      scopes: zero(),
      identityProviders: zero(),
    },
    errors: [],
    warnings: [],
  };
}
