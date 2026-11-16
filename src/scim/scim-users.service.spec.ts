import { ScimFilterParserService } from './filter-parser.service';
import { getPatchOperations } from './patch-request';
import { ScimException } from './scim-errors';
import { ScimUsersService } from './scim-users.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { EventsService } from '../events/events.service';
import type { SessionsService } from '../sessions/sessions.service';

const realm = { id: 'realm-1', name: 'acme' };

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    realmId: realm.id,
    username: 'jdoe',
    email: 'jdoe@example.com',
    firstName: 'Jane',
    lastName: 'Doe',
    enabled: true,
    federationLink: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    userGroups: [],
    ...overrides,
  };
}

function setup(user = makeUser()) {
  const prisma = {
    user: {
      findFirst: jest.fn(
        ({ where }: { where: Record<string, unknown> }): Promise<unknown> =>
          Promise.resolve(where['id'] === user.id ? user : null),
      ),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...user, ...data }),
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(makeUser({ id: 'user-2', ...data })),
      ),
    },
  };
  const events = { recordAdminEvent: jest.fn().mockResolvedValue(undefined) };
  const sessions = {
    revokeAllUserSessions: jest.fn().mockResolvedValue(undefined),
  };
  const service = new ScimUsersService(
    prisma as unknown as PrismaService,
    events as unknown as EventsService,
    new ScimFilterParserService(),
    sessions as unknown as SessionsService,
  );
  return { service, prisma, events, sessions };
}

const ops = (operations: unknown[]) =>
  getPatchOperations({ Operations: operations });

describe('ScimUsersService', () => {
  describe('patch', () => {
    it('disables the user and ends their sessions on deactivation', async () => {
      const { service, prisma, sessions } = setup();
      await service.patch(
        realm,
        'user-1',
        ops([{ op: 'Replace', path: 'active', value: 'False' }]),
      );
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { enabled: false },
      });
      expect(sessions.revokeAllUserSessions).toHaveBeenCalledWith(
        realm,
        'user-1',
      );
      // The user is disabled before the sessions are ended, so no new
      // session can start in between.
      expect(prisma.user.update.mock.invocationCallOrder[0]).toBeLessThan(
        sessions.revokeAllUserSessions.mock.invocationCallOrder[0],
      );
    });

    it('does not end sessions for other changes or re-activation', async () => {
      const { service, sessions } = setup(makeUser({ enabled: false }));
      await service.patch(
        realm,
        'user-1',
        ops([
          { op: 'replace', path: 'active', value: true },
          { op: 'replace', path: 'name.givenName', value: 'J' },
        ]),
      );
      expect(sessions.revokeAllUserSessions).not.toHaveBeenCalled();
    });

    it('writes only changed fields and nothing for no-op attributes', async () => {
      const { service, prisma } = setup();
      await service.patch(
        realm,
        'user-1',
        ops([{ op: 'replace', path: 'displayName', value: 'Jane D' }]),
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('refuses a userName taken by another user with 409 uniqueness', async () => {
      const { service, prisma } = setup();
      prisma.user.findFirst.mockImplementation(
        ({ where }: { where: Record<string, unknown> }) =>
          Promise.resolve(
            where['id'] === 'user-1'
              ? makeUser()
              : where['username'] === 'taken'
                ? { id: 'user-9' }
                : null,
          ),
      );
      const error = await service
        .patch(
          realm,
          'user-1',
          ops([{ op: 'replace', path: 'userName', value: 'taken' }]),
        )
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ScimException);
      expect((error as ScimException).getStatus()).toBe(409);
      expect((error as ScimException).scimType).toBe('uniqueness');
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('drops passwords from the audit event', async () => {
      const { service, events } = setup();
      await service.patch(
        realm,
        'user-1',
        ops([{ op: 'replace', path: 'password', value: 'dummy-password' }]),
      );
      expect(JSON.stringify(events.recordAdminEvent.mock.calls)).not.toContain(
        'dummy-password',
      );
    });
  });

  describe('update (PUT)', () => {
    it('ends sessions when active turns false', async () => {
      const { service, sessions } = setup();
      await service.update(realm, 'user-1', {
        schemas: [],
        userName: 'jdoe',
        active: 'False' as unknown as boolean,
      });
      expect(sessions.revokeAllUserSessions).toHaveBeenCalledWith(
        realm,
        'user-1',
      );
    });

    it('does not write externalId into federationLink', async () => {
      const { service, prisma } = setup();
      await service.update(realm, 'user-1', {
        schemas: [],
        userName: 'jdoe',
        externalId: 'ext-1',
      });
      const data = prisma.user.update.mock.calls[0][0].data as Record<
        string,
        unknown
      >;
      expect(data).not.toHaveProperty('federationLink');
    });
  });

  describe('delete', () => {
    it('disables the user and ends their sessions', async () => {
      const { service, prisma, sessions } = setup();
      await service.delete(realm, 'user-1');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { enabled: false },
      });
      expect(sessions.revokeAllUserSessions).toHaveBeenCalledWith(
        realm,
        'user-1',
      );
    });
  });

  describe('create', () => {
    it('honours active=false and needs a userName', async () => {
      const { service, prisma } = setup();
      await service.create(realm, {
        schemas: [],
        userName: 'new.user',
        active: 'False' as unknown as boolean,
      });
      expect(prisma.user.create.mock.calls[0][0].data).toMatchObject({
        username: 'new.user',
        enabled: false,
      });
      await expect(
        service.create(realm, { schemas: [] } as never),
      ).rejects.toMatchObject({ scimType: 'invalidValue' });
    });

    it('returns 2.0 schemas, a work email and an absolute location', async () => {
      const { service } = setup();
      const created = await service.create(realm, {
        schemas: [],
        userName: 'new.user',
        emails: [{ value: 'new.user@example.com' }],
      });
      expect(created.schemas).toEqual([
        'urn:ietf:params:scim:schemas:core:2.0:User',
      ]);
      expect(created.emails).toEqual([
        { value: 'new.user@example.com', type: 'work', primary: true },
      ]);
      expect(created.meta?.location).toMatch(
        /^https?:\/\/[^/]+\/scim\/v2\/acme\/Users\/user-2$/,
      );
    });
  });
});
