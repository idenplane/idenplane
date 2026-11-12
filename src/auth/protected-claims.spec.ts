import { withProtectedClaims } from './auth.service.js';

describe('withProtectedClaims', () => {
  const server = {
    iss: 'https://idp/realms/a',
    sub: 'user-1',
    aud: 'web',
    azp: 'web',
    scope: 'openid',
    typ: 'Bearer',
    acr: 'urn:idenplane:acr:password',
  };

  it('restores claims a mapper or plugin overwrote', () => {
    const result = withProtectedClaims(
      {
        ...server,
        sub: 'admin',
        aud: 'other-api',
        acr: 'urn:idenplane:acr:mfa',
        department: 'ops',
      },
      server,
    );

    expect(result).toMatchObject(server);
    expect(result['department']).toBe('ops');
  });

  it('removes protected claims the server did not set', () => {
    const result = withProtectedClaims(
      {
        ...server,
        sid: 'forged',
        amr: ['hwk'],
        cnf: { 'x5t#S256': 'x' },
        nbf: 1,
      },
      server,
    );

    expect(result).not.toHaveProperty('sid');
    expect(result).not.toHaveProperty('amr');
    expect(result).not.toHaveProperty('cnf');
    expect(result).not.toHaveProperty('nbf');
  });

  it('puts back protected claims a plugin deleted', () => {
    const { sub: _sub, ...withoutSub } = server;

    expect(withProtectedClaims(withoutSub, server).sub).toBe('user-1');
  });
});
