import { validateV2Import, isRealmSlug } from './realm-import.validator';
import { SECRET_PLACEHOLDER } from '../secret-placeholder';

const PASSWORD_FLOW = [{ id: 'pw', type: 'password', required: true, order: 1 }];

function base(): Record<string, any> {
  return {
    version: 2,
    realm: { name: 'acme', browserFlow: 'browser', authFlowsEnabled: true },
    authenticationFlows: [{ name: 'browser', steps: PASSWORD_FLOW }],
    clientScopes: [{ name: 'openid', protocolMappers: [] }],
    clients: [
      {
        clientId: 'web',
        redirectUris: ['https://app.example/cb'],
        webOrigins: [],
        authFlow: 'browser',
        defaultScopes: ['openid'],
        serviceAccount: {
          username: 'service-account-web',
          roles: [{ name: 'admin', clientId: null }],
          groups: [],
        },
      },
    ],
    roles: [{ name: 'admin', clientId: null }],
    groups: [{ name: 'staff', parentName: null, roles: [] }],
  };
}

const paths = (payload: Record<string, unknown>) =>
  validateV2Import(payload).problems.map((p) => p.path);

describe('validateV2Import', () => {
  it('accepts a consistent file', () => {
    expect(validateV2Import(base()).problems).toEqual([]);
  });

  it('reports a reference that does not resolve, with its path', () => {
    const p = base();
    p['clients'][0].authFlow = 'missing';
    p['clients'][0].defaultScopes = ['openid', 'nope'];
    p['groups'][0].roles = [{ name: 'ghost', clientId: 'web' }];
    p['realm'].browserFlow = 'gone';
    expect(paths(p)).toEqual(
      expect.arrayContaining([
        'realm.browserFlow',
        'clients[0].authFlow',
        'clients[0].defaultScopes[1]',
        'groups[0].roles[0]',
      ]),
    );
  });

  it('runs the flow validator on every flow', () => {
    const p = base();
    p['authenticationFlows'][0].steps = [
      { id: 'otp', type: 'totp', required: true, order: 1 },
    ];
    const problems = validateV2Import(p).problems;
    expect(problems[0].path).toMatch(/^authenticationFlows\[0\]\.steps/);
    expect(problems[0].message).toContain('first_step_not_identifying');
  });

  it('checks types, enums, nulls and unknown keys', () => {
    const p = base();
    p['realm'].passwordMinLength = 'eight';
    p['realm'].captchaScoreThreshold = 'high';
    p['realm'].enabled = null;
    p['realm'].colour = 'blue';
    p['clients'][0].clientType = 'SECRET';
    p['clients'][0].redirectUris = 'https://x';
    p['extra'] = true;
    const problems = validateV2Import(p).problems;
    const byPath = new Map(problems.map((x) => [x.path, x.message]));
    expect(byPath.get('realm.passwordMinLength')).toContain('integer');
    expect(byPath.get('realm.captchaScoreThreshold')).toContain('number');
    expect(byPath.get('realm.enabled')).toBe('must not be null');
    expect(byPath.get('realm.colour')).toBe('is not a known field');
    expect(byPath.get('clients[0].clientType')).toContain('CONFIDENTIAL');
    expect(byPath.get('clients[0].redirectUris')).toContain('array');
    expect(byPath.get('extra')).toBe('is not a known section');
  });

  it('requires the fields without a default', () => {
    const p = base();
    delete p['clients'][0].clientId;
    p['identityProviders'] = [{ alias: 'g' }];
    expect(paths(p)).toEqual(
      expect.arrayContaining([
        'clients[0].clientId',
        'identityProviders[0].clientId',
        'identityProviders[0].authorizationUrl',
        'identityProviders[0].tokenUrl',
      ]),
    );
    // A missing secret is fine: exports leave them out by default.
    expect(paths(p)).not.toContain('identityProviders[0].clientSecret');
  });

  it('refuses the hidden-value placeholder as a secret', () => {
    const p = base();
    p['realm'].smtpPassword = SECRET_PLACEHOLDER;
    p['realm'].emailProviderConfig = { resend: { apiKey: SECRET_PLACEHOLDER } };
    expect(paths(p)).toEqual(
      expect.arrayContaining([
        'realm.smtpPassword',
        'realm.emailProviderConfig.resend.apiKey',
      ]),
    );
  });

  it('reports duplicates and group cycles', () => {
    const p = base();
    p['roles'].push({ name: 'admin', clientId: null });
    p['groups'] = [
      { name: 'a', parentName: 'b' },
      { name: 'b', parentName: 'a' },
    ];
    const messages = validateV2Import(p).problems.map((x) => x.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        "duplicate role '/admin'",
        "group 'a' is part of a parent cycle",
      ]),
    );
  });

  it('orders groups parents first', () => {
    const p = base();
    p['groups'] = [
      { name: 'leaf', parentName: 'mid' },
      { name: 'mid', parentName: 'root' },
      { name: 'root', parentName: null },
    ];
    expect(validateV2Import(p).groupOrder).toEqual(['root', 'mid', 'leaf']);
  });

  it('checks client authentication settings like the client API', () => {
    const p = base();
    p['clients'][0].tokenEndpointAuthMethod = 'tls_client_auth';
    expect(validateV2Import(p).problems[0]).toEqual({
      path: 'clients[0].tokenEndpointAuthMethod',
      message: expect.stringContaining('exactly one'),
    });
    p['clients'][0].tlsClientAuthSanIp = 'not-an-ip';
    expect(paths(p)).toContain('clients[0].tlsClientAuthSanIp');
  });

  it('refuses SMS MFA without a provider', () => {
    const p = base();
    p['realm'].smsMfaEnabled = true;
    expect(paths(p)).toContain('realm.smsMfaEnabled');
  });

  it('refuses a user that collides with a service account', () => {
    const p = base();
    p['users'] = [{ username: 'service-account-web' }];
    expect(paths(p)).toContain('users[0].username');
  });

  it('canonicalises deny-list entries and checks thumbprints', () => {
    const p = base();
    p['tlsRevokedCertificates'] = [
      { issuerDn: 'CN=Bad CA, O=Acme', serialNumber: '00:0A:FF' },
      { x5tS256: 'short' },
      { serialNumber: '01' },
    ];
    const result = validateV2Import(p);
    expect(result.denyList[0]).toEqual(
      expect.objectContaining({ serialNumber: 'aff' }),
    );
    expect(result.problems.map((x) => x.path)).toEqual([
      'tlsRevokedCertificates[1].x5tS256',
      'tlsRevokedCertificates[2]',
      'tlsRevokedCertificates[2]',
    ]);
  });

  it('reports a malformed certificate', () => {
    const p = base();
    p['tlsTrustAnchors'] = [{ certificatePem: 'not a pem' }];
    expect(paths(p)).toEqual(['tlsTrustAnchors[0].certificatePem']);
  });

  it('needs organization members to be exported users', () => {
    const p = base();
    p['organizations'] = [
      { name: 'Org', slug: 'org', members: [{ username: 'bob' }] },
    ];
    expect(paths(p)).toEqual(['organizations[0].members[0].username']);
  });
});

describe('isRealmSlug', () => {
  it.each([
    ['my-app', true],
    ['a1', true],
    ['-app', false],
    ['app-', false],
    ['My-App', false],
    ['a', false],
    ['a/b', false],
  ])('%s → %s', (name, ok) => {
    expect(isRealmSlug(name)).toBe(ok);
  });
});
