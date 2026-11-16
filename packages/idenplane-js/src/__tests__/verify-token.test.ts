/**
 * verifyToken with real signatures: keys are generated at runtime and the
 * remote JWKS is swapped for a local one, so issuer, audience, `typ`,
 * algorithm and signature checks all run for real (nothing in `jose` is
 * mocked except where the key set is fetched from).
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import type * as Jose from 'jose';
import type { IdenplaneTokenPayload } from '../server.js';

vi.mock('jose', async (importOriginal) => {
  const actual = await importOriginal<typeof Jose>();
  return { ...actual, createRemoteJWKSet: vi.fn() };
});

const jose = await import('jose');
const {
  verifyToken,
  InvalidTokenTypeError,
  createIdenplaneMiddleware,
  createIdenplaneGuard,
  createNextMiddleware,
  getServerSideAuth,
} = await import('../server.js');

const ISSUER_URL = 'https://idp.example.com';
const REALM = 'demo';
const ISSUER = `${ISSUER_URL}/realms/${REALM}`;
const CLIENT_ID = 'demo-spa';
const config = { issuerUrl: ISSUER_URL, realm: REALM, audience: CLIENT_ID };

let realmKey: CryptoKey;
let otherKey: CryptoKey;

beforeAll(async () => {
  const realm = await jose.generateKeyPair('RS256', { extractable: true });
  const other = await jose.generateKeyPair('RS256', { extractable: true });
  realmKey = realm.privateKey;
  otherKey = other.privateKey;
  const jwk = { ...(await jose.exportJWK(realm.publicKey)), kid: 'realm-key', alg: 'RS256' };
  vi.mocked(jose.createRemoteJWKSet).mockReturnValue(
    jose.createLocalJWKSet({ keys: [jwk] }) as unknown as ReturnType<typeof jose.createRemoteJWKSet>,
  );
});

async function sign(
  claims: Record<string, unknown>,
  { key = realmKey, kid = 'realm-key', exp = '5m' as string | null } = {},
): Promise<string> {
  const jwt = new jose.SignJWT({
    iss: ISSUER,
    sub: 'user-1',
    aud: CLIENT_ID,
    azp: CLIENT_ID,
    typ: 'Bearer',
    ...claims,
  })
    .setProtectedHeader({ alg: 'RS256', kid, typ: 'JWT' })
    .setIssuedAt();
  if (exp) jwt.setExpirationTime(exp);
  return jwt.sign(key);
}

describe('verifyToken (real signatures)', () => {
  it('accepts an access token for the configured audience', async () => {
    const payload = await verifyToken(await sign({}), config);
    expect(payload.sub).toBe('user-1');
    expect(payload['typ']).toBe('Bearer');
  });

  it('accepts a token whose aud array contains an accepted audience', async () => {
    const token = await sign({ aud: ['other-client', CLIENT_ID] });
    await expect(verifyToken(token, config)).resolves.toMatchObject({ sub: 'user-1' });
  });

  it('accepts any of several configured audiences', async () => {
    const token = await sign({ aud: 'demo-mobile', azp: 'demo-mobile' });
    await expect(
      verifyToken(token, { ...config, audience: [CLIENT_ID, 'demo-mobile'] }),
    ).resolves.toMatchObject({ sub: 'user-1' });
  });

  it('tolerates a trailing slash on issuerUrl', async () => {
    await expect(
      verifyToken(await sign({}), { ...config, issuerUrl: `${ISSUER_URL}/` }),
    ).resolves.toMatchObject({ sub: 'user-1' });
  });

  it('refuses an ID token signed with the same realm key', async () => {
    const idToken = await sign({ typ: 'ID', nonce: 'n-1', at_hash: 'x' });
    await expect(verifyToken(idToken, config)).rejects.toBeInstanceOf(InvalidTokenTypeError);
  });

  it.each([
    ['a logout token', { typ: 'Logout' }],
    ['an admin token', { typ: 'admin' }],
    ['a token without typ', { typ: undefined }],
    ['a lowercase typ', { typ: 'bearer' }],
  ])('refuses %s', async (_label, claims) => {
    await expect(verifyToken(await sign(claims), config)).rejects.toBeInstanceOf(
      InvalidTokenTypeError,
    );
  });

  it('refuses an access token issued to another client', async () => {
    const token = await sign({ aud: 'demo-other-app', azp: 'demo-other-app' });
    await expect(verifyToken(token, config)).rejects.toMatchObject({
      code: 'ERR_JWT_CLAIM_VALIDATION_FAILED',
      claim: 'aud',
    });
  });

  it('refuses a token without aud', async () => {
    const token = await sign({ aud: undefined });
    await expect(verifyToken(token, config)).rejects.toMatchObject({
      code: 'ERR_JWT_CLAIM_VALIDATION_FAILED',
    });
  });

  it('refuses a token from another realm (issuer mismatch)', async () => {
    const token = await sign({ iss: `${ISSUER_URL}/realms/demo-other` });
    await expect(verifyToken(token, config)).rejects.toMatchObject({
      code: 'ERR_JWT_CLAIM_VALIDATION_FAILED',
      claim: 'iss',
    });
  });

  it('refuses a token without exp', async () => {
    const token = await sign({}, { exp: null });
    await expect(verifyToken(token, config)).rejects.toMatchObject({
      code: 'ERR_JWT_CLAIM_VALIDATION_FAILED',
      claim: 'exp',
    });
  });

  it('refuses an expired token', async () => {
    const token = await sign({ exp: Math.floor(Date.now() / 1000) - 600 }, { exp: null });
    await expect(verifyToken(token, config)).rejects.toMatchObject({ code: 'ERR_JWT_EXPIRED' });
  });

  it('refuses a token signed by a key that is not in the realm JWKS', async () => {
    const token = await sign({}, { key: otherKey });
    await expect(verifyToken(token, config)).rejects.toMatchObject({
      code: 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED',
    });
  });

  it('refuses an HMAC-signed token, whatever its claims', async () => {
    const secret = new TextEncoder().encode('placeholder-hmac-secret-for-tests-only');
    const token = await new jose.SignJWT({ iss: ISSUER, sub: 'u', aud: CLIENT_ID, typ: 'Bearer' })
      .setProtectedHeader({ alg: 'HS256', kid: 'realm-key' })
      .setExpirationTime('5m')
      .sign(secret);
    await expect(verifyToken(token, config)).rejects.toBeTruthy();
  });
});

describe('audience is required', () => {
  const missing = [
    ['missing', { issuerUrl: ISSUER_URL, realm: REALM }],
    ['empty string', { ...config, audience: '' }],
    ['empty array', { ...config, audience: [] }],
    ['non-string entry', { ...config, audience: [CLIENT_ID, 42] }],
  ] as const;

  it.each(missing)('verifyToken throws a configuration error when audience is %s', async (_l, cfg) => {
    await expect(verifyToken(await sign({}), cfg as never)).rejects.toThrow(/audience/);
  });

  it.each(missing)('the request helpers fail at construction when audience is %s', (_l, cfg) => {
    expect(() => createIdenplaneMiddleware(cfg as never)).toThrow(/audience/);
    expect(() => createIdenplaneGuard(cfg as never)).toThrow(/audience/);
    expect(() => createNextMiddleware(cfg as never)).toThrow(/audience/);
  });

  it('getServerSideAuth surfaces the configuration error instead of reporting "unauthenticated"', async () => {
    await expect(
      getServerSideAuth({ headers: {} }, { issuerUrl: ISSUER_URL, realm: REALM } as never),
    ).rejects.toThrow(/audience/);
  });
});

describe('request helpers reject ID tokens and foreign audiences', () => {
  function res() {
    const out: { status?: number } = {};
    return {
      out,
      status(code: number) {
        out.status = code;
        return { json: () => undefined };
      },
    };
  }

  it('Express middleware answers 401 for an ID token', async () => {
    const mw = createIdenplaneMiddleware(config);
    const r = res();
    const next = vi.fn();
    await mw({ headers: { authorization: `Bearer ${await sign({ typ: 'ID' })}` } }, r, next);
    expect(r.out.status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('Express middleware answers 401 for another client\'s token, and passes a valid one', async () => {
    const mw = createIdenplaneMiddleware(config);
    const r = res();
    const next = vi.fn();
    await mw({ headers: { authorization: `Bearer ${await sign({ aud: 'demo-other' })}` } }, r, next);
    expect(r.out.status).toBe(401);

    const ok = res();
    const req: { headers: Record<string, string>; user?: IdenplaneTokenPayload } = {
      headers: { authorization: `Bearer ${await sign({})}` },
    };
    await mw(req, ok, next);
    expect(next).toHaveBeenCalledOnce();
    expect(req.user).toMatchObject({ sub: 'user-1' });
  });

  it('getServerSideAuth reports an ID token as unauthenticated', async () => {
    const result = await getServerSideAuth(
      { headers: { authorization: `Bearer ${await sign({ typ: 'ID' })}` } },
      config,
    );
    expect(result.isAuthenticated).toBe(false);
    expect(result.user).toBeNull();
  });
});
