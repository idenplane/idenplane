import { createHash } from 'node:crypto';
import { RecoveryCodeRewrapService } from './recovery-code-rewrap.service.js';
import { isOldFormatRecoveryCodeHash } from './recovery-codes.js';

const sha = (v: string) => createHash('sha256').update(v).digest('hex');

describe('RecoveryCodeRewrapService', () => {
  function setup(rows: Array<{ id: string; codeHash: string }>) {
    const store = new Map(rows.map((r) => [r.id, { ...r, used: false }]));
    const prisma = {
      onBeforeDisconnect: jest.fn(),
      recoveryCode: {
        findMany: jest.fn(
          async (args: {
            where: { id?: { gt: string } };
            take: number;
          }) => {
            const gt = args.where.id?.gt;
            return [...store.values()]
              .filter((r) => !r.used && !r.codeHash.startsWith('rc'))
              .filter((r) => (gt ? r.id > gt : true))
              .sort((a, b) => a.id.localeCompare(b.id))
              .slice(0, args.take)
              .map(({ id, codeHash }) => ({ id, codeHash }));
          },
        ),
        updateMany: jest.fn(
          async (args: {
            where: { id: string; codeHash: string };
            data: { codeHash: string };
          }) => {
            const row = store.get(args.where.id);
            if (!row || row.used || row.codeHash !== args.where.codeHash) {
              return { count: 0 };
            }
            row.codeHash = args.data.codeHash;
            return { count: 1 };
          },
        ),
      },
    };
    const crypto = {
      hashPassword: jest.fn(async (v: string) => `$argon2id$fake$${v}`),
    };
    const service = new RecoveryCodeRewrapService(
      prisma as never,
      crypto as never,
    );
    return { service, store, prisma, crypto };
  }

  it('wraps every unused old hash in Argon2id and leaves new ones alone', async () => {
    const old = sha('abcd1234');
    const { service, store, crypto } = setup([
      { id: 'a', codeHash: old },
      { id: 'b', codeHash: 'rc2$' + sha('x') },
    ]);

    expect(await service.run()).toBe(1);

    expect(store.get('a')!.codeHash).toBe(`rc1a$$argon2id$fake$${old}`);
    expect(isOldFormatRecoveryCodeHash(store.get('a')!.codeHash)).toBe(true);
    expect(store.get('b')!.codeHash).toBe('rc2$' + sha('x'));
    expect(crypto.hashPassword).toHaveBeenCalledTimes(1);
  });

  it('walks past a full batch', async () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({
      id: String(i).padStart(4, '0'),
      codeHash: sha(String(i)),
    }));
    const { service, store } = setup(rows);

    expect(await service.run()).toBe(120);
    expect(
      [...store.values()].every((r) => r.codeHash.startsWith('rc1a$')),
    ).toBe(true);
  });

  it('does nothing, at the cost of one query, when every hash is current', async () => {
    const { service, prisma, crypto } = setup([]);
    expect(await service.run()).toBe(0);
    expect(prisma.recoveryCode.findMany).toHaveBeenCalledTimes(1);
    expect(crypto.hashPassword).not.toHaveBeenCalled();
  });

  it('leaves a row another process changed in the meantime', async () => {
    const { service, store, prisma } = setup([
      { id: 'a', codeHash: sha('abcd1234') },
    ]);
    prisma.recoveryCode.updateMany.mockImplementationOnce(async () => {
      store.get('a')!.used = true; // redeemed meanwhile
      return { count: 0 };
    });
    expect(await service.run()).toBe(0);
  });

  it('stops between rows when the application shuts down', async () => {
    const { service, crypto } = setup([
      { id: 'a', codeHash: sha('1') },
      { id: 'b', codeHash: sha('2') },
    ]);
    crypto.hashPassword.mockImplementationOnce(async (v: string) => {
      void service.onModuleDestroy();
      return `$argon2id$fake$${v}`;
    });
    expect(await service.run()).toBe(1);
  });
});
