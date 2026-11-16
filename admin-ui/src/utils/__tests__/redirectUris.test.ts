import { describe, it, expect } from 'vitest';
import { redirectUriProblems, splitLines } from '../redirectUris';

describe('redirectUriProblems', () => {
  it('accepts exact URIs, loopback included', () => {
    expect(
      redirectUriProblems(['https://app.example.com/callback', 'http://127.0.0.1/cb'], false),
    ).toEqual([]);
  });

  it('refuses a /* wildcard unless the client keeps the legacy opt-in', () => {
    expect(redirectUriProblems(['https://app.example.com/*'], false)).toHaveLength(1);
    expect(redirectUriProblems(['https://app.example.com/*'], true)).toEqual([]);
  });

  it('refuses any other * and fragments, opt-in or not', () => {
    expect(redirectUriProblems(['https://*.example.com/cb'], true)).toHaveLength(1);
    expect(redirectUriProblems(['https://app.example.com/cb#x'], true)).toHaveLength(1);
  });

  it('splits a textarea value into trimmed lines', () => {
    expect(splitLines(' a \n\n b\n')).toEqual(['a', 'b']);
  });
});
