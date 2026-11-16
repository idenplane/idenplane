/**
 * The documented setups: one client shared by the plugin (or AuthProvider),
 * a router guard defined at module level, and the composables; and
 * AuthProvider initialising the client it provides.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createApp, defineComponent, h, inject, nextTick } from 'vue';
import { createRouter, createMemoryHistory } from 'vue-router';
import { mount, flushPromises } from '@vue/test-utils';
import { IdenplaneClient } from 'idenplane-sdk';
import { IdenplanePlugin, IDENPLANE_KEY, resolvePluginClient } from '../plugin.js';
import { AuthProvider } from '../components.js';
import { createAuthGuard } from '../guard.js';
import { useAuth } from '../composables.js';

function makeClient(initResult = true) {
  let authenticated = false;
  return {
    init: vi.fn(async () => {
      await Promise.resolve();
      authenticated = initResult;
      return initResult;
    }),
    isAuthenticated: vi.fn(() => authenticated),
    hasRealmRole: vi.fn(() => true),
    getUserInfo: vi.fn(() => (authenticated ? { sub: 'user-1', name: 'Demo User' } : null)),
    getAccessToken: vi.fn(() => (authenticated ? 'placeholder-access-token' : null)),
    on: vi.fn(() => () => {}),
    login: vi.fn(),
    logout: vi.fn(),
    handleCallback: vi.fn(),
  };
}

const Home = defineComponent({ render: () => h('p', 'home') });
const Login = defineComponent({ render: () => h('p', 'login') });
const Dashboard = defineComponent({
  setup() {
    const { isAuthenticated } = useAuth();
    return () => h('p', isAuthenticated.value ? 'dashboard: signed in' : 'dashboard: signed out');
  },
});

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: Home },
      { path: '/login', component: Login },
      { path: '/dashboard', component: Dashboard, meta: { requiresAuth: true } },
    ],
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('IdenplanePlugin with a shared client', () => {
  it('provides the given client instead of creating another one', () => {
    const client = makeClient();
    let injected: unknown;
    const Probe = defineComponent({
      setup() {
        injected = inject(IDENPLANE_KEY);
        return () => null;
      },
    });
    mount(Probe, { global: { plugins: [[IdenplanePlugin, { client }]] } });
    expect(injected).toBe(client);
    expect(client.init).toHaveBeenCalledOnce();
  });

  it('still accepts a configuration object', () => {
    const resolved = resolvePluginClient({
      url: 'http://localhost:3000',
      realm: 'demo',
      clientId: 'demo-app',
      redirectUri: 'http://localhost:5173/callback',
    });
    expect(resolved).toBeInstanceOf(IdenplaneClient);
  });

  it('rejects a client option that is not a client', () => {
    expect(() => resolvePluginClient({ client: {} as never })).toThrow(/IdenplaneClient/);
  });

  it('lets a module-level guard and the components share one client and one init()', async () => {
    const client = makeClient(true);
    // As in router/index.ts: created before the app exists, outside any component.
    const router = makeRouter();
    router.beforeEach(createAuthGuard({ loginRoute: '/login' }, client as never));

    const app = createApp(defineComponent({ render: () => h('div', [h(Dashboard)]) }));
    app.use(IdenplanePlugin, { client: client as never });
    app.use(router);

    await router.push('/dashboard');
    expect(router.currentRoute.value.fullPath).toBe('/dashboard');

    const el = document.createElement('div');
    document.body.appendChild(el);
    app.mount(el);
    await flushPromises();
    expect(el.textContent).toContain('dashboard: signed in');

    // plugin + guard + useAuth all went through the same init()
    expect(client.init).toHaveBeenCalledOnce();
    app.unmount();
  });

  it('redirects to login when the shared client is signed out', async () => {
    const client = makeClient(false);
    const router = makeRouter();
    router.beforeEach(createAuthGuard({ loginRoute: '/login' }, client as never));
    const app = createApp(defineComponent({ render: () => null }));
    app.use(IdenplanePlugin, { client: client as never });
    app.use(router);

    await router.push('/dashboard');
    expect(router.currentRoute.value.path).toBe('/login');
    expect(router.currentRoute.value.query['next']).toBe('/dashboard');
  });

  it('finds the plugin client from a module-level guard created without one (Vue 3.3+ / vue-router 4.2+)', async () => {
    const client = makeClient(true);
    const router = makeRouter();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    router.beforeEach(createAuthGuard({ loginRoute: '/login' }));

    const app = createApp(defineComponent({ render: () => null }));
    app.use(IdenplanePlugin, { client: client as never });
    app.use(router);

    await router.push('/dashboard');
    expect(router.currentRoute.value.fullPath).toBe('/dashboard');
    expect(warn).not.toHaveBeenCalled();
  });

  it('fails closed when no client can be found', async () => {
    const router = makeRouter();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    router.beforeEach(createAuthGuard({ loginRoute: '/login' }));
    const app = createApp(defineComponent({ render: () => null }));
    app.use(router); // no plugin

    await router.push('/dashboard');
    expect(router.currentRoute.value.path).toBe('/login');
    expect(warn).toHaveBeenCalled();
  });
});

describe('createAuthGuard login route', () => {
  it('does not loop when global roles are required and the user is signed out', async () => {
    const client = makeClient(false);
    const router = makeRouter();
    router.beforeEach(createAuthGuard({ loginRoute: '/login', roles: ['admin'] }, client as never));
    const app = createApp(defineComponent({ render: () => null }));
    app.use(router);
    await router.push('/');
    expect(router.currentRoute.value.path).toBe('/login');
    expect(router.currentRoute.value.query['next']).toBe('/');
  });

  it('lets unprotected routes through even without a client', async () => {
    const router = makeRouter();
    router.beforeEach(createAuthGuard({ loginRoute: '/login' }));
    const app = createApp(defineComponent({ render: () => null }));
    app.use(router);
    await router.push('/');
    expect(router.currentRoute.value.path).toBe('/');
  });
});

describe('AuthProvider', () => {
  const Child = defineComponent({
    setup() {
      const { isAuthenticated, isLoading } = useAuth();
      return () => h('p', isLoading.value ? 'loading' : isAuthenticated.value ? 'in' : 'out');
    },
  });

  it('calls init() on the client it creates', async () => {
    const init = vi.spyOn(IdenplaneClient.prototype, 'init').mockResolvedValue(false);
    mount(AuthProvider, {
      props: {
        url: 'http://localhost:3000',
        realm: 'demo',
        clientId: 'demo-app',
        redirectUri: 'http://localhost:5173/callback',
      },
      slots: { default: () => h('span', 'content') },
    });
    expect(init).toHaveBeenCalledOnce();
  });

  it('initialises even when no child uses a composable', async () => {
    const client = makeClient(true);
    mount(AuthProvider, { props: { client: client as never }, slots: { default: () => h('span') } });
    expect(client.init).toHaveBeenCalledOnce();
    await flushPromises();
    expect(client.isAuthenticated()).toBe(true);
  });

  it('provides a given client and shares its init() with the children', async () => {
    const client = makeClient(true);
    const wrapper = mount(AuthProvider, {
      props: { client: client as never },
      slots: { default: () => h(Child) },
    });
    await flushPromises();
    await nextTick();
    expect(wrapper.text()).toBe('in');
    expect(client.init).toHaveBeenCalledOnce();
  });

  it('requires a client or the connection props', () => {
    const err = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => mount(AuthProvider, { props: { realm: 'demo' } })).toThrow(/AuthProvider needs/);
    err.mockRestore();
  });
});
