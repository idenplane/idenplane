import { ScimFilterParserService } from './filter-parser.service';
import { getPatchOperations } from './patch-request';
import { ScimException } from './scim-errors';
import { ScimGroupsService } from './scim-groups.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { EventsService } from '../events/events.service';

const realm = { id: 'realm-1', name: 'acme' };

const group = (overrides: Record<string, unknown> = {}) => ({
  id: 'g-1',
  realmId: realm.id,
  name: 'Engineering',
  description: 'Engineering',
  scimExternalId: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

function setup(existing = group()) {
  const prisma = {
    group: {
      findFirst: jest.fn(
        ({ where }: { where: Record<string, unknown> }): Promise<unknown> => {
          if (where['id'] === existing.id) {
            return Promise.resolve({
              ...existing,
              userGroups: [{ user: { id: 'u-1', username: 'ada' } }],
            });
          }
          return Promise.resolve(null);
        },
      ),
      findMany: jest.fn().mockResolvedValue([existing]),
      count: jest.fn().mockResolvedValue(1),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(group({ id: 'g-2', ...data })),
      ),
      update: jest.fn().mockResolvedValue(existing),
      delete: jest.fn().mockResolvedValue(existing),
    },
    user: {
      findMany: jest.fn(({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(where.id.in.map((id) => ({ id }))),
      ),
    },
    userGroup: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(
    (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma),
  );
  const events = { recordAdminEvent: jest.fn().mockResolvedValue(undefined) };
  const service = new ScimGroupsService(
    prisma as unknown as PrismaService,
    events as unknown as EventsService,
    new ScimFilterParserService(),
  );
  return { service, prisma };
}

const ops = (operations: unknown[]) =>
  getPatchOperations({ Operations: operations });

const includeOf = (mock: jest.Mock) =>
  (mock.mock.calls[0][0] as { include?: unknown }).include;

describe('ScimGroupsService', () => {
  describe('reads', () => {
    it('does not load members when they are excluded or not asked for', async () => {
      const { service, prisma } = setup();
      const g = await service.findById(realm, 'g-1', {
        excludedAttributes: ['members'],
      });
      expect(includeOf(prisma.group.findFirst)).toBeUndefined();
      expect(g).not.toHaveProperty('members');

      await service.findAll(realm, { attributes: ['displayName'] });
      expect(includeOf(prisma.group.findMany)).toBeUndefined();
    });

    it('loads and returns members by default', async () => {
      const { service, prisma } = setup();
      const g = await service.findById(realm, 'g-1');
      expect(includeOf(prisma.group.findFirst)).toBeDefined();
      expect(g.members).toEqual([
        {
          value: 'u-1',
          display: 'ada',
          type: 'User',
          $ref: 'http://localhost:3000/scim/v2/acme/Users/u-1',
        },
      ]);
    });

    it('returns externalId when one is stored', async () => {
      const { service } = setup(group({ scimExternalId: 'entra-gid' }));
      expect((await service.findById(realm, 'g-1')).externalId).toBe(
        'entra-gid',
      );
    });
  });

  describe('patch', () => {
    it('returns null (204) without a projection, the group with one', async () => {
      const { service } = setup();
      expect(
        await service.patch(
          realm,
          'g-1',
          ops([{ op: 'add', path: 'members', value: [{ value: 'u-2' }] }]),
        ),
      ).toBeNull();
      const projected = await service.patch(
        realm,
        'g-1',
        ops([{ op: 'add', path: 'members', value: [{ value: 'u-2' }] }]),
        { excludedAttributes: ['members'] },
      );
      expect(projected).toMatchObject({
        id: 'g-1',
        displayName: 'Engineering',
      });
      expect(projected).not.toHaveProperty('members');
    });

    it('writes in one transaction and bumps lastModified on a member change', async () => {
      const { service, prisma } = setup();
      await service.patch(
        realm,
        'g-1',
        ops([{ op: 'Remove', path: 'members', value: [{ value: 'u-1' }] }]),
      );
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.userGroup.deleteMany).toHaveBeenCalledWith({
        where: { groupId: 'g-1', userId: { in: ['u-1'] } },
      });
      expect(prisma.group.update).toHaveBeenCalledWith({
        where: { id: 'g-1' },
        data: { updatedAt: expect.any(Date) as Date },
      });
    });

    it('stores externalId', async () => {
      const { service, prisma } = setup();
      await service.patch(
        realm,
        'g-1',
        ops([{ op: 'replace', path: 'externalId', value: 'gid-9' }]),
      );
      expect(prisma.group.update).toHaveBeenCalledWith({
        where: { id: 'g-1' },
        data: { scimExternalId: 'gid-9' },
      });
    });

    it('refuses a name another group has, compared case-insensitively', async () => {
      const { service, prisma } = setup();
      prisma.group.findFirst.mockImplementation(
        ({ where }: { where: Record<string, unknown> }) => {
          if (where['id'] === 'g-1') return Promise.resolve(group());
          const name = where['name'] as { equals: string; mode: string };
          return Promise.resolve(
            name?.mode === 'insensitive' &&
              name.equals.toLowerCase() === 'platform'
              ? { id: 'g-9' }
              : null,
          );
        },
      );
      const error = await service
        .patch(
          realm,
          'g-1',
          ops([{ op: 'replace', path: 'displayName', value: 'PLATFORM' }]),
        )
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ScimException);
      expect((error as ScimException).getStatus()).toBe(409);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('update (PUT)', () => {
    it('replaces the members: none listed leaves the group empty', async () => {
      const { service, prisma } = setup();
      await service.update(realm, 'g-1', {
        schemas: [],
        displayName: 'Engineering',
      });
      expect(prisma.userGroup.deleteMany).toHaveBeenCalledWith({
        where: { groupId: 'g-1', userId: { notIn: [] } },
      });
      expect(prisma.group.update).toHaveBeenCalledWith({
        where: { id: 'g-1' },
        data: {
          name: 'Engineering',
          description: 'Engineering',
          scimExternalId: null,
        },
      });
    });
  });

  describe('create', () => {
    it('stores externalId and members in one transaction', async () => {
      const { service, prisma } = setup();
      prisma.group.findFirst
        .mockResolvedValueOnce(null) // the name is free
        .mockResolvedValueOnce({ ...group({ id: 'g-2' }), userGroups: [] });
      await service.create(realm, {
        schemas: [],
        displayName: 'New',
        externalId: 'gid-1',
        members: [{ value: 'u-1' }],
      });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.group.create).toHaveBeenCalledWith({
        data: {
          realmId: realm.id,
          name: 'New',
          description: 'New',
          scimExternalId: 'gid-1',
        },
      });
      expect(prisma.userGroup.createMany).toHaveBeenCalledWith({
        data: [{ userId: 'u-1', groupId: 'g-2' }],
        skipDuplicates: true,
      });
    });
  });
});
