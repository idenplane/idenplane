import { describe, it, expect, vi, beforeEach } from 'vitest';
import { defineComponent, provide, h } from 'vue';
import { mount } from '@vue/test-utils';
import { AUTHME_KEY } from '../plugin.js';
import { useAuth, useUser, usePermissions } from '../composables.js';

// ── Fake AuthmeClient ─────────────────────────────────────────────

function buildClient(o: {
  authenticated?: boolean;
  user?: { sub: string; name: string; email: string } | null;
  roles?: string[];
  initResult?: boolean;
} = {}) {
  const authenticated = o.authenticated ?? false;
  const user = o.user ?? null;
  const roles = o.roles ?? [];

  const handlers: Record<string, Array<(data?: unknown) => void>> = {};

  const client = {
    isAuthenticated: vi.fn(() => authenticated),
    getUserInfo: vi.fn(() => user),
    getAccessToken: vi.fn(() => (authenticated ? 'tok' : null)),
    getRealmRoles: vi.fn(() => roles),
    hasRealmRole: vi.fn((role: string) => roles.includes(role)),
    hasPermission: vi.fn((perm: string) => roles.includes(perm)),
    fetchUserInfo: vi.fn(async () => user),
    login: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    init: vi.fn(async () => o.initResult ?? false),
    handleCallback: vi.fn(async () => false),
    on: vi.fn((event: string, handler: (data?: unknown) => void) => {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(handler);
      return () => {
        handlers[event] = handlers[event].filter((h) => h !== handler);
      };
    }),
    emit: (event: string, data?: unknown) => {
      handlers[event]?.forEach((h) => h(data));
    },
  };
  return client;
}

// ── Test wrapper ──────────────────────────────────────────────────

function withProvider(client: ReturnType<typeof buildClient>, setupFn: () => unknown) {
  let result: unknown;
  const Inner = defineComponent({
    setup() {
      result = setupFn();
      return () => h('div');
    },
  });

  const Wrapper = defineComponent({
    setup() {
      provide(AUTHME_KEY, client as never);
      return () => h(Inner);
    },
  });

  mount(Wrapper);
  return result;
}

// ── useAuth ───────────────────────────────────────────────────────

describe('useAuth', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { location: { href: 'http://localhost/' } });
  });

  it('throws when used outside AuthProvider', () => {
    const Bad = defineComponent({
      setup() {
        expect(() => useAuth()).toThrow(/No AuthmeClient found/);
        return () => h('div');
      },
    });
    mount(Bad);
  });

  it('returns isAuthenticated as false when client says so', () => {
    const client = buildClient({ authenticated: false });
    const auth = withProvider(client, () => useAuth()) as ReturnType<typeof useAuth>;
    expect(auth.isAuthenticated.value).toBe(false);
  });

  it('exposes login, logout, getToken helpers', () => {
    const client = buildClient();
    const auth = withProvider(client, () => useAuth()) as ReturnType<typeof useAuth>;
    expect(typeof auth.login).toBe('function');
    expect(typeof auth.logout).toBe('function');
    expect(typeof auth.getToken).toBe('function');
  });

  it('calls client.login when login() is invoked', async () => {
    const client = buildClient();
    const auth = withProvider(client, () => useAuth()) as ReturnType<typeof useAuth>;
    await auth.login({ scope: ['openid'] });
    expect(client.login).toHaveBeenCalledWith({ scope: ['openid'] });
  });

  it('calls client.logout when logout() is invoked', async () => {
    const client = buildClient();
    const auth = withProvider(client, () => useAuth()) as ReturnType<typeof useAuth>;
    await auth.logout();
    expect(client.logout).toHaveBeenCalled();
  });
});

// ── useUser ───────────────────────────────────────────────────────

describe('useUser', () => {
  it('returns user from client.getUserInfo()', () => {
    const client = buildClient({
      user: { sub: 'u1', name: 'Alice', email: 'alice@example.com' },
    });
    const result = withProvider(client, () => useUser()) as ReturnType<typeof useUser>;
    expect(result.user.value?.name).toBe('Alice');
  });

  it('refresh calls fetchUserInfo and updates user ref', async () => {
    const client = buildClient({
      user: { sub: 'u1', name: 'Alice', email: 'alice@example.com' },
    });
    const result = withProvider(client, () => useUser()) as ReturnType<typeof useUser>;
    await result.refresh();
    expect(client.fetchUserInfo).toHaveBeenCalled();
  });
});

// ── usePermissions ────────────────────────────────────────────────

describe('usePermissions', () => {
  it('hasRole returns false when not authenticated', () => {
    const client = buildClient({ authenticated: false, roles: [] });
    const perms = withProvider(client, () => usePermissions()) as ReturnType<typeof usePermissions>;
    expect(perms.hasRole('admin')).toBe(false);
  });

  it('hasRole returns true when client has the role', () => {
    const client = buildClient({ authenticated: true, roles: ['admin'] });
    const perms = withProvider(client, () => usePermissions()) as ReturnType<typeof usePermissions>;
    expect(perms.hasRole('admin')).toBe(true);
  });

  it('hasPermission delegates to client.hasPermission()', () => {
    const client = buildClient({ authenticated: true, roles: ['read:data'] });
    const perms = withProvider(client, () => usePermissions()) as ReturnType<typeof usePermissions>;
    expect(perms.hasPermission('read:data')).toBe(true);
  });

  it('roles computed ref returns an array', () => {
    const client = buildClient({ authenticated: true, roles: ['user', 'editor'] });
    const perms = withProvider(client, () => usePermissions()) as ReturnType<typeof usePermissions>;
    expect(Array.isArray(perms.roles.value)).toBe(true);
  });
});
