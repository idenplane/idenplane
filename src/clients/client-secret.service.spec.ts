import { ClientSecretService } from './client-secret.service.js';
import { CryptoService } from '../crypto/crypto.service.js';

describe('ClientSecretService', () => {
  const crypto = new CryptoService();
  const secret = crypto.generateSecret();
  let prisma: { client: { updateMany: jest.Mock } };
  let cache: { invalidateClientCache: jest.Mock };
  let service: ClientSecretService;

  const client = (clientSecret: string | null) => ({
    id: 'row-1',
    realmId: 'realm-1',
    clientId: 'app',
    clientSecret,
  });

  beforeEach(() => {
    prisma = {
      client: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    cache = { invalidateClientCache: jest.fn().mockResolvedValue(undefined) };
    service = new ClientSecretService(prisma as any, crypto, cache as any);
  });

  it('accepts the right secret and leaves a current hash alone', async () => {
    const stored = await crypto.hashSecret(secret);
    expect(await service.verify(client(stored), secret)).toBe(true);
    expect(prisma.client.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a wrong secret, and a client with none', async () => {
    const stored = await crypto.hashSecret(secret);
    expect(await service.verify(client(stored), crypto.generateSecret())).toBe(
      false,
    );
    expect(await service.verify(client(null), secret)).toBe(false);
    expect(prisma.client.updateMany).not.toHaveBeenCalled();
  });

  it('moves an Argon2 hash to the fast format, only if the row still holds it', async () => {
    const legacy = await crypto.hashPassword(secret);
    expect(await service.verify(client(legacy), secret)).toBe(true);

    expect(prisma.client.updateMany).toHaveBeenCalledWith({
      // An admin regenerating the secret mid-request changes the row; the
      // condition stops the old secret's hash from being written back.
      where: { id: 'row-1', clientSecret: legacy },
      data: { clientSecret: `sha256$${crypto.sha256(secret)}` },
    });
    expect(cache.invalidateClientCache).toHaveBeenCalledWith('realm-1:app');
  });

  it('does not touch the cache when the row had changed', async () => {
    prisma.client.updateMany.mockResolvedValue({ count: 0 });
    const legacy = await crypto.hashPassword(secret);
    expect(await service.verify(client(legacy), secret)).toBe(true);
    expect(cache.invalidateClientCache).not.toHaveBeenCalled();
  });

  it('still authenticates when the upgrade write fails', async () => {
    prisma.client.updateMany.mockRejectedValue(new Error('db down'));
    const legacy = await crypto.hashPassword(secret);
    expect(await service.verify(client(legacy), secret)).toBe(true);
  });
});
