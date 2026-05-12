import { matchesRedirectUri } from './redirect-uri.utils.js';

describe('matchesRedirectUri', () => {
  it('should match exact URIs', () => {
    expect(
      matchesRedirectUri('https://example.com/callback', [
        'https://example.com/callback',
      ]),
    ).toBe(true);
  });

  it('should reject non-matching exact URIs', () => {
    expect(
      matchesRedirectUri('https://evil.com/callback', [
        'https://example.com/callback',
      ]),
    ).toBe(false);
  });

  it('should match wildcard patterns', () => {
    expect(
      matchesRedirectUri('http://localhost:4000/callback', [
        'http://localhost:4000/*',
      ]),
    ).toBe(true);
    expect(
      matchesRedirectUri('http://localhost:4000/auth/code', [
        'http://localhost:4000/*',
      ]),
    ).toBe(true);
  });

  it('should match the base path without trailing path for wildcard', () => {
    expect(
      matchesRedirectUri('http://localhost:4000', ['http://localhost:4000/*']),
    ).toBe(true);
  });

  it('should reject different host/port with wildcard', () => {
    expect(
      matchesRedirectUri('http://localhost:4001/callback', [
        'http://localhost:4000/*',
      ]),
    ).toBe(false);
    expect(
      matchesRedirectUri('https://localhost:4000/callback', [
        'http://localhost:4000/*',
      ]),
    ).toBe(false);
  });

  it('should match when any pattern in the list matches', () => {
    const uris = ['https://example.com/callback', 'http://localhost:3000/*'];
    expect(matchesRedirectUri('http://localhost:3000/auth', uris)).toBe(true);
    expect(matchesRedirectUri('https://example.com/callback', uris)).toBe(true);
  });

  it('should return false for empty registered URIs', () => {
    expect(matchesRedirectUri('http://localhost:4000/callback', [])).toBe(
      false,
    );
  });
});
