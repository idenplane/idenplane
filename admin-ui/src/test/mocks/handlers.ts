import { http, HttpResponse } from 'msw';
import { makeRealm, makeUser, makeClient, makeLoginEvent, makeAdminEvent, makeStats, makeAuthFlow, makeUpgradeAuditEntry, makePreUpgradeValidationResult, makeUpgradeHealthResult, makeRollbackCapability, makeNhiIdentity, makeConsentCategory } from './data';

const BASE = '/admin';

export const handlers = [
  // Auth
  http.post(`${BASE}/auth/login`, async ({ request }) => {
    const body = await request.json() as { username?: string; password?: string };
    if (body.username === 'admin' && body.password === 'password') {
      return HttpResponse.json({ access_token: 'mock-token-abc123' });
    }
    return HttpResponse.json({ message: 'Invalid credentials' }, { status: 401 });
  }),

  http.post(`${BASE}/auth/logout`, () => {
    return HttpResponse.json({ message: 'Logged out' });
  }),

  // Demo-mode hint — default to "not a demo" so the login page behaves
  // normally; demo-specific tests can override this with server.use(...).
  http.get(`${BASE}/auth/demo-info`, () => {
    return HttpResponse.json({ demo: false });
  }),

  // Realms
  http.get(`${BASE}/realms`, () => {
    return HttpResponse.json([
      makeRealm({ id: 'realm-1', name: 'master', displayName: 'Master' }),
      makeRealm({ id: 'realm-2', name: 'test-realm', displayName: 'Test Realm' }),
    ]);
  }),

  http.get(`${BASE}/realms/:name`, ({ params }) => {
    return HttpResponse.json(
      makeRealm({ name: params.name as string, displayName: String(params.name) }),
    );
  }),

  http.post(`${BASE}/realms`, async ({ request }) => {
    const body = await request.json() as Partial<ReturnType<typeof makeRealm>>;
    return HttpResponse.json(makeRealm({ ...body }), { status: 201 });
  }),

  http.put(`${BASE}/realms/:name`, async ({ params, request }) => {
    const body = await request.json() as Partial<ReturnType<typeof makeRealm>>;
    return HttpResponse.json(makeRealm({ name: params.name as string, ...body }));
  }),

  http.delete(`${BASE}/realms/:name`, () => {
    return new HttpResponse(null, { status: 204 });
  }),

  // Users
  http.get(`${BASE}/realms/:name/users`, ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page') ?? 1);
    const limit = Number(url.searchParams.get('limit') ?? 20);
    const users = [
      makeUser({ id: 'user-1', username: 'alice', email: 'alice@example.com' }),
      makeUser({ id: 'user-2', username: 'bob', email: 'bob@example.com', enabled: false }),
    ];
    const sliced = users.slice((page - 1) * limit, page * limit);
    return HttpResponse.json({ users: sliced, total: users.length });
  }),

  http.get(`${BASE}/realms/:name/users/:id`, ({ params }) => {
    return HttpResponse.json(
      makeUser({ id: params.id as string }),
    );
  }),

  http.post(`${BASE}/realms/:name/users`, async ({ request }) => {
    const body = await request.json() as Partial<ReturnType<typeof makeUser>>;
    return HttpResponse.json(makeUser({ ...body, id: 'new-user-1' }), { status: 201 });
  }),

  http.put(`${BASE}/realms/:name/users/:id`, async ({ params, request }) => {
    const body = await request.json() as Partial<ReturnType<typeof makeUser>>;
    return HttpResponse.json(makeUser({ id: params.id as string, ...body }));
  }),

  http.delete(`${BASE}/realms/:name/users/:id`, () => {
    return new HttpResponse(null, { status: 204 });
  }),

  // Clients
  http.get(`${BASE}/realms/:name/clients`, () => {
    return HttpResponse.json([
      makeClient({ id: 'client-1', clientId: 'my-app', clientType: 'CONFIDENTIAL' }),
      makeClient({ id: 'client-2', clientId: 'public-app', clientType: 'PUBLIC', name: 'Public App' }),
    ]);
  }),

  http.get(`${BASE}/realms/:name/clients/:id`, ({ params }) => {
    return HttpResponse.json(
      makeClient({ clientId: params.id as string }),
    );
  }),

  http.post(`${BASE}/realms/:name/clients`, async ({ request }) => {
    const body = await request.json() as Partial<ReturnType<typeof makeClient>>;
    return HttpResponse.json(
      makeClient({ ...body, id: 'new-client-1', clientSecret: 'super-secret-value' }),
      { status: 201 },
    );
  }),

  http.put(`${BASE}/realms/:name/clients/:id`, async ({ params, request }) => {
    const body = await request.json() as Partial<ReturnType<typeof makeClient>>;
    return HttpResponse.json(makeClient({ id: params.id as string, ...body }));
  }),

  http.delete(`${BASE}/realms/:name/clients/:id`, () => {
    return new HttpResponse(null, { status: 204 });
  }),

  // Non-Human Identities
  http.get(`${BASE}/realms/:name/nhi`, () => {
    return HttpResponse.json([
      makeNhiIdentity({
        id: 'nhi-1',
        name: 'sensor-gateway-01',
        identityType: 'IOT_DEVICE',
        lifecycleStatus: 'ACTIVE',
        enabled: true,
        certificateFingerprint: 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99',
      }),
      makeNhiIdentity({
        id: 'nhi-2',
        name: 'ai-assistant-01',
        identityType: 'AI_AGENT',
        lifecycleStatus: 'PROVISIONING',
        enabled: true,
        certificateFingerprint: '11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00',
      }),
    ]);
  }),

  // Stats
  http.get(`${BASE}/realms/:name/stats`, () => {
    return HttpResponse.json(makeStats());
  }),

  // Events (for dashboard)
  http.get(`${BASE}/realms/:name/events`, () => {
    return HttpResponse.json([
      makeLoginEvent({ id: 'ev-1', type: 'LOGIN', userId: 'user-1' }),
      makeLoginEvent({ id: 'ev-2', type: 'LOGIN_ERROR', userId: 'user-2', error: 'Invalid credentials' }),
    ]);
  }),

  http.get(`${BASE}/realms/:name/admin-events`, () => {
    return HttpResponse.json([
      makeAdminEvent({ id: 'adm-1', operationType: 'CREATE', resourceType: 'USER', resourcePath: '/users/user-1' }),
    ]);
  }),

  // Auth Flows
  http.get(`${BASE}/realms/:name/auth-flows`, () => {
    return HttpResponse.json([
      makeAuthFlow({ id: 'flow-1', name: 'Basic Login', isDefault: true }),
      makeAuthFlow({ id: 'flow-2', name: 'MFA Required', isDefault: false }),
    ]);
  }),

  http.get(`${BASE}/realms/:name/auth-flows/:id`, ({ params }) => {
    return HttpResponse.json(
      makeAuthFlow({ id: params.id as string }),
    );
  }),

  http.post(`${BASE}/realms/:name/auth-flows`, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    return HttpResponse.json(
      makeAuthFlow({ ...body, id: 'new-flow-1' }),
      { status: 201 },
    );
  }),

  http.put(`${BASE}/realms/:name/auth-flows/:id`, async ({ params, request }) => {
    const body = await request.json() as Record<string, unknown>;
    return HttpResponse.json(
      makeAuthFlow({ id: params.id as string, ...body }),
    );
  }),

  http.delete(`${BASE}/realms/:name/auth-flows/:id`, () => {
    return new HttpResponse(null, { status: 204 });
  }),

  // Health
  http.get('/health/ready', () => {
    return HttpResponse.json({
      status: 'ok',
      info: { database: { status: 'up' }, memory_heap: { status: 'up' } },
    });
  }),

  // Upgrade endpoints
  http.get(`${BASE}/upgrade/status`, () => {
    return HttpResponse.json(
      makeUpgradeAuditEntry({
        status: 'COMPLETED',
        fromVersion: '1.0.0',
        toVersion: '1.1.0',
      }),
    );
  }),

  http.get(`${BASE}/upgrade/history`, ({ request }) => {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get('limit') ?? 10);
    const entries = [
      makeUpgradeAuditEntry({ id: 'upgrade-1', status: 'COMPLETED' }),
      makeUpgradeAuditEntry({ id: 'upgrade-2', status: 'COMPLETED', fromVersion: '0.9.0', toVersion: '1.0.0' }),
      makeUpgradeAuditEntry({ id: 'upgrade-3', status: 'FAILED', toVersion: '1.2.0', errorMessage: 'Database migration failed' }),
    ];
    return HttpResponse.json(entries.slice(0, limit));
  }),

  http.get(`${BASE}/upgrade/pre-validation`, () => {
    return HttpResponse.json(makePreUpgradeValidationResult());
  }),

  http.get(`${BASE}/upgrade/health`, () => {
    return HttpResponse.json(makeUpgradeHealthResult());
  }),

  http.get(`${BASE}/upgrade/rollback/capability`, () => {
    return HttpResponse.json(makeRollbackCapability());
  }),

  // Theme versions
  http.get(`${BASE}/realms/:name/themes/:themeId/versions`, () => {
    return HttpResponse.json([
      {
        id: 'v2',
        themeId: 'test-theme-id',
        version: 2,
        changes: 'Second version',
        checksum: 'abc123',
        styles: {},
        components: [],
        assets: {},
        settings: {},
        createdAt: new Date().toISOString(),
        createdBy: 'admin',
      },
      {
        id: 'v1',
        themeId: 'test-theme-id',
        version: 1,
        changes: 'Initial version',
        checksum: 'def456',
        styles: {},
        components: [],
        assets: {},
        settings: {},
        createdAt: new Date(Date.now() - 3600000).toISOString(),
        createdBy: 'admin',
      },
    ]);
  }),

  // Consent categories
  http.get(`${BASE}/realms/:name/consent-categories`, () => {
    return HttpResponse.json([
      makeConsentCategory({ id: 'cat-1', key: 'marketing', displayName: 'Marketing' }),
      makeConsentCategory({
        id: 'cat-2',
        key: 'analytics',
        displayName: 'Analytics',
        required: true,
      }),
    ]);
  }),

  http.get(`${BASE}/realms/:name/consent-categories/:id/stats`, ({ params }) => {
    return HttpResponse.json({
      categoryId: params.id,
      categoryKey: 'marketing',
      categoryName: 'Marketing',
      totalGrants: 120,
      totalRevokes: 8,
      grants24h: 5,
      grants7d: 30,
      grants30d: 95,
      activeUsers24h: 4,
      activeUsers7d: 22,
      activeUsers30d: 70,
    });
  }),

  http.get(`${BASE}/realms/:name/consent-categories/:id`, ({ params }) => {
    return HttpResponse.json(
      makeConsentCategory({ id: params.id as string }),
    );
  }),

  http.post(`${BASE}/realms/:name/consent-categories`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json(makeConsentCategory({ id: 'cat-new', ...body }), {
      status: 201,
    });
  }),

  http.put(`${BASE}/realms/:name/consent-categories/:id`, async ({ params, request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json(
      makeConsentCategory({ id: params.id as string, ...body }),
    );
  }),

  http.delete(`${BASE}/realms/:name/consent-categories/:id`, () => {
    return new HttpResponse(null, { status: 204 });
  }),

  // Consent statistics (realm)
  http.get(`${BASE}/realms/:name/stats/consents`, () => {
    return HttpResponse.json({
      totalConsents: 42,
      activeUsersWithConsents24h: 5,
      activeUsersWithConsents7d: 12,
      activeUsersWithConsents30d: 30,
      consentActionsLast24h: 8,
      consentActionsLast7d: 25,
      consentActionsLast30d: 60,
      consentsGranted24h: 6,
      consentsRevoked24h: 1,
      consentsUpdated24h: 1,
      consentsByCategory: [
        {
          categoryId: 'cat-1',
          categoryKey: 'marketing',
          categoryName: 'Marketing',
          required: false,
          totalGrants: 120,
          distinctUsers: 70,
        },
      ],
      pendingDeletions: 3,
      pendingDeletionsGracePeriod: 1,
    });
  }),
];
