/**
 * A CachedLookupsService for unit tests that asks the given Prisma mock
 * directly, the way the service does on a cache miss, so a spec's
 * `prisma.client.findUnique` / `prisma.realmSigningKey.findFirst` mocks keep
 * driving the code under test.
 */
export const lookupsBackedBy = (prisma: {
  client: { findUnique: (...args: unknown[]) => unknown };
  realmSigningKey: { findFirst: (...args: unknown[]) => unknown };
  user?: { findUnique: (...args: unknown[]) => unknown };
}) => ({
  client: (realmId: string, clientId: string) =>
    prisma.client.findUnique({
      where: { realmId_clientId: { realmId, clientId } },
    }),
  activeSigningKey: (realmId: string) =>
    prisma.realmSigningKey.findFirst({
      where: { realmId, active: true },
      orderBy: { createdAt: 'desc' },
    }),
  userProfile: (userId: string) =>
    prisma.user?.findUnique({ where: { id: userId } }) ?? null,
  userGrants: (_userId: string, load: () => Promise<unknown>) => load(),
  scopeMappers: (
    _realmId: string,
    _scopes: string[],
    load: () => Promise<unknown>,
  ) => load(),
});
