import { describe, it, expect } from 'vitest';
import { hostedSignUpUrl } from '../signUp';

describe('hostedSignUpUrl', () => {
  it('points at the hosted sign-up page of the realm', () => {
    expect(hostedSignUpUrl('acme', '')).toBe('/realms/acme/register');
  });

  it('passes the query string on (OAuth parameters for the hosted page)', () => {
    expect(hostedSignUpUrl('acme', '?client_id=web&redirect_uri=https%3A%2F%2Fapp')).toBe(
      '/realms/acme/register?client_id=web&redirect_uri=https%3A%2F%2Fapp',
    );
  });

  it('drops an empty query', () => {
    expect(hostedSignUpUrl('acme', '?')).toBe('/realms/acme/register');
  });

  it.each([undefined, '', '.', '..', 'a/b', 'a%2Fb', 'a b', 'a?b', 'a#b', 'a\\b', '//evil.example'])(
    'refuses %j, which cannot be a realm path segment',
    (realm) => {
      expect(hostedSignUpUrl(realm, '?x=1')).toBeNull();
    },
  );

  it('refuses an overlong name', () => {
    expect(hostedSignUpUrl('a'.repeat(256), '')).toBeNull();
  });

  it('always yields a same-origin path', () => {
    for (const realm of ['master', 'my-realm', 'r.1', 'x~y']) {
      expect(hostedSignUpUrl(realm, '')).toBe(`/realms/${realm}/register`);
    }
  });
});
