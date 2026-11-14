import { NotFoundException } from '@nestjs/common';
import { RealmExportService } from './realm-export.service.js';
import { CryptoService } from '../crypto/crypto.service.js';

/**
 * A Prisma stand-in: every model's findMany resolves to its fixture rows
 * (none by default), so the export can read all the tables it needs.
 */
function fakePrisma(rows: Record<string, unknown[]>, realm: unknown) {
  const models = new Map<string, Record<string, jest.Mock>>();
  return new Proxy(
    {},
    {
      get(_target, model: string) {
        let m = models.get(model);
        if (!m) {
          m = {
            findMany: jest.fn().mockResolvedValue(rows[model] ?? []),
            findUnique: jest.fn().mockResolvedValue(
              model === 'realm' ? realm : null,
            ),
          };
          models.set(model, m);
        }
        return m;
      },
    },
  ) as any;
}

describe('RealmExportService', () => {
  const crypto = new CryptoService();

  const realm = {
    id: 'realm-1',
    name: 'test-realm',
    displayName: 'Test Realm',
    enabled: true,
    smtpPassword: crypto.encryptSecret('smtp-pass'),
    recaptchaSecretKey: null,
    hcaptchaSecretKey: crypto.encryptSecret('hcaptcha-secret'),
    emailProvider: 'resend',
    emailProviderConfig: { resend: { apiKey: crypto.encryptSecret('re_x') } },
    smsProvider: 'twilio',
    smsProviderConfig: {
      twilioAccountSid: 'AC1',
      twilioAuthToken: crypto.encryptSecret('tw-token'),
    },
    browserFlowId: 'flow-1',
    mfaRequired: true,
    rateLimitEnabled: true,
    mtlsClientAuthEnabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const client = (over: Record<string, unknown> = {}) => ({
    id: 'client-db-1',
    realmId: 'realm-1',
    clientId: 'my-app',
    clientType: 'CONFIDENTIAL',
    clientSecret: 'sha256$abc',
    redirectUris: ['http://localhost/callback'],
    webOrigins: [],
    grantTypes: ['client_credentials'],
    authFlowId: 'flow-1',
    serviceAccountUserId: 'sa-user',
    nhiIdentityId: null,
    requiredAcr: 'urn:acr:2',
    tlsClientCertificateBoundAccessTokens: true,
    ...over,
  });

  const rows = () => ({
    authenticationFlow: [{ id: 'flow-1', name: 'browser', steps: [] }],
    clientScope: [{ id: 'scope-1', name: 'openid', protocolMappers: [] }],
    client: [
      client(),
      client({
        id: 'client-db-2',
        clientId: 'device-1',
        nhiIdentityId: 'nhi-1',
        serviceAccountUserId: null,
      }),
    ],
    role: [
      { id: 'role-1', name: 'admin', clientId: null },
      { id: 'role-2', name: 'client-admin', clientId: 'client-db-1' },
      { id: 'role-3', name: 'device-role', clientId: 'client-db-2' },
    ],
    group: [
      { id: 'g1', name: 'parent', parentId: null },
      { id: 'g2', name: 'child', parentId: 'g1' },
    ],
    groupRole: [
      { groupId: 'g2', roleId: 'role-2' },
      { groupId: 'g2', roleId: 'role-3' },
    ],
    clientDefaultScope: [{ clientId: 'client-db-1', clientScopeId: 'scope-1' }],
    identityProvider: [
      { alias: 'google', clientId: 'g', clientSecret: 'google-secret' },
    ],
    webhook: [
      { url: 'https://hooks.example', secret: crypto.encrypt('hook-secret') },
    ],
    organization: [],
    userFederation: [],
    consentCategory: [],
    user: [
      {
        id: 'sa-user',
        username: 'service-account-my-app',
        enabled: true,
        userRoles: [{ roleId: 'role-1' }],
        userGroups: [],
      },
    ],
  });

  const make = (realmRow: unknown = realm) =>
    new RealmExportService(fakePrisma(rows(), realmRow), crypto);

  it('throws NotFoundException when the realm does not exist', async () => {
    await expect(make(null).exportRealm('nonexistent')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('exports version 2 with references as natural keys', async () => {
    const out: any = await make().exportRealm('test-realm');

    expect(out.version).toBe(2);
    expect(out.realm.name).toBe('test-realm');
    expect(out.realm.browserFlow).toBe('browser');
    expect(out.realm.mfaRequired).toBe(true);
    expect(out.realm.mtlsClientAuthEnabled).toBe(true);
    expect(out.realm).not.toHaveProperty('id');
    expect(out.realm).not.toHaveProperty('browserFlowId');

    expect(out.clients).toHaveLength(1);
    const c = out.clients[0];
    expect(c.clientId).toBe('my-app');
    expect(c.authFlow).toBe('browser');
    expect(c.requiredAcr).toBe('urn:acr:2');
    expect(c.defaultScopes).toEqual(['openid']);
    expect(c.serviceAccount).toEqual({
      username: 'service-account-my-app',
      enabled: true,
      roles: [{ name: 'admin', clientId: null }],
      groups: [],
    });
    expect(c).not.toHaveProperty('authFlowId');
    expect(c).not.toHaveProperty('serviceAccountUserId');

    expect(out.roles).toEqual([
      { name: 'admin', description: undefined, clientId: null },
      { name: 'client-admin', description: undefined, clientId: 'my-app' },
    ]);
    // Sorted by name, so two exports of one realm compare equal.
    expect(out.groups.map((g: any) => g.name)).toEqual(['child', 'parent']);
    expect(out.groups[1].parentName).toBeNull();
    expect(out.groups[0].parentName).toBe('parent');
    expect(out.groups[0].roles).toEqual([
      { name: 'client-admin', clientId: 'my-app' },
    ]);
  });

  it('leaves out clients of NHI identities, and says so', async () => {
    const out: any = await make().exportRealm('test-realm');

    expect(out.clients.map((c: any) => c.clientId)).toEqual(['my-app']);
    expect(out.roles.map((r: any) => r.name)).not.toContain('device-role');
    expect(out.omitted).toEqual([
      expect.objectContaining({ type: 'client', key: 'device-1' }),
    ]);
  });

  it('leaves every secret out by default', async () => {
    const out: any = await make().exportRealm('test-realm');

    expect(out.secretsIncluded).toBe(false);
    expect(out.realm).not.toHaveProperty('smtpPassword');
    expect(out.realm).not.toHaveProperty('hcaptchaSecretKey');
    expect(out.realm.emailProviderConfig).toEqual({ resend: {} });
    expect(out.realm.smsProviderConfig).toEqual({ twilioAccountSid: 'AC1' });
    expect(out.clients[0]).not.toHaveProperty('clientSecret');
    expect(out.identityProviders[0]).not.toHaveProperty('clientSecret');
    expect(out.webhooks[0]).not.toHaveProperty('secret');
  });

  it('exports secrets decrypted with includeSecrets, hashes as they are', async () => {
    const out: any = await make().exportRealm('test-realm', {
      includeSecrets: true,
    });

    expect(out.secretsIncluded).toBe(true);
    expect(out.realm.smtpPassword).toBe('smtp-pass');
    expect(out.realm.hcaptchaSecretKey).toBe('hcaptcha-secret');
    expect(out.realm.recaptchaSecretKey).toBeNull();
    expect(out.realm.emailProviderConfig).toEqual({
      resend: { apiKey: 're_x' },
    });
    expect(out.realm.smsProviderConfig.twilioAuthToken).toBe('tw-token');
    expect(out.clients[0].clientSecret).toBe('sha256$abc');
    expect(out.identityProviders[0].clientSecret).toBe('google-secret');
    expect(out.webhooks[0].secret).toBe('hook-secret');
  });

  it('includes users only when asked, without service accounts', async () => {
    const without: any = await make().exportRealm('test-realm');
    expect(without.users).toBeUndefined();

    const prisma = fakePrisma(
      {
        ...rows(),
        user: [
          {
            id: 'u1',
            username: 'alice',
            passwordHash: '$argon2id$x',
            userRoles: [{ roleId: 'role-1' }],
            userGroups: [{ groupId: 'g1' }],
          },
        ],
      },
      realm,
    );
    const out: any = await new RealmExportService(prisma, crypto).exportRealm(
      'test-realm',
      { includeUsers: true },
    );
    expect(out.users).toHaveLength(1);
    expect(out.users[0].username).toBe('alice');
    expect(out.users[0]).not.toHaveProperty('passwordHash');
    expect(out.users[0].roles).toEqual([{ name: 'admin', clientId: null }]);
    expect(out.users[0].groups).toEqual(['parent']);
    // Service-account users are queried out: they travel with their client.
    const userQuery = prisma.user.findMany.mock.calls.find(
      (call: any[]) => call[0]?.where?.id?.notIn,
    );
    expect(userQuery[0].where.id.notIn).toEqual(['sa-user']);
  });
});
