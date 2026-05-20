import { describe, it, expect } from 'vitest';
import { generateCodeVerifier, generateCodeChallenge, generateState } from '../pkce.js';

describe('generateCodeVerifier', () => {
  it('should generate a base64url-encoded string', () => {
    const verifier = generateCodeVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('should generate a string of expected length (43 chars for 32 bytes)', () => {
    const verifier = generateCodeVerifier();
    expect(verifier.length).toBe(43);
  });

  it('should generate unique values each time', () => {
    const v1 = generateCodeVerifier();
    const v2 = generateCodeVerifier();
    expect(v1).not.toBe(v2);
  });
});

describe('generateCodeChallenge', () => {
  it('should generate a base64url-encoded challenge from a verifier', async () => {
    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);

    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge.length).toBe(43);
  });

  it('should produce a deterministic challenge for the same verifier', async () => {
    const verifier = 'test-verifier-12345678901234567890123';
    const c1 = await generateCodeChallenge(verifier);
    const c2 = await generateCodeChallenge(verifier);
    expect(c1).toBe(c2);
  });

  it('should produce different challenges for different verifiers', async () => {
    const c1 = await generateCodeChallenge('verifier-1-abcdefghijklmnopqrstuvwxyz');
    const c2 = await generateCodeChallenge('verifier-2-abcdefghijklmnopqrstuvwxyz');
    expect(c1).not.toBe(c2);
  });
});

describe('generateState', () => {
  it('should generate a base64url-encoded string', () => {
    const state = generateState();
    expect(state).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('should generate a string of expected length (22 chars for 16 bytes)', () => {
    const state = generateState();
    expect(state.length).toBe(22);
  });

  it('should generate unique values each time', () => {
    const s1 = generateState();
    const s2 = generateState();
    expect(s1).not.toBe(s2);
  });
});
