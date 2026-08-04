import apiClient from './client';

export type MigrationSource = 'keycloak' | 'auth0' | 'zitadel' | 'authentik';

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
  source: MigrationSource;
  dryRun: boolean;
  startedAt: string;
  completedAt: string;
  summary: Record<string, MigrationEntityStats>;
  errors: MigrationError[];
  warnings: MigrationWarning[];
}

export async function runMigration(
  source: MigrationSource,
  data: Record<string, unknown>,
  targetRealm: string,
  dryRun: boolean,
): Promise<MigrationReport> {
  const { data: report } = await apiClient.post<MigrationReport>(`/migration/${source}`, {
    data,
    targetRealm,
    dryRun,
  });
  return report;
}
