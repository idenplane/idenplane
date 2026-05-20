import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseJwt, isTokenExpired, getTokenExpiresIn } from '../token.js';

// Helper: create a fake JWT with the given payload (handles unicode)
function createJwt(payload: Record<string, unknown>): string {
  const encode = (obj: unknown) => {
    const json = JSON.stringify(obj);
    const bytes = new TextEncoder().encode(json);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const header = encode({ alg: 'RS256', typ: 'JWT' });
  const body = encode(payload);
  return `${header}.${body}.fake-signature`;
}

describe('parseJwt', () => {
  it('should parse a valid JWT and return the payload', () => {
    const jwt = createJwt({ sub: 'user-1', exp: 9999999999, iss: 'authme' });
    const claims = parseJwt(jwt);

    expect(claims.sub).toBe('user-1');
    expect(claims.exp).toBe(9999999999);
    expect(claims.iss).toBe('authme');
  });

  it('should handle unicode characters in the payload', () => {
    const jwt = createJwt({ sub: 'user-1', name: 'أحمد', exp: 9999999999 });
    const claims = parseJwt(jwt);

    expect(claims.name).toBe('أحمد');
  });

  it('should throw on invalid JWT format (not 3 parts)', () => {
    expect(() => parseJwt('not-a-jwt')).toThrow('Invalid JWT format');
    expect(() => parseJwt('a.b')).toThrow('Invalid JWT format');
    expect(() => parseJwt('a.b.c.d')).toThrow('Invalid JWT format');
  });
});

describe('isTokenExpired', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return false for a non-expired token', () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    expect(isTokenExpired({ exp: futureExp } as any)).toBe(false);
  });

  it('should return true for an expired token', () => {
    const pastExp = Math.floor(Date.now() / 1000) - 60;
    expect(isTokenExpired({ exp: pastExp } as any)).toBe(true);
  });

  it('should account for clock skew', () => {
    const exp = Math.floor(Date.now() / 1000) + 10;
    // Without skew: not expired
    expect(isTokenExpired({ exp } as any, 0)).toBe(false);
    // With 30s skew: expired (since exp - now = 10, and 10 <= 30)
    expect(isTokenExpired({ exp } as any, 30)).toBe(true);
  });
});

describe('getTokenExpiresIn', () => {
  it('should return seconds until expiry for a valid token', () => {
    const exp = Math.floor(Date.now() / 1000) + 300;
    const expiresIn = getTokenExpiresIn({ exp } as any);

    // Allow 1 second tolerance
    expect(expiresIn).toBeGreaterThanOrEqual(299);
    expect(expiresIn).toBeLessThanOrEqual(300);
  });

  it('should return 0 for an expired token', () => {
    const exp = Math.floor(Date.now() / 1000) - 60;
    expect(getTokenExpiresIn({ exp } as any)).toBe(0);
  });
});
