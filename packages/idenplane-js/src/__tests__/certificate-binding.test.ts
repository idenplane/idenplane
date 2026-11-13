import { describe, it, expect, vi } from 'vitest';
import {
  assertCertificateBinding,
  boundCertificateThumbprint,
  CertificateBindingError,
  computeX5tS256,
} from '../certificate-binding.js';

vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => 'mocked-jwks'),
  jwtVerify: vi.fn(),
}));

const { jwtVerify } = await import('jose');
const server = await import('../server.js');

// Web Crypto only: the SDK is typechecked without Node's types.
const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));
async function sha256Base64Url(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)),
  );
  return btoa(String.fromCharCode(...digest))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// Any bytes do: the thumbprint is a digest of the DER, whatever it encodes.
const der = randomBytes(700);
const x5t = await sha256Base64Url(der);
const bound = { sub: 'u', cnf: { 'x5t#S256': x5t } };

describe('computeX5tS256', () => {
  it('is base64url SHA-256 of the DER, unpadded', async () => {
    expect(await computeX5tS256(der)).toBe(x5t);
    expect(await computeX5tS256(new Uint8Array(der).buffer)).toBe(x5t);
    expect(x5t).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('hashes only the view, not its whole backing store', async () => {
    // Like a pooled Node Buffer: 'abc' is a view in the middle of a larger store.
    const store = new TextEncoder().encode('xxabcxx');
    const view = new Uint8Array(store.buffer, 2, 3);
    expect(await computeX5tS256(view)).toBe(
      await sha256Base64Url(new TextEncoder().encode('abc')),
    );
  });
});

describe('assertCertificateBinding', () => {
  it('passes an unbound token with or without a certificate', async () => {
    await expect(
      assertCertificateBinding({ sub: 'u' }),
    ).resolves.toBeUndefined();
    await expect(
      assertCertificateBinding({ sub: 'u' }, { certificateThumbprint: x5t }),
    ).resolves.toBeUndefined();
  });

  it('passes a bound token with the matching thumbprint or DER', async () => {
    await expect(
      assertCertificateBinding(bound, { certificateThumbprint: x5t }),
    ).resolves.toBeUndefined();
    await expect(
      assertCertificateBinding(bound, { certificate: der }),
    ).resolves.toBeUndefined();
  });

  it('refuses a bound token without a certificate', async () => {
    await expect(assertCertificateBinding(bound)).rejects.toMatchObject({
      name: 'CertificateBindingError',
      reason: 'missing',
      code: 'invalid_token',
    });
  });

  it('refuses a bound token with another certificate', async () => {
    await expect(
      assertCertificateBinding(bound, { certificate: randomBytes(700) }),
    ).rejects.toMatchObject({ reason: 'mismatch' });
  });

  it.each([['x'], [null], [{ jkt: 'k' }], [{ 'x5t#S256': '' }]])(
    'refuses a cnf it cannot check: %j',
    async (cnf) => {
      expect(() => boundCertificateThumbprint({ cnf })).toThrow(
        CertificateBindingError,
      );
    },
  );
});

describe('verifyToken with a certificate-bound token', () => {
  const config = { issuerUrl: 'http://localhost:3000', realm: 'test' };

  it('returns the payload when the presented certificate matches', async () => {
    vi.mocked(jwtVerify).mockResolvedValue({ payload: bound } as never);
    await expect(
      server.verifyToken('t', config, { certificateThumbprint: x5t }),
    ).resolves.toEqual(bound);
    await expect(
      server.verifyToken('t', config, { certificate: der }),
    ).resolves.toEqual(bound);
  });

  it('rejects it without a certificate, and in the request helpers', async () => {
    vi.mocked(jwtVerify).mockResolvedValue({ payload: bound } as never);
    await expect(server.verifyToken('t', config)).rejects.toBeInstanceOf(
      server.CertificateBindingError,
    );
    const auth = await server.getServerSideAuth(
      { headers: { authorization: 'Bearer t' } },
      config,
    );
    expect(auth.isAuthenticated).toBe(false);
  });

  it('leaves unbound tokens unchanged', async () => {
    vi.mocked(jwtVerify).mockResolvedValue({ payload: { sub: 'u' } } as never);
    await expect(server.verifyToken('t', config)).resolves.toEqual({
      sub: 'u',
    });
  });

  it('exports computeX5tS256', async () => {
    expect(await server.computeX5tS256(der)).toBe(x5t);
  });
});
