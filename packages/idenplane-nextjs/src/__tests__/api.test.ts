import { describe, it, expect } from 'vitest';
import { withAuth, withAuthHandler } from '../api.js';

describe('withAuth / withAuthHandler config validation', () => {
  const base = { realm: 'test' };
  const handler = () => {};
  const appRouterHandler = () => Response.json({});

  it('allows http:// for localhost', () => {
    expect(() => withAuth({ ...base, serverUrl: 'http://localhost:3000' }, handler)).not.toThrow();
    expect(() =>
      withAuthHandler({ ...base, serverUrl: 'http://localhost:3000' }, appRouterHandler),
    ).not.toThrow();
  });

  it('accepts https:// URLs', () => {
    expect(() => withAuth({ ...base, serverUrl: 'https://auth.example.com' }, handler)).not.toThrow();
  });

  it('rejects http:// for a non-loopback host', () => {
    expect(() => withAuth({ ...base, serverUrl: 'http://auth.example.com' }, handler)).toThrow(/insecure/i);
    expect(() =>
      withAuthHandler({ ...base, serverUrl: 'http://auth.example.com' }, appRouterHandler),
    ).toThrow(/insecure/i);
  });

  it('allows http:// for a non-loopback host with allowInsecureHttp: true', () => {
    expect(() =>
      withAuth({ ...base, serverUrl: 'http://auth.example.com', allowInsecureHttp: true }, handler),
    ).not.toThrow();
  });
});
