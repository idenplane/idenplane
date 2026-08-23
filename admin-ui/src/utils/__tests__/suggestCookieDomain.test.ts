import { describe, it, expect } from 'vitest';
import { suggestCookieDomain } from '../suggestCookieDomain';

/**
 * This helper exists because a cookie domain that does not cover the
 * application's host fails silently: the browser simply never sends the session
 * cookie, so the user bounces between the app and login with no error anywhere.
 * The server rejects the combination, but suggesting a correct value means most
 * admins never reach that rejection.
 */
describe('suggestCookieDomain', () => {
  it('derives the registrable parent from a subdomain', () => {
    expect(suggestCookieDomain('https://grafana.example.com/*')).toBe(
      '.example.com',
    );
  });

  it('handles a deep subdomain', () => {
    expect(suggestCookieDomain('https://a.b.example.com/*')).toBe(
      '.example.com',
    );
  });

  it('leaves an apex domain as its own scope', () => {
    expect(suggestCookieDomain('https://example.com/*')).toBe('example.com');
  });

  it('leaves a bare host alone', () => {
    expect(suggestCookieDomain('http://localhost:3000/*')).toBe('localhost');
  });

  it('works without the trailing wildcard', () => {
    expect(suggestCookieDomain('https://grafana.example.com/login')).toBe(
      '.example.com',
    );
  });

  it('returns empty for something that is not a URL, rather than guessing', () => {
    expect(suggestCookieDomain('grafana.example.com')).toBe('');
  });

  it('returns empty for an empty input', () => {
    expect(suggestCookieDomain('')).toBe('');
  });
});
