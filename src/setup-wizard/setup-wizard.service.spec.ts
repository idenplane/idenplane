jest.mock('../crypto/jwk.service.js', () => ({ JwkService: jest.fn() }));

import { BadRequestException, ConflictException } from '@nestjs/common';
import type { WizardState } from '@prisma/client';
import {
  SETUP_COMPLETE_MESSAGE,
  SetupWizardService,
} from './setup-wizard.service.js';

function row(overrides: Partial<WizardState> = {}): WizardState {
  return {
    id: 'wizard',
    completed: false,
    skipped: false,
    currentStep: 0,
    adminUsername: null,
    adminEmail: null,
    adminPasswordHash: null,
    realmName: null,
    realmDisplayName: null,
    smtpConfig: null,
    clientId: null,
    clientSecret: null,
    redirectUris: [],
    sdkGenerated: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  } as WizardState;
}

/**
 * A Prisma stand-in. `outside` is the state row as a read outside the
 * transaction sees it, `locked` as the read under the row lock sees it, so a
 * test can model another request completing the wizard in between.
 */
function createPrisma(initial: WizardState) {
  const db = { outside: initial, locked: initial };
  const prisma = {
    wizardState: {
      findFirst: jest.fn(async () => db.outside),
      findUniqueOrThrow: jest.fn(async () => db.locked),
      create: jest.fn(),
      update: jest.fn(async ({ data }: { data: Partial<WizardState> }) => {
        db.locked = { ...db.locked, ...data } as WizardState;
        db.outside = db.locked;
        return db.locked;
      }),
      deleteMany: jest.fn(),
    },
    realm: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async ({ data }: { data: { name: string } }) => ({
        id: 'realm-1',
        name: data.name,
      })),
      count: jest.fn(async () => 1),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    role: { create: jest.fn(async () => ({ id: 'role-1' })) },
    user: {
      create: jest.fn(async () => ({ id: 'user-1' })),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    userRole: { create: jest.fn(async () => ({})) },
    client: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async () => ({})),
    },
    clientScope: {
      findUnique: jest.fn(async () => ({ id: 'scope' })),
      create: jest.fn(),
    },
    $queryRaw: jest.fn(async () => [{ id: 'wizard' }]),
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(
    async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma),
  );
  return { prisma, db };
}

const ADMIN = {
  username: 'owner',
  email: 'o@example.com',
  password: 'Passw0rdOk',
};
const REALM = { name: 'acme', displayName: 'Acme' };
const SMTP = { host: 'smtp.example.com', port: 587, from: 'no@example.com' };
const CLIENT = { clientId: 'my-app', redirectUris: ['https://app.example/cb'] };

describe('SetupWizardService', () => {
  let crypto: Record<string, jest.Mock>;
  let jwk: { generateRsaKeyPair: jest.Mock };

  const build = (state: WizardState) => {
    const { prisma, db } = createPrisma(state);
    const service = new SetupWizardService(
      prisma as never,
      crypto as never,
      jwk as never,
    );
    return { service, prisma, db };
  };

  beforeEach(() => {
    crypto = {
      hashPassword: jest.fn(async () => 'argon-hash'),
      hashSecret: jest.fn(async () => 'secret-hash'),
      generateSecret: jest.fn(() => 'plain-secret'),
      encryptSecret: jest.fn((v?: string) => (v ? `enc:${v}` : v)),
      encrypt: jest.fn((v: string) => `enc:${v}`),
    };
    jwk = {
      generateRsaKeyPair: jest.fn(async () => ({
        kid: 'kid',
        publicKeyPem: 'pub',
        privateKeyPem: 'priv',
      })),
    };
  });

  const writes: Array<[string, (s: SetupWizardService) => Promise<unknown>]> = [
    ['saveAdminAccount', (s) => s.saveAdminAccount(ADMIN)],
    ['saveRealmSettings', (s) => s.saveRealmSettings(REALM)],
    ['saveSmtpConfig', (s) => s.saveSmtpConfig(SMTP)],
    ['testSmtp', (s) => s.testSmtp()],
    ['saveClient', (s) => s.saveClient(CLIENT)],
    ['markSdkGenerated', (s) => s.markSdkGenerated()],
    ['completeWizard', (s) => s.completeWizard()],
    ['skipWizard', (s) => s.skipWizard()],
    ['resetWizard', (s) => s.resetWizard()],
  ];

  const ready = row({
    adminUsername: 'owner',
    adminEmail: 'o@example.com',
    adminPasswordHash: 'argon-hash',
    realmName: 'acme',
    smtpConfig: { host: 'h', port: 25, password: 'enc:pw' },
    currentStep: 2,
  });

  describe.each([
    ['completed', row({ ...ready, completed: true })],
    ['skipped', row({ ...ready, skipped: true })],
  ])('once setup is %s', (_label, closed) => {
    it.each(writes)(
      '%s answers 409 and writes nothing',
      async (_name, call) => {
        const { service, prisma } = build(closed);

        const err = await call(service).catch((e: unknown) => e);

        expect(err).toBeInstanceOf(ConflictException);
        expect((err as ConflictException).message).toBe(SETUP_COMPLETE_MESSAGE);
        expect(prisma.wizardState.update).not.toHaveBeenCalled();
        expect(prisma.wizardState.deleteMany).not.toHaveBeenCalled();
        expect(prisma.realm.create).not.toHaveBeenCalled();
        expect(prisma.user.create).not.toHaveBeenCalled();
        expect(prisma.client.create).not.toHaveBeenCalled();
      },
    );

    it('answers 409 before validating the input', async () => {
      const { service } = build(closed);
      await expect(
        service.saveAdminAccount({ username: '', email: '', password: '' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('when another request completes the wizard first', () => {
    it.each(writes.filter(([name]) => name !== 'testSmtp'))(
      '%s re-checks under the row lock and answers 409',
      async (_name, call) => {
        const { service, prisma, db } = build(ready);
        db.outside = ready;
        db.locked = row({ ...ready, completed: true });

        await expect(call(service)).rejects.toBeInstanceOf(ConflictException);
        expect(prisma.$queryRaw).toHaveBeenCalled();
        expect(prisma.wizardState.update).not.toHaveBeenCalled();
        expect(prisma.realm.create).not.toHaveBeenCalled();
        expect(prisma.user.create).not.toHaveBeenCalled();
        expect(prisma.client.create).not.toHaveBeenCalled();
      },
    );
  });

  describe('completeWizard', () => {
    it('creates the realm and admin and marks the wizard completed in one locked transaction', async () => {
      const { service, prisma, db } = build(ready);

      await expect(service.completeWizard()).resolves.toMatchObject({
        success: true,
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const [lockSql] = prisma.$queryRaw.mock.calls[0] as unknown as [
        TemplateStringsArray,
      ];
      expect(lockSql.join('?')).toMatch(/FOR UPDATE/);
      expect(prisma.realm.create).toHaveBeenCalledTimes(1);
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            username: 'owner',
            passwordHash: 'argon-hash',
          }),
        }),
      );
      expect(db.locked.completed).toBe(true);
      // The completion flag is written after everything it vouches for.
      const flagOrder = prisma.wizardState.update.mock.invocationCallOrder[0];
      expect(flagOrder).toBeGreaterThan(
        prisma.user.create.mock.invocationCallOrder[0],
      );
    });

    it('a second completion answers 409', async () => {
      const { service, prisma } = build(ready);
      await service.completeWizard();
      await expect(service.completeWizard()).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.realm.create).toHaveBeenCalledTimes(1);
    });

    it('maps a realm-name conflict to 409', async () => {
      const { service, prisma } = build(ready);
      prisma.realm.create.mockRejectedValue(
        Object.assign(new Error('unique'), { code: 'P2002' }),
      );
      await expect(service.completeWizard()).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('needs the admin account and the realm', async () => {
      const { service } = build(row());
      await expect(service.completeWizard()).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('resetWizard', () => {
    it('clears only the wizard row of an open wizard', async () => {
      const { service, prisma, db } = build(ready);

      await service.resetWizard();

      expect(db.locked).toMatchObject({
        completed: false,
        skipped: false,
        currentStep: 0,
        adminUsername: null,
        adminPasswordHash: null,
        realmName: null,
      });
      expect(prisma.wizardState.deleteMany).not.toHaveBeenCalled();
      expect(prisma.realm.delete).not.toHaveBeenCalled();
      expect(prisma.realm.deleteMany).not.toHaveBeenCalled();
      expect(prisma.user.delete).not.toHaveBeenCalled();
      expect(prisma.user.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('saveClient', () => {
    it('returns the plaintext secret once and stores only its hash', async () => {
      const { service, prisma } = build(row({ ...ready }));
      prisma.realm.findUnique.mockResolvedValue({
        id: 'realm-1',
        name: 'acme',
      } as never);

      const saved = await service.saveClient(CLIENT);

      expect(saved.clientSecret).toBe('plain-secret');
      expect(prisma.client.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ clientSecret: 'secret-hash' }),
        }),
      );
      const stateWrite = prisma.wizardState.update.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(stateWrite.data).not.toHaveProperty('clientSecret');
    });
  });
});
