import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BehaviorSubject } from 'rxjs';

// ── We test AuthService logic without Angular DI machinery ────────
// We construct the service manually, injecting a fake AuthmeClient.

// ── Fake AuthmeClient ─────────────────────────────────────────────

function buildFakeClient(opts: {
  authenticated?: boolean;
  user?: { sub: string; name: string } | null;
  roles?: string[];
  initResult?: boolean;
} = {}) {
  const { authenticated = false, user = null, roles = [], initResult = false } = opts;
  let _auth = authenticated;

  const handlers: Record<string, Array<(data?: unknown) => void>> = {};

  return {
    isAuthenticated: vi.fn(() => _auth),
    getUserInfo: vi.fn(() => (_auth ? user : null)),
    getAccessToken: vi.fn(() => (_auth ? 'access-token-xyz' : null)),
    getRealmRoles: vi.fn(() => roles),
    hasRealmRole: vi.fn((role: string) => roles.includes(role)),
    hasPermission: vi.fn((perm: string) => roles.includes(perm)),
    login: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    init: vi.fn(async () => {
      _auth = initResult;
      return initResult;
    }),
    handleCallback: vi.fn(async () => false),
    on: vi.fn((event: string, handler: (data?: unknown) => void) => {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(handler);
      return () => {
        handlers[event] = (handlers[event] ?? []).filter((h) => h !== handler);
      };
    }),
    emit(event: string, data?: unknown) {
      handlers[event]?.forEach((h) => h(data));
    },
    _setAuthenticated(val: boolean) {
      _auth = val;
    },
  };
}

// ── Testable AuthService logic (no decorators needed) ─────────────

class TestableAuthService {
  readonly client: ReturnType<typeof buildFakeClient>;
  private readonly _isAuthenticated$ = new BehaviorSubject<boolean>(false);
  private readonly _isLoading$ = new BehaviorSubject<boolean>(true);
  private readonly _user$ = new BehaviorSubject<{ sub: string; name: string } | null>(null);

  readonly isAuthenticated$ = this._isAuthenticated$.asObservable();
  readonly isLoading$ = this._isLoading$.asObservable();
  readonly user$ = this._user$.asObservable();

  private readonly _unsubscribers: Array<() => void> = [];

  constructor(client: ReturnType<typeof buildFakeClient>) {
    this.client = client;
    this._wireEvents();
  }

  async initialize() {
    try {
      if (typeof window !== 'undefined') {
        const params = new URL(window.location.href).searchParams;
        if (params.has('code')) {
          const success = await this.client.handleCallback();
          this._isAuthenticated$.next(success);
          if (success) this._user$.next(this.client.getUserInfo());
          this._isLoading$.next(false);
          return;
        }
      }
      const restored = await this.client.init();
      this._isAuthenticated$.next(restored);
      if (restored) this._user$.next(this.client.getUserInfo());
    } catch {
      this._isAuthenticated$.next(false);
    } finally {
      this._isLoading$.next(false);
    }
  }

  get isAuthenticated() { return this._isAuthenticated$.value; }
  get isLoading() { return this._isLoading$.value; }
  get user() { return this._user$.value; }

  getToken() { return this.client.getAccessToken(); }
  login(opts?: { scope?: string[] }) { return this.client.login(opts); }
  logout() { return this.client.logout(); }
  hasRole(role: string) { return this.client.hasRealmRole(role); }
  hasPermission(perm: string) { return this.client.hasPermission(perm); }
  getRoles() { return this.client.getRealmRoles(); }

  destroy() {
    this._unsubscribers.forEach((u) => u());
    this._unsubscribers.length = 0;
  }

  private _wireEvents() {
    this._unsubscribers.push(
      this.client.on('login', () => {
        this._isAuthenticated$.next(true);
        this._user$.next(this.client.getUserInfo());
      }),
      this.client.on('logout', () => {
        this._isAuthenticated$.next(false);
        this._user$.next(null);
      }),
      this.client.on('tokenRefresh', () => {
        this._user$.next(this.client.getUserInfo());
      }),
    );
  }
}

// ── Tests ─────────────────────────────────────────────────────────

describe('AuthService (core logic)', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { location: { href: 'http://localhost/' } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts in loading state', () => {
    const client = buildFakeClient();
    const svc = new TestableAuthService(client);
    expect(svc.isLoading).toBe(true);
    svc.destroy();
  });

  it('initializes and marks loading done', async () => {
    const client = buildFakeClient({ initResult: false });
    const svc = new TestableAuthService(client);
    await svc.initialize();
    expect(svc.isLoading).toBe(false);
    svc.destroy();
  });

  it('sets isAuthenticated to true when init restores session', async () => {
    const client = buildFakeClient({
      authenticated: true,
      initResult: true,
      user: { sub: 'u1', name: 'Alice' },
    });
    const svc = new TestableAuthService(client);
    await svc.initialize();
    expect(svc.isAuthenticated).toBe(true);
    svc.destroy();
  });

  it('getToken returns null when not authenticated', async () => {
    const client = buildFakeClient({ authenticated: false });
    const svc = new TestableAuthService(client);
    await svc.initialize();
    expect(svc.getToken()).toBeNull();
    svc.destroy();
  });

  it('getToken returns the access token when authenticated', async () => {
    const client = buildFakeClient({ authenticated: true, initResult: true });
    const svc = new TestableAuthService(client);
    await svc.initialize();
    expect(svc.getToken()).toBe('access-token-xyz');
    svc.destroy();
  });

  it('reacts to login events — updates isAuthenticated and user', async () => {
    const client = buildFakeClient({ authenticated: false });
    const svc = new TestableAuthService(client);
    await svc.initialize();

    expect(svc.isAuthenticated).toBe(false);

    // Simulate login event
    client._setAuthenticated(true);
    (client.getUserInfo as ReturnType<typeof vi.fn>).mockReturnValue({ sub: 'u1', name: 'Bob' });
    client.emit('login', { access_token: 'tok', token_type: 'Bearer', expires_in: 3600 });

    expect(svc.isAuthenticated).toBe(true);
    expect(svc.user?.name).toBe('Bob');
    svc.destroy();
  });

  it('reacts to logout events — clears state', async () => {
    const client = buildFakeClient({ authenticated: true, initResult: true });
    const svc = new TestableAuthService(client);
    await svc.initialize();

    client._setAuthenticated(false);
    client.emit('logout');

    expect(svc.isAuthenticated).toBe(false);
    expect(svc.user).toBeNull();
    svc.destroy();
  });

  it('hasRole delegates to client.hasRealmRole()', async () => {
    const client = buildFakeClient({ authenticated: true, roles: ['admin'] });
    const svc = new TestableAuthService(client);
    await svc.initialize();
    expect(svc.hasRole('admin')).toBe(true);
    expect(svc.hasRole('superuser')).toBe(false);
    svc.destroy();
  });
});
