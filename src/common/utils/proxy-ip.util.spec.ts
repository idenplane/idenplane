import { resolveClientIp, resetTrustedProxyConfig } from './proxy-ip.util.js';
import type { Request } from 'express';

/**
 * Build a minimal Express-like Request mock.
 */
function makeRequest(
  opts: {
    socketIp?: string;
    xForwardedFor?: string;
  } = {},
): Request {
  return {
    socket: { remoteAddress: opts.socketIp ?? '127.0.0.1' },
    headers: opts.xForwardedFor
      ? { 'x-forwarded-for': opts.xForwardedFor }
      : {},
  } as unknown as Request;
}

describe('resolveClientIp', () => {
  beforeEach(() => {
    resetTrustedProxyConfig();
    delete process.env['TRUSTED_PROXIES'];
  });

  afterEach(() => {
    resetTrustedProxyConfig();
    delete process.env['TRUSTED_PROXIES'];
  });

  // ─── TRUSTED_PROXIES not set ────────────────────────────────────────────

  describe('when TRUSTED_PROXIES is not set', () => {
    it('returns the socket address when no X-Forwarded-For header is present', () => {
      const req = makeRequest({ socketIp: '10.0.0.5' });
      expect(resolveClientIp(req)).toBe('10.0.0.5');
    });

    it('ignores X-Forwarded-For and returns the socket address (prevents spoofing)', () => {
      const req = makeRequest({
        socketIp: '10.0.0.5',
        xForwardedFor: '1.2.3.4',
      });
      expect(resolveClientIp(req)).toBe('10.0.0.5');
    });

    it('returns "unknown" when socket address is not available', () => {
      const req = { socket: {}, headers: {} } as unknown as Request;
      expect(resolveClientIp(req)).toBe('unknown');
    });
  });

  // ─── TRUSTED_PROXIES=* ──────────────────────────────────────────────────

  describe('when TRUSTED_PROXIES=* (one trusted hop)', () => {
    beforeEach(() => {
      process.env['TRUSTED_PROXIES'] = '*';
      resetTrustedProxyConfig();
    });

    it('uses the entry the proxy appended (the rightmost)', () => {
      const req = makeRequest({
        socketIp: '172.18.0.2',
        xForwardedFor: '203.0.113.5',
      });
      expect(resolveClientIp(req)).toBe('203.0.113.5');
    });

    it('ignores entries the client wrote before the proxy appended its own', () => {
      // The client sent "X-Forwarded-For: 1.2.3.4"; nginx appended $remote_addr.
      const req = makeRequest({
        socketIp: '172.18.0.2',
        xForwardedFor: '1.2.3.4, 198.51.100.7',
      });
      expect(resolveClientIp(req)).toBe('198.51.100.7');
    });

    it('falls back to socket address when X-Forwarded-For is absent', () => {
      const req = makeRequest({ socketIp: '10.0.0.1' });
      expect(resolveClientIp(req)).toBe('10.0.0.1');
    });
  });

  // ─── TRUSTED_PROXIES with specific IP list ───────────────────────────────

  describe('when TRUSTED_PROXIES is a comma-separated list of IPs', () => {
    beforeEach(() => {
      process.env['TRUSTED_PROXIES'] = '10.0.0.1,10.0.0.2';
      resetTrustedProxyConfig();
    });

    it('uses X-Forwarded-For when the peer is a trusted proxy', () => {
      const req = makeRequest({
        socketIp: '10.0.0.1',
        xForwardedFor: '203.0.113.5',
      });
      expect(resolveClientIp(req)).toBe('203.0.113.5');
    });

    it('ignores X-Forwarded-For when the peer is NOT a trusted proxy', () => {
      const req = makeRequest({
        socketIp: '192.168.99.1',
        xForwardedFor: '1.2.3.4',
      });
      expect(resolveClientIp(req)).toBe('192.168.99.1');
    });

    it('uses X-Forwarded-For for the second trusted proxy as well', () => {
      const req = makeRequest({
        socketIp: '10.0.0.2',
        xForwardedFor: '203.0.113.99',
      });
      expect(resolveClientIp(req)).toBe('203.0.113.99');
    });
  });

  // ─── TRUSTED_PROXIES with CIDR block ────────────────────────────────────

  describe('when TRUSTED_PROXIES contains a CIDR block', () => {
    beforeEach(() => {
      process.env['TRUSTED_PROXIES'] = '10.0.0.0/24';
      resetTrustedProxyConfig();
    });

    it('uses X-Forwarded-For when the peer is within the CIDR range', () => {
      const req = makeRequest({
        socketIp: '10.0.0.200',
        xForwardedFor: '203.0.113.7',
      });
      expect(resolveClientIp(req)).toBe('203.0.113.7');
    });

    it('ignores X-Forwarded-For when the peer is outside the CIDR range', () => {
      const req = makeRequest({
        socketIp: '10.0.1.1',
        xForwardedFor: '1.2.3.4',
      });
      expect(resolveClientIp(req)).toBe('10.0.1.1');
    });
  });

  // ─── Spoofing: the client writes the left of the header ─────────────────

  describe('a client-supplied X-Forwarded-For behind a listed proxy', () => {
    beforeEach(() => {
      process.env['TRUSTED_PROXIES'] = '10.0.0.0/24';
      resetTrustedProxyConfig();
    });

    it('returns the address the proxy saw, not the one the client wrote', () => {
      const req = makeRequest({
        socketIp: '10.0.0.1',
        xForwardedFor: '1.2.3.4, 198.51.100.7',
      });
      expect(resolveClientIp(req)).toBe('198.51.100.7');
    });

    it('cannot pass itself off as a trusted proxy to reach further left', () => {
      // The client wrote "1.2.3.4, 10.0.0.9" hoping 10.0.0.9 is skipped as a proxy.
      const req = makeRequest({
        socketIp: '10.0.0.1',
        xForwardedFor: '1.2.3.4, 10.0.0.9, 198.51.100.7',
      });
      expect(resolveClientIp(req)).toBe('198.51.100.7');
    });

    it('skips every trusted hop of a proxy chain', () => {
      const req = makeRequest({
        socketIp: '10.0.0.1',
        xForwardedFor: '1.2.3.4, 198.51.100.7, 10.0.0.5, 10.0.0.6',
      });
      expect(resolveClientIp(req)).toBe('198.51.100.7');
    });

    it('returns the leftmost entry when every hop is a trusted proxy', () => {
      const req = makeRequest({
        socketIp: '10.0.0.1',
        xForwardedFor: '10.0.0.7, 10.0.0.8',
      });
      expect(resolveClientIp(req)).toBe('10.0.0.7');
    });
  });

  // ─── Address forms ──────────────────────────────────────────────────────

  describe('address forms', () => {
    it('matches an IPv4-mapped socket address (::ffff:a.b.c.d) against an IPv4 entry', () => {
      process.env['TRUSTED_PROXIES'] = '10.0.0.0/24';
      resetTrustedProxyConfig();
      const req = makeRequest({ socketIp: '::ffff:10.0.0.1', xForwardedFor: '198.51.100.7' });
      expect(resolveClientIp(req)).toBe('198.51.100.7');
    });

    it('returns a mapped socket address in its IPv4 form', () => {
      const req = makeRequest({ socketIp: '::ffff:198.51.100.7' });
      expect(resolveClientIp(req)).toBe('198.51.100.7');
    });

    it('supports IPv6 proxies and CIDR blocks', () => {
      process.env['TRUSTED_PROXIES'] = 'fd00::/8';
      resetTrustedProxyConfig();
      const req = makeRequest({ socketIp: 'fd00::1', xForwardedFor: '2001:db8::5, fd00::2' });
      expect(resolveClientIp(req)).toBe('2001:db8::5');
    });

    it('supports the names Express accepts (loopback, linklocal, uniquelocal)', () => {
      process.env['TRUSTED_PROXIES'] = 'loopback, uniquelocal';
      resetTrustedProxyConfig();
      const req = makeRequest({ socketIp: '127.0.0.1', xForwardedFor: '198.51.100.7, 172.20.0.3' });
      expect(resolveClientIp(req)).toBe('198.51.100.7');
    });

    it('trusts nothing for an entry that is not an address or CIDR block', () => {
      process.env['TRUSTED_PROXIES'] = 'not-an-ip';
      resetTrustedProxyConfig();
      const req = makeRequest({ socketIp: '10.0.0.1', xForwardedFor: '1.2.3.4' });
      expect(resolveClientIp(req)).toBe('10.0.0.1');
    });
  });

  // ─── Edge cases ─────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles an empty TRUSTED_PROXIES string as "none" (no trust)', () => {
      process.env['TRUSTED_PROXIES'] = '';
      resetTrustedProxyConfig();

      const req = makeRequest({
        socketIp: '10.0.0.1',
        xForwardedFor: '1.2.3.4',
      });
      expect(resolveClientIp(req)).toBe('10.0.0.1');
    });

    it('handles whitespace-only TRUSTED_PROXIES as "none"', () => {
      process.env['TRUSTED_PROXIES'] = '   ';
      resetTrustedProxyConfig();

      const req = makeRequest({
        socketIp: '10.0.0.1',
        xForwardedFor: '1.2.3.4',
      });
      expect(resolveClientIp(req)).toBe('10.0.0.1');
    });

    it('with *, uses only the last entry when X-Forwarded-For contains multiple entries', () => {
      process.env['TRUSTED_PROXIES'] = '*';
      resetTrustedProxyConfig();

      const req = makeRequest({
        socketIp: '10.0.0.1',
        xForwardedFor: '5.5.5.5, 6.6.6.6, 7.7.7.7',
      });
      expect(resolveClientIp(req)).toBe('7.7.7.7');
    });

    it('joins repeated X-Forwarded-For headers before reading them', () => {
      process.env['TRUSTED_PROXIES'] = '10.0.0.1';
      resetTrustedProxyConfig();
      const req = {
        socket: { remoteAddress: '10.0.0.1' },
        headers: { 'x-forwarded-for': ['1.2.3.4', '198.51.100.7'] },
      } as unknown as Request;
      expect(resolveClientIp(req)).toBe('198.51.100.7');
    });

    it('trims spaces around IPs in TRUSTED_PROXIES', () => {
      process.env['TRUSTED_PROXIES'] = ' 10.0.0.1 , 10.0.0.2 ';
      resetTrustedProxyConfig();

      const req = makeRequest({
        socketIp: '10.0.0.1',
        xForwardedFor: '203.0.113.5',
      });
      expect(resolveClientIp(req)).toBe('203.0.113.5');
    });
  });
});
