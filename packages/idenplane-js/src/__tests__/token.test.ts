import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  parseJwt,
  decodeJwtPayload,
  extractBearerToken,
  getRolesFromToken,
  isTokenExpired,
  getTokenExpiresIn,
} from '../token.js';

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
    const jwt = createJwt({ sub: 'user-1', exp: 9999999999, iss: 'idenplane' });
    const claims = parseJwt(jwt);

    expect(claims.sub).toBe('user-1');
    expect(claims.exp).toBe(9999999999);
    expect(claims.iss).toBe('idenplane');
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

describe('decodeJwtPayload', () => {
  it('should decode a valid JWT and return the payload', () => {
    const jwt = createJwt({ sub: 'user-1', exp: 9999999999 });
    expect(decodeJwtPayload(jwt)).toMatchObject({ sub: 'user-1', exp: 9999999999 });
  });

  it('should return null for malformed input (not 3 parts)', () => {
    expect(decodeJwtPayload('not-a-jwt')).toBeNull();
    expect(decodeJwtPayload('a.b')).toBeNull();
    expect(decodeJwtPayload('a.b.c.d')).toBeNull();
  });

  it('should return null for a payload segment that is not valid base64url JSON', () => {
    expect(decodeJwtPayload('a.not-valid-json-!!!.c')).toBeNull();
  });

  // The base64url payload segment's length mod 4 varies with the JSON
  // payload's byte length, and each remainder (0, 2, 3 — 1 is impossible
  // for valid base64) exercises different padding behavior in `atob`.
  // Missing `=` padding must not cause a decode failure for any of them.
  it.each([0, 1, 2, 3, 4, 5, 6, 7, 8])(
    'should correctly decode payloads regardless of base64url padding remainder (extra chars: %i)',
    (extraChars) => {
      const jwt = createJwt({ sub: 'user-1', pad: 'x'.repeat(extraChars) });
      expect(decodeJwtPayload(jwt)).toMatchObject({ sub: 'user-1', pad: 'x'.repeat(extraChars) });
    },
  );
});

describe('extractBearerToken', () => {
  it('should extract the token from a Bearer header', () => {
    expect(extractBearerToken('Bearer my-token-123')).toBe('my-token-123');
  });

  it('should return null for a missing header', () => {
    expect(extractBearerToken(undefined)).toBeNull();
    expect(extractBearerToken(null)).toBeNull();
  });

  it('should return null for a non-Bearer scheme', () => {
    expect(extractBearerToken('Basic dXNlcjpwYXNz')).toBeNull();
  });

  it('should use the first value when given an array of header values', () => {
    expect(extractBearerToken(['Bearer token-a', 'Bearer token-b'])).toBe('token-a');
  });
});

describe('getRolesFromToken', () => {
  const payload = {
    realm_access: { roles: ['user', 'admin'] },
    resource_access: { 'test-client': { roles: ['read', 'write'] } },
  };

  it('should return realm roles when no clientId is given', () => {
    expect(getRolesFromToken(payload)).toEqual(['user', 'admin']);
  });

  it('should return client roles for the given clientId', () => {
    expect(getRolesFromToken(payload, 'test-client')).toEqual(['read', 'write']);
  });

  it('should return an empty array for an unknown client', () => {
    expect(getRolesFromToken(payload, 'unknown-client')).toEqual([]);
  });

  it('should return an empty array for null/undefined claims', () => {
    expect(getRolesFromToken(null)).toEqual([]);
    expect(getRolesFromToken(undefined)).toEqual([]);
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
