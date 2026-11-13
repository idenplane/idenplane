import { resolveUserClaims, type UserClaimSource } from './claims.resolver.js';

describe('resolveUserClaims', () => {
  const user: UserClaimSource = {
    id: 'u1',
    username: 'jane',
    email: 'jane@example.com',
    emailVerified: true,
    firstName: 'Jane',
    lastName: 'Doe',
    updatedAt: new Date('2026-11-01T10:00:00.900Z'),
  };

  it('sends updated_at in seconds with the profile scope', () => {
    const claims = resolveUserClaims(
      user,
      new Set(['name', 'given_name', 'family_name', 'updated_at']),
    );

    expect(claims['updated_at']).toBe(
      Math.floor(Date.parse('2026-11-01T10:00:00Z') / 1000),
    );
    expect(claims['name']).toBe('Jane Doe');
  });

  it('leaves updated_at out without the profile scope', () => {
    const claims = resolveUserClaims(user, new Set(['email']));

    expect(claims).toEqual({
      sub: 'u1',
      email: 'jane@example.com',
    });
  });
});
