import { ScimFilterParserService } from './filter-parser.service';
import { getPatchOperations } from './patch-request';
import { ScimException } from './scim-errors';
import { ScimUsersService } from './scim-users.service';
import { PasswordPolicyService } from '../password-policy/password-policy.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { EventsService } from '../events/events.service';
import type { SessionsService } from '../sessions/sessions.service';
import type { CryptoService } from '../crypto/crypto.service';
import type { PasswordVerificationService } from '../crypto/password-verification.service';
import type { BruteForceService } from '../brute-force/brute-force.service';

const realm = { id: 'realm-1', name: 'acme' };
const ENTERPRISE = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';

/** The realm row, with its password policy. */
const realmRow = (overrides: Record<string, unknown> = {}) => ({
  id: realm.id,
  name: realm.name,
  passwordMinLength: 8,
  passwordRequireUppercase: false,
  passwordRequireLowercase: false,
  passwordRequireDigits: true,
  passwordRequireSpecialChars: false,
  passwordHistoryCount: 3,
  ...overrides,
});

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
    passwordHash: 'hashed:Current-passw0rd',
    scimExternalId: null,
    scimProfile: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    userGroups: [],
    ...overrides,
  };
}

/** A fake hash: `hashed:<password>`, checked by the fake verifier. */
const hash = (password: string) => `hashed:${password}`;

function setup(
  user: Record<string, unknown> = makeUser(),
  realmOverrides: Record<string, unknown> = {},
) {
  let stored: Record<string, unknown> = { ...user };
  const history: Array<{ passwordHash: string }> = [];
  const prisma = {
    user: {
      findFirst: jest.fn(
        ({ where }: { where: Record<string, unknown> }): Promise<unknown> =>
          Promise.resolve(where['id'] === stored['id'] ? stored : null),
      ),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        stored = { ...stored, ...data };
        return Promise.resolve(stored);
      }),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(makeUser({ id: 'user-2', ...data })),
      ),
    },
    realm: {
      findUnique: jest.fn(() => Promise.resolve(realmRow(realmOverrides))),
    },
    passwordHistory: {
      findMany: jest.fn(() => Promise.resolve([...history])),
      create: jest.fn(({ data }: { data: { passwordHash: string } }) => {
        history.unshift({ passwordHash: data.passwordHash });
        return Promise.resolve(data);
      }),
      deleteMany: jest.fn(() => Promise.resolve({ count: 0 })),
    },
  };
  const events = { recordAdminEvent: jest.fn().mockResolvedValue(undefined) };
  const sessions = {
    revokeAllUserSessions: jest.fn().mockResolvedValue(undefined),
  };
  const crypto = {
    hashPassword: jest.fn((password: string) =>
      Promise.resolve(hash(password)),
    ),
  };
  const passwords = {
    check: jest.fn(
      ({ passwordHash }: { passwordHash: string | null }, password: string) =>
        Promise.resolve({ valid: passwordHash === hash(password) }),
    ),
  };
  const bruteForce = { resetFailures: jest.fn().mockResolvedValue(undefined) };
  const policy = new PasswordPolicyService(
    prisma as unknown as PrismaService,
    passwords as unknown as PasswordVerificationService,
  );
  const service = new ScimUsersService(
    prisma as unknown as PrismaService,
    events as unknown as EventsService,
    new ScimFilterParserService(),
    sessions as unknown as SessionsService,
    crypto as unknown as CryptoService,
    passwords as unknown as PasswordVerificationService,
    policy,
    bruteForce as unknown as BruteForceService,
  );
  return {
    service,
    prisma,
    events,
    sessions,
    crypto,
    bruteForce,
    history,
    stored: () => stored,
  };
}

const ops = (operations: unknown[]) =>
  getPatchOperations({ Operations: operations });

async function scimErrorOf(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ScimException);
  return {
    status: (error as ScimException).getStatus(),
    scimType: (error as ScimException).scimType,
    detail: (error as ScimException).message,
  };
}

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

    it('stores profile attributes and returns them', async () => {
      const { service, prisma } = setup();
      const user = await service.patch(
        realm,
        'user-1',
        ops([
          { op: 'replace', path: 'displayName', value: 'Jane D' },
          { op: 'add', path: `${ENTERPRISE}:department`, value: 'Sales' },
          { op: 'add', path: 'externalId', value: 'obj-1' },
        ]),
      );
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          scimExternalId: 'obj-1',
          scimProfile: {
            displayName: 'Jane D',
            enterprise: { department: 'Sales' },
          },
        },
      });
      expect(user).toMatchObject({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User', ENTERPRISE],
        externalId: 'obj-1',
        displayName: 'Jane D',
        [ENTERPRISE]: { department: 'Sales' },
      });
    });

    it('writes nothing when nothing changes', async () => {
      const { service, prisma } = setup();
      await service.patch(
        realm,
        'user-1',
        ops([
          { op: 'replace', path: 'name.givenName', value: 'Jane' },
          { op: 'replace', path: 'roles', value: [{ value: 'x' }] },
        ]),
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('refuses a userName taken by another user, in any case, with 409', async () => {
      const { service, prisma } = setup();
      prisma.user.findFirst.mockImplementation(
        ({ where }: { where: Record<string, unknown> }) => {
          if (where['id'] === 'user-1') return Promise.resolve(makeUser());
          const username = where['username'] as
            { equals: string; mode: string } | undefined;
          return Promise.resolve(
            username?.mode === 'insensitive' &&
              username.equals.toLowerCase() === 'taken'
              ? { id: 'user-9' }
              : null,
          );
        },
      );
      const error = await scimErrorOf(
        service.patch(
          realm,
          'user-1',
          ops([{ op: 'replace', path: 'userName', value: 'TAKEN' }]),
        ),
      );
      expect(error).toMatchObject({ status: 409, scimType: 'uniqueness' });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('drops passwords from the audit event', async () => {
      const { service, events } = setup();
      await service.patch(
        realm,
        'user-1',
        ops([{ op: 'replace', path: 'password', value: 'dummy-passw0rd' }]),
      );
      expect(JSON.stringify(events.recordAdminEvent.mock.calls)).not.toContain(
        'dummy-passw0rd',
      );
    });
  });

  describe('password', () => {
    it('sets a new password: hashed, dated, sessions ended, failures and history updated', async () => {
      const { service, prisma, sessions, bruteForce, history } = setup();
      const user = await service.patch(
        realm,
        'user-1',
        ops([{ op: 'replace', path: 'password', value: 'N3w-password' }]),
      );
      const data = prisma.user.update.mock.calls[0][0].data as Record<
        string,
        unknown
      >;
      expect(data['passwordHash']).toBe(hash('N3w-password'));
      expect(data['passwordChangedAt']).toBeInstanceOf(Date);
      expect(sessions.revokeAllUserSessions).toHaveBeenCalledWith(
        realm,
        'user-1',
      );
      expect(bruteForce.resetFailures).toHaveBeenCalledWith(realm.id, 'user-1');
      expect(history).toEqual([{ passwordHash: hash('N3w-password') }]);
      // Write-only: never in a response.
      expect(JSON.stringify(user)).not.toContain('N3w-password');
      expect(user).not.toHaveProperty('password');
    });

    it('accepts the no-path form Okta sends', async () => {
      const { service, prisma } = setup();
      await service.patch(
        realm,
        'user-1',
        ops([{ op: 'replace', value: { password: 'Okta-passw0rd' } }]),
      );
      expect(prisma.user.update.mock.calls[0][0].data).toMatchObject({
        passwordHash: hash('Okta-passw0rd'),
      });
    });

    it("refuses a password the realm's policy refuses, writing nothing", async () => {
      const { service, prisma, sessions } = setup();
      const error = await scimErrorOf(
        service.patch(
          realm,
          'user-1',
          ops([
            { op: 'replace', path: 'active', value: false },
            { op: 'replace', path: 'password', value: 'no-digits' },
          ]),
        ),
      );
      expect(error).toMatchObject({ status: 400, scimType: 'invalidValue' });
      expect(error.detail).toContain('digit');
      expect(error.detail).not.toContain('no-digits');
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(sessions.revokeAllUserSessions).not.toHaveBeenCalled();
    });

    it('refuses a password from the history', async () => {
      const { service, history, prisma } = setup();
      history.push({ passwordHash: hash('0ld-password') });
      const error = await scimErrorOf(
        service.patch(
          realm,
          'user-1',
          ops([{ op: 'replace', path: 'password', value: '0ld-password' }]),
        ),
      );
      expect(error).toMatchObject({ status: 400, scimType: 'invalidValue' });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('treats the current password as no change (Okta re-sends it)', async () => {
      const { service, prisma, sessions, history } = setup();
      // Also in the history: re-sending it must not fail the history check.
      history.push({ passwordHash: hash('Current-passw0rd') });
      await service.update(realm, 'user-1', {
        schemas: [],
        userName: 'jdoe',
        name: { givenName: 'Jane', familyName: 'Doe' },
        emails: [{ value: 'jdoe@example.com', primary: true }],
        password: 'Current-passw0rd',
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(sessions.revokeAllUserSessions).not.toHaveBeenCalled();
    });

    it('sets the password on create and records it', async () => {
      const { service, prisma, history } = setup();
      const created = await service.create(realm, {
        schemas: [],
        userName: 'new.user',
        password: 'Initial-passw0rd',
      });
      const data = prisma.user.create.mock.calls[0][0].data as Record<
        string,
        unknown
      >;
      expect(data['passwordHash']).toBe(hash('Initial-passw0rd'));
      expect(data['passwordChangedAt']).toBeInstanceOf(Date);
      expect(history).toEqual([{ passwordHash: hash('Initial-passw0rd') }]);
      expect(created).not.toHaveProperty('password');
    });

    it('refuses a weak password on create before creating the user', async () => {
      const { service, prisma } = setup();
      const error = await scimErrorOf(
        service.create(realm, {
          schemas: [],
          userName: 'new.user',
          password: 'short',
        }),
      );
      expect(error).toMatchObject({ status: 400, scimType: 'invalidValue' });
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('keeps the password on a PUT that does not send one', async () => {
      const { service, prisma } = setup();
      await service.update(realm, 'user-1', {
        schemas: [],
        userName: 'jdoe',
        name: { givenName: 'Jane', familyName: 'Doe' },
        emails: [{ value: 'jdoe@example.com' }],
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
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

    it('replaces: attributes left out are cleared, active is kept', async () => {
      const { service, prisma } = setup(
        makeUser({ scimProfile: { title: 'Engineer' }, scimExternalId: 'x' }),
      );
      await service.update(realm, 'user-1', { schemas: [], userName: 'jdoe' });
      expect(prisma.user.update.mock.calls[0][0].data).toMatchObject({
        email: null,
        firstName: null,
        lastName: null,
        scimExternalId: null,
      });
      expect(prisma.user.update.mock.calls[0][0].data).not.toHaveProperty(
        'enabled',
      );
    });

    it('stores externalId in its own column, never in federationLink', async () => {
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
      expect(data['scimExternalId']).toBe('ext-1');
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

  describe('attributes and excludedAttributes', () => {
    const withProfile = () =>
      setup(
        makeUser({
          scimExternalId: 'obj-1',
          scimProfile: {
            title: 'Engineer',
            enterprise: { department: 'Research', manager: 'm-1' },
          },
        }),
      );

    it('returns only the asked attributes, plus id, schemas, meta and userName', async () => {
      const { service } = withProfile();
      const user = await service.findById(realm, 'user-1', {
        attributes: [
          'NAME.givenName',
          `${ENTERPRISE}:department`,
          'emails.value',
        ],
      });
      expect(Object.keys(user).sort()).toEqual(
        [
          'emails',
          'id',
          'meta',
          'name',
          'schemas',
          'userName',
          ENTERPRISE,
        ].sort(),
      );
      expect(user.name).toEqual({ givenName: 'Jane' });
      expect(user.emails).toEqual([{ value: 'jdoe@example.com' }]);
      expect(user[ENTERPRISE]).toEqual({ department: 'Research' });
    });

    it('leaves out excluded attributes but never userName or id', async () => {
      const { service } = withProfile();
      const user = await service.findById(realm, 'user-1', {
        excludedAttributes: ['emails', 'userName', 'id', ENTERPRISE, 'title'],
      });
      expect(user).not.toHaveProperty('emails');
      expect(user).not.toHaveProperty(ENTERPRISE);
      expect(user).not.toHaveProperty('title');
      expect(user.userName).toBe('jdoe');
      expect(user.id).toBe('user-1');
      expect(user.externalId).toBe('obj-1');
    });
  });
});

describe('ScimUsersService profile comparison', () => {
  it('does not write when a PUT re-sends the stored profile in another key order', async () => {
    // As PostgreSQL's JSONB returns it: its own key order.
    const { service, prisma } = setup(
      makeUser({
        scimExternalId: 'obj-1',
        scimProfile: {
          title: 'Engineer',
          displayName: 'Jane Doe',
          phoneNumbers: [{ value: '+1 555 0100', type: 'work' }],
          enterprise: { manager: 'm-1', department: 'Sales' },
        },
      }),
    );
    await service.update(realm, 'user-1', {
      schemas: [],
      externalId: 'obj-1',
      userName: 'jdoe',
      displayName: 'Jane Doe',
      title: 'Engineer',
      name: { givenName: 'Jane', familyName: 'Doe' },
      emails: [{ value: 'jdoe@example.com', primary: true }],
      phoneNumbers: [{ type: 'work', value: '+1 555 0100' }],
      [ENTERPRISE]: { department: 'Sales', manager: { value: 'm-1' } },
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

describe('ScimUsersService federated (LDAP) users', () => {
  const federated = (overrides: Record<string, unknown> = {}) =>
    makeUser({
      federationLink: 'ldap-provider-1',
      passwordHash: null,
      ...overrides,
    });

  it('refuses a PATCH that sets the password with 400 mutability, applying nothing', async () => {
    const { service, prisma, sessions } = setup(federated());
    const error = await scimErrorOf(
      service.patch(
        realm,
        'user-1',
        ops([
          { op: 'replace', path: 'title', value: 'Engineer' },
          { op: 'replace', value: { password: 'Ldap-passw0rd' } },
        ]),
      ),
    );
    expect(error).toMatchObject({ status: 400, scimType: 'mutability' });
    expect(error.detail).toContain('user federation');
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(sessions.revokeAllUserSessions).not.toHaveBeenCalled();
  });

  it('refuses it even when a local hash exists but the password differs', async () => {
    const { service, prisma } = setup(
      federated({ passwordHash: hash('Other-passw0rd') }),
    );
    const error = await scimErrorOf(
      service.patch(
        realm,
        'user-1',
        ops([{ op: 'replace', path: 'password', value: 'N3w-password' }]),
      ),
    );
    expect(error.scimType).toBe('mutability');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('treats the stored password as no change', async () => {
    const { service, prisma } = setup(
      federated({ passwordHash: hash('Same-passw0rd') }),
    );
    await service.patch(
      realm,
      'user-1',
      ops([{ op: 'replace', path: 'password', value: 'Same-passw0rd' }]),
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('drops the password from a PUT (Okta password sync) and applies the rest', async () => {
    const { service, prisma, sessions } = setup(federated());
    await service.update(realm, 'user-1', {
      schemas: [],
      userName: 'jdoe',
      name: { givenName: 'Janet', familyName: 'Doe' },
      emails: [{ value: 'jdoe@example.com', primary: true }],
      password: 'Okta-synced-example-passw0rd',
    });
    const data = prisma.user.update.mock.calls[0][0].data as Record<
      string,
      unknown
    >;
    expect(data).toEqual({ firstName: 'Janet' });
    expect(sessions.revokeAllUserSessions).not.toHaveBeenCalled();
  });
});
