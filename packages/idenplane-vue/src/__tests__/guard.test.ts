import { describe, it, expect, vi } from 'vitest';
import { createAuthGuard } from '../guard.js';
import type { RouteLocationNormalized } from 'vue-router';

// ── Helpers ──────────────────────────────────────────────────────

function makeRoute(overrides: {
  path?: string;
  fullPath?: string;
  meta?: Record<string, unknown>;
}): RouteLocationNormalized {
  return {
    path: overrides.path ?? '/',
    fullPath: overrides.fullPath ?? overrides.path ?? '/',
    meta: overrides.meta ?? {},
    name: undefined,
    hash: '',
    query: {},
    params: {},
    matched: [],
    redirectedFrom: undefined,
  } as RouteLocationNormalized;
}

function makeClient(opts: {
  authenticated?: boolean;
  roles?: string[];
  initResult?: boolean;
}) {
  const { authenticated = false, roles = [], initResult = false } = opts;
  let _authenticated = authenticated;

  return {
    isAuthenticated: vi.fn(() => _authenticated),
    hasRealmRole: vi.fn((role: string) => roles.includes(role)),
    init: vi.fn(async () => {
      _authenticated = initResult;
      return initResult;
    }),
  };
}

// ── Tests ─────────────────────────────────────────────────────────

describe('createAuthGuard', () => {
  it('passes through unprotected routes (no meta.requiresAuth)', async () => {
    const client = makeClient({ authenticated: false });
    const guard = createAuthGuard({}, client as never);

    const to = makeRoute({ path: '/about' });
    const from = makeRoute({ path: '/' });
    const result = await guard(to, from, vi.fn() as never);

    expect(result).toBe(true);
  });

  it('redirects to login when not authenticated on a protected route', async () => {
    const client = makeClient({ authenticated: false, initResult: false });
    const guard = createAuthGuard({ loginRoute: '/login' }, client as never);

    const to = makeRoute({ path: '/dashboard', fullPath: '/dashboard', meta: { requiresAuth: true } });
    const from = makeRoute({ path: '/' });
    const result = await guard(to, from, vi.fn() as never);

    expect(result).toEqual({ path: '/login', query: { next: '/dashboard' } });
  });

  it('allows access when authenticated on a protected route', async () => {
    const client = makeClient({ authenticated: true });
    const guard = createAuthGuard({ loginRoute: '/login' }, client as never);

    const to = makeRoute({ path: '/dashboard', meta: { requiresAuth: true } });
    const from = makeRoute({ path: '/' });
    const result = await guard(to, from, vi.fn() as never);

    expect(result).toBe(true);
  });

  it('redirects when user lacks required roles', async () => {
    const client = makeClient({ authenticated: true, roles: ['user'] });
    const guard = createAuthGuard({ loginRoute: '/login' }, client as never);

    const to = makeRoute({ path: '/admin', meta: { requiresAuth: true, roles: ['admin'] } });
    const from = makeRoute({ path: '/' });
    const result = await guard(to, from, vi.fn() as never);

    expect(result).toEqual({ path: '/login', query: { error: 'forbidden' } });
  });

  it('allows access when user has all required roles', async () => {
    const client = makeClient({ authenticated: true, roles: ['admin', 'user'] });
    const guard = createAuthGuard({ loginRoute: '/login' }, client as never);

    const to = makeRoute({ path: '/admin', meta: { requiresAuth: true, roles: ['admin'] } });
    const from = makeRoute({ path: '/' });
    const result = await guard(to, from, vi.fn() as never);

    expect(result).toBe(true);
  });

  it('uses global roles when no per-route roles are set', async () => {
    const client = makeClient({ authenticated: true, roles: ['user'] });
    const guard = createAuthGuard({ loginRoute: '/login', roles: ['admin'] }, client as never);

    const to = makeRoute({ path: '/dashboard', meta: { requiresAuth: true } });
    const from = makeRoute({ path: '/' });
    const result = await guard(to, from, vi.fn() as never);

    expect(result).toEqual({ path: '/login', query: { error: 'forbidden' } });
  });

  it('calls client.init() if not already authenticated on a protected route', async () => {
    const client = makeClient({ authenticated: false, initResult: false });
    const guard = createAuthGuard({}, client as never);

    const to = makeRoute({ path: '/secure', meta: { requiresAuth: true } });
    const from = makeRoute({ path: '/' });
    await guard(to, from, vi.fn() as never);

    expect(client.init).toHaveBeenCalled();
  });

  it('warns and fails-open when no client is available', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const guard = createAuthGuard(); // no client override, no inject context

    const to = makeRoute({ path: '/dashboard', meta: { requiresAuth: true } });
    const from = makeRoute({ path: '/' });
    const result = await guard(to, from, vi.fn() as never);

    expect(result).toBe(true); // fail-open
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
