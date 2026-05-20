/**
 * Supported database providers.
 *
 * The active provider is derived at startup from the DATABASE_URL environment
 * variable by inspecting its scheme prefix:
 *
 *   postgresql:// or postgres://  → DatabaseProvider.POSTGRESQL
 *   mysql://                      → DatabaseProvider.MYSQL
 *   file:                         → DatabaseProvider.SQLITE
 */
export enum DatabaseProvider {
  POSTGRESQL = 'postgresql',
  MYSQL = 'mysql',
  SQLITE = 'sqlite',
}

/**
 * Derives the database provider from a connection-URL string.
 *
 * @param url - The value of the DATABASE_URL environment variable.
 * @returns   The matching DatabaseProvider enum member.
 * @throws    Error when the scheme is not recognised.
 *
 * @example
 *   detectProvider('postgresql://user:pass@localhost:5432/idenplane')
 *   // → DatabaseProvider.POSTGRESQL
 *
 *   detectProvider('mysql://user:pass@localhost:3306/idenplane')
 *   // → DatabaseProvider.MYSQL
 *
 *   detectProvider('file:./dev.db')
 *   // → DatabaseProvider.SQLITE
 */
export function detectProvider(url: string): DatabaseProvider {
  if (!url || url.trim() === '') {
    throw new Error(
      'DATABASE_URL is not set. ' +
        'Provide a valid connection URL (postgresql://, mysql://, or file:).',
    );
  }

  const lower = url.trim().toLowerCase();

  if (lower.startsWith('postgresql://') || lower.startsWith('postgres://')) {
    return DatabaseProvider.POSTGRESQL;
  }

  if (lower.startsWith('mysql://')) {
    return DatabaseProvider.MYSQL;
  }

  if (lower.startsWith('file:')) {
    return DatabaseProvider.SQLITE;
  }

  throw new Error(
    `Unrecognised DATABASE_URL scheme: "${url.split(':')[0]}". ` +
      'Supported schemes: postgresql://, postgres://, mysql://, file:',
  );
}
