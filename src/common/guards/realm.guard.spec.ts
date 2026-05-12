import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { RealmGuard } from './realm.guard.js';
import {
  createMockPrismaService,
  MockPrismaService,
} from '../../prisma/prisma.mock.js';

function createMockExecutionContext(
  params: Record<string, string> = {},
  path = '/realms/test',
) {
  const request: Record<string, any> = { params, path };
  return {
    switchToHttp: jest.fn().mockReturnValue({
      getRequest: jest.fn().mockReturnValue(request),
    }),
    __request: request,
  } as any;
}

describe('RealmGuard', () => {
  let guard: RealmGuard;
  let prisma: MockPrismaService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    guard = new RealmGuard(prisma as any);
  });

  it('should pass through when no realm param is present', async () => {
    const ctx = createMockExecutionContext({});

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(prisma.realm.findUnique).not.toHaveBeenCalled();
  });

  it('should extract realm name from the realmName route param', async () => {
    const fakeRealm = { id: '1', name: 'my-realm', enabled: true };
    prisma.realm.findUnique.mockResolvedValue(fakeRealm);
    const ctx = createMockExecutionContext({ realmName: 'my-realm' });

    await guard.canActivate(ctx);

    expect(prisma.realm.findUnique).toHaveBeenCalledWith({
      where: { name: 'my-realm' },
    });
  });

  it('should extract realm name from the realm route param', async () => {
    const fakeRealm = { id: '2', name: 'other-realm', enabled: true };
    prisma.realm.findUnique.mockResolvedValue(fakeRealm);
    const ctx = createMockExecutionContext({ realm: 'other-realm' });

    await guard.canActivate(ctx);

    expect(prisma.realm.findUnique).toHaveBeenCalledWith({
      where: { name: 'other-realm' },
    });
  });

  it('should prefer realmName over realm param', async () => {
    const fakeRealm = { id: '1', name: 'primary', enabled: true };
    prisma.realm.findUnique.mockResolvedValue(fakeRealm);
    const ctx = createMockExecutionContext({
      realmName: 'primary',
      realm: 'secondary',
    });

    await guard.canActivate(ctx);

    expect(prisma.realm.findUnique).toHaveBeenCalledWith({
      where: { name: 'primary' },
    });
  });

  it('should set the realm on the request object when found', async () => {
    const fakeRealm = {
      id: '1',
      name: 'my-realm',
      enabled: true,
      displayName: 'My Realm',
    };
    prisma.realm.findUnique.mockResolvedValue(fakeRealm);
    const ctx = createMockExecutionContext({ realmName: 'my-realm' });

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    const request = ctx.switchToHttp().getRequest();
    expect(request.realm).toEqual(fakeRealm);
  });

  it('should throw NotFoundException when the realm does not exist', async () => {
    prisma.realm.findUnique.mockResolvedValue(null);
    const ctx = createMockExecutionContext({ realmName: 'nonexistent' });

    await expect(guard.canActivate(ctx)).rejects.toThrow(NotFoundException);
    await expect(guard.canActivate(ctx)).rejects.toThrow(
      "Realm 'nonexistent' not found",
    );
  });

  it('should throw NotFoundException with the realm name in the message', async () => {
    prisma.realm.findUnique.mockResolvedValue(null);
    const ctx = createMockExecutionContext({ realmName: 'test-realm' });

    await expect(guard.canActivate(ctx)).rejects.toThrow(
      "Realm 'test-realm' not found",
    );
  });

  it('should throw ForbiddenException for disabled realm on non-admin path', async () => {
    const disabledRealm = {
      id: '3',
      name: 'disabled-realm',
      enabled: false,
    };
    prisma.realm.findUnique.mockResolvedValue(disabledRealm);
    const ctx = createMockExecutionContext(
      { realmName: 'disabled-realm' },
      '/realms/disabled-realm/login',
    );

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(ctx)).rejects.toThrow('Realm is disabled');
  });

  it('should allow disabled realm on admin path', async () => {
    const disabledRealm = {
      id: '3',
      name: 'disabled-realm',
      enabled: false,
    };
    prisma.realm.findUnique.mockResolvedValue(disabledRealm);
    const ctx = createMockExecutionContext(
      { realmName: 'disabled-realm' },
      '/admin/realms/disabled-realm/users',
    );

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    const request = ctx.switchToHttp().getRequest();
    expect(request.realm).toEqual(disabledRealm);
  });
});
