import { CachedLookupsService } from './cached-lookups.service.js';

const makeCache = () => {
  const rows = new Map<string, unknown>();
  return {
    rows,
    getLocalClientRow: jest.fn(
      (r: string, c: string) => rows.get(`c:${r}:${c}`) ?? null,
    ),
    setLocalClientRow: jest.fn((r: string, c: string, v: unknown) =>
      rows.set(`c:${r}:${c}`, v),
    ),
    getLocalSigningKey: jest.fn((r: string) => rows.get(`k:${r}`) ?? null),
    setLocalSigningKey: jest.fn((r: string, v: unknown) =>
      rows.set(`k:${r}`, v),
    ),
  };
};

describe('CachedLookupsService', () => {
  const client = { id: 'c1', realmId: 'r1', clientId: 'app', enabled: true };
  const key = { id: 'k1', realmId: 'r1', kid: 'kid-1', active: true };
  let prisma: {
    client: { findUnique: jest.Mock };
    realmSigningKey: { findFirst: jest.Mock };
  };
  let cache: ReturnType<typeof makeCache>;
  let lookups: CachedLookupsService;

  beforeEach(() => {
    prisma = {
      client: { findUnique: jest.fn().mockResolvedValue(client) },
      realmSigningKey: { findFirst: jest.fn().mockResolvedValue(key) },
    };
    cache = makeCache();
    lookups = new CachedLookupsService(prisma as any, cache as any);
  });

  it('reads a client from the database once, then from the cache', async () => {
    expect(await lookups.client('r1', 'app')).toEqual(client);
    expect(await lookups.client('r1', 'app')).toEqual(client);
    expect(prisma.client.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.client.findUnique).toHaveBeenCalledWith({
      where: { realmId_clientId: { realmId: 'r1', clientId: 'app' } },
    });
  });

  it('does not cache a client that does not exist', async () => {
    prisma.client.findUnique.mockResolvedValue(null);
    expect(await lookups.client('r1', 'nope')).toBeNull();
    expect(cache.setLocalClientRow).not.toHaveBeenCalled();
  });

  it('reads the newest active signing key once, then from the cache', async () => {
    expect(await lookups.activeSigningKey('r1')).toEqual(key);
    expect(await lookups.activeSigningKey('r1')).toEqual(key);
    expect(prisma.realmSigningKey.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.realmSigningKey.findFirst).toHaveBeenCalledWith({
      where: { realmId: 'r1', active: true },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('does not cache a realm without a signing key', async () => {
    prisma.realmSigningKey.findFirst.mockResolvedValue(null);
    expect(await lookups.activeSigningKey('r1')).toBeNull();
    expect(cache.setLocalSigningKey).not.toHaveBeenCalled();
  });
});
