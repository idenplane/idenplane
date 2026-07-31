import {
  isBlockedIp,
  isBlockedIpv4,
  isBlockedIpv6,
  isBlockedHostnameLiteral,
} from './ip-range-guard.js';

// ─── IPv4 ranges ────────────────────────────────────────────────────────────

describe('isBlockedIpv4', () => {
  const cases: Array<{
    name: string;
    network: string;
    prefixLength: number;
    first: string;
    last: string;
    justBefore?: string;
    justAfter?: string;
  }> = [
    {
      name: '0.0.0.0/8 ("this" network)',
      network: '0.0.0.0',
      prefixLength: 8,
      first: '0.0.0.0',
      last: '0.255.255.255',
      justAfter: '1.0.0.0',
    },
    {
      name: '10.0.0.0/8 (RFC1918 private)',
      network: '10.0.0.0',
      prefixLength: 8,
      first: '10.0.0.0',
      last: '10.255.255.255',
      justBefore: '9.255.255.255',
      justAfter: '11.0.0.0',
    },
    {
      name: '100.64.0.0/10 (CGNAT)',
      network: '100.64.0.0',
      prefixLength: 10,
      first: '100.64.0.0',
      last: '100.127.255.255',
      justBefore: '100.63.255.255',
      justAfter: '100.128.0.0',
    },
    {
      name: '127.0.0.0/8 (loopback)',
      network: '127.0.0.0',
      prefixLength: 8,
      first: '127.0.0.0',
      last: '127.255.255.255',
      justBefore: '126.255.255.255',
      justAfter: '128.0.0.0',
    },
    {
      name: '169.254.0.0/16 (link-local, incl. cloud metadata)',
      network: '169.254.0.0',
      prefixLength: 16,
      first: '169.254.0.0',
      last: '169.254.255.255',
      justBefore: '169.253.255.255',
      justAfter: '169.255.0.0',
    },
    {
      name: '172.16.0.0/12 (RFC1918 private)',
      network: '172.16.0.0',
      prefixLength: 12,
      first: '172.16.0.0',
      last: '172.31.255.255',
      justBefore: '172.15.255.255',
      justAfter: '172.32.0.0',
    },
    {
      name: '192.0.0.0/24 (IETF protocol assignments)',
      network: '192.0.0.0',
      prefixLength: 24,
      first: '192.0.0.0',
      last: '192.0.0.255',
      justBefore: '191.255.255.255',
      justAfter: '192.0.1.0',
    },
    {
      name: '192.0.2.0/24 (TEST-NET-1)',
      network: '192.0.2.0',
      prefixLength: 24,
      first: '192.0.2.0',
      last: '192.0.2.255',
      justBefore: '192.0.1.255',
      justAfter: '192.0.3.0',
    },
    {
      name: '192.168.0.0/16 (RFC1918 private)',
      network: '192.168.0.0',
      prefixLength: 16,
      first: '192.168.0.0',
      last: '192.168.255.255',
      justBefore: '192.167.255.255',
      justAfter: '192.169.0.0',
    },
    {
      name: '198.18.0.0/15 (benchmarking)',
      network: '198.18.0.0',
      prefixLength: 15,
      first: '198.18.0.0',
      last: '198.19.255.255',
      justBefore: '198.17.255.255',
      justAfter: '198.20.0.0',
    },
    {
      name: '198.51.100.0/24 (TEST-NET-2)',
      network: '198.51.100.0',
      prefixLength: 24,
      first: '198.51.100.0',
      last: '198.51.100.255',
      justBefore: '198.51.99.255',
      justAfter: '198.51.101.0',
    },
    {
      name: '203.0.113.0/24 (TEST-NET-3)',
      network: '203.0.113.0',
      prefixLength: 24,
      first: '203.0.113.0',
      last: '203.0.113.255',
      justBefore: '203.0.112.255',
      justAfter: '203.0.114.0',
    },
    {
      name: '224.0.0.0/4 (multicast)',
      network: '224.0.0.0',
      prefixLength: 4,
      first: '224.0.0.0',
      last: '239.255.255.255',
      justBefore: '223.255.255.255',
      // No unblocked "just after" boundary exists: 240.0.0.0, the address
      // immediately following the multicast range, is itself the start of
      // the 240.0.0.0/4 reserved range, which is blocked too.
    },
    {
      name: '240.0.0.0/4 (reserved)',
      network: '240.0.0.0',
      prefixLength: 4,
      first: '240.0.0.0',
      last: '255.255.255.255',
      // No unblocked "just before" boundary exists: the address
      // immediately preceding 240.0.0.0 (239.255.255.255) already falls
      // inside the 224.0.0.0/4 multicast range, which is blocked too.
    },
    {
      name: '255.255.255.255 (limited broadcast)',
      network: '255.255.255.255',
      prefixLength: 32,
      first: '255.255.255.255',
      last: '255.255.255.255',
      // No unblocked "just before" boundary exists: 255.255.255.254
      // already falls inside the 240.0.0.0/4 reserved range, which is
      // blocked too.
    },
  ];

  for (const c of cases) {
    describe(c.name, () => {
      it(`blocks the network address (${c.first})`, () => {
        expect(isBlockedIpv4(c.first)).toBe(true);
      });

      it(`blocks the last address in range (${c.last})`, () => {
        expect(isBlockedIpv4(c.last)).toBe(true);
      });

      if (c.justBefore) {
        it(`does NOT block the address just before the range (${c.justBefore})`, () => {
          // Some neighboring addresses may themselves fall in a different
          // blocked range (e.g. 9.255.255.255 is public, but 172.15.x.x is
          // public too) -- these are chosen to be public/unblocked.
          expect(isBlockedIpv4(c.justBefore)).toBe(false);
        });
      }

      if (c.justAfter) {
        it(`does NOT block the address just after the range (${c.justAfter})`, () => {
          expect(isBlockedIpv4(c.justAfter)).toBe(false);
        });
      }
    });
  }

  it('blocks malformed IPv4-shaped input (fails closed)', () => {
    expect(isBlockedIpv4('999.999.999.999')).toBe(true);
    expect(isBlockedIpv4('not-an-ip')).toBe(true);
    expect(isBlockedIpv4('')).toBe(true);
  });

  it('does not block well-known public IPv4 addresses', () => {
    expect(isBlockedIpv4('1.1.1.1')).toBe(false); // Cloudflare DNS
    expect(isBlockedIpv4('8.8.8.8')).toBe(false); // Google DNS
    expect(isBlockedIpv4('93.184.216.34')).toBe(false); // example.com
  });
});

// ─── IPv6 ranges ────────────────────────────────────────────────────────────

describe('isBlockedIpv6', () => {
  it('blocks ::1 (loopback)', () => {
    expect(isBlockedIpv6('::1')).toBe(true);
  });

  it('blocks :: (unspecified)', () => {
    expect(isBlockedIpv6('::')).toBe(true);
  });

  it('blocks fc00::/7 (unique local address / ULA)', () => {
    expect(isBlockedIpv6('fc00::1')).toBe(true);
    expect(isBlockedIpv6('fd12:3456:789a::1')).toBe(true);
    // just outside fc00::/7 (fe00::) is not ULA, but IS multicast (ff00::/8)
    // territory neighbor -- use a clearly public-shaped address instead.
  });

  it('does NOT block an address just outside fc00::/7', () => {
    // fc00::/7 covers fc00:: through fdff:ffff:...; fe00:: is the very next
    // address and is not ULA (nor any other blocked range).
    expect(isBlockedIpv6('fe00::1')).toBe(false);
  });

  it('blocks fe80::/10 (link-local)', () => {
    expect(isBlockedIpv6('fe80::1')).toBe(true);
    expect(isBlockedIpv6('fe80::abcd:1234:5678:9abc')).toBe(true);
  });

  it('does NOT block an address just outside fe80::/10', () => {
    expect(isBlockedIpv6('fec0::1')).toBe(false);
  });

  it('blocks ff00::/8 (multicast)', () => {
    expect(isBlockedIpv6('ff02::1')).toBe(true);
  });

  it('does NOT block an address just outside ff00::/8', () => {
    expect(isBlockedIpv6('fe00::1')).toBe(false);
  });

  it('blocks 2001:db8::/32 (documentation)', () => {
    expect(isBlockedIpv6('2001:db8::1')).toBe(true);
    expect(isBlockedIpv6('2001:db8:ffff:ffff:ffff:ffff:ffff:ffff')).toBe(true);
  });

  it('does NOT block an address just outside 2001:db8::/32', () => {
    expect(isBlockedIpv6('2001:db9::1')).toBe(false);
  });

  it('blocks 64:ff9b::/96 (NAT64 well-known prefix) regardless of embedded address', () => {
    // The entire 64:ff9b::/96 prefix is blocked outright (not just when it
    // embeds an otherwise-blocked IPv4 address), since it identifies a
    // NAT64 translation range rather than a normal routable address.
    expect(isBlockedIpv6('64:ff9b::1.1.1.1')).toBe(true);
    expect(isBlockedIpv6('64:ff9b::7f00:1')).toBe(true); // embeds 127.0.0.1
  });

  it('blocks malformed IPv6-shaped input (fails closed)', () => {
    expect(isBlockedIpv6('not-an-ipv6')).toBe(true);
    expect(isBlockedIpv6('')).toBe(true);
  });

  it('does not block well-known public IPv6 addresses', () => {
    expect(isBlockedIpv6('2606:4700:4700::1111')).toBe(false); // Cloudflare DNS
    expect(isBlockedIpv6('2001:4860:4860::8888')).toBe(false); // Google DNS
  });

  describe('IPv4-mapped / IPv4-compatible / 6to4 unwrapping (anti-bypass)', () => {
    it('blocks ::ffff:127.0.0.1 (IPv4-mapped loopback)', () => {
      expect(isBlockedIpv6('::ffff:127.0.0.1')).toBe(true);
    });

    it('blocks ::ffff:10.0.0.1 (IPv4-mapped RFC1918)', () => {
      expect(isBlockedIpv6('::ffff:10.0.0.1')).toBe(true);
    });

    it('blocks ::ffff:169.254.169.254 (IPv4-mapped cloud metadata)', () => {
      expect(isBlockedIpv6('::ffff:169.254.169.254')).toBe(true);
    });

    it('does NOT block an IPv4-mapped public address', () => {
      expect(isBlockedIpv6('::ffff:8.8.8.8')).toBe(false);
    });

    it('blocks ::127.0.0.1 (deprecated IPv4-compatible loopback)', () => {
      expect(isBlockedIpv6('::127.0.0.1')).toBe(true);
    });

    it('blocks 2002:7f00:0001:: (6to4-encoded 127.0.0.1)', () => {
      expect(isBlockedIpv6('2002:7f00:1::')).toBe(true);
    });

    it('does NOT block a 6to4-encoded public address', () => {
      // 2002:0808:0808:: encodes 8.8.8.8
      expect(isBlockedIpv6('2002:808:808::')).toBe(false);
    });
  });
});

// ─── Public entry point: isBlockedIp ───────────────────────────────────────

describe('isBlockedIp', () => {
  it('dispatches IPv4 literals to the IPv4 blocklist', () => {
    expect(isBlockedIp('127.0.0.1')).toBe(true);
    expect(isBlockedIp('10.0.0.5')).toBe(true);
    expect(isBlockedIp('172.16.0.1')).toBe(true);
    expect(isBlockedIp('172.31.255.255')).toBe(true);
    expect(isBlockedIp('192.168.1.1')).toBe(true);
    expect(isBlockedIp('169.254.169.254')).toBe(true); // cloud metadata
    expect(isBlockedIp('1.1.1.1')).toBe(false);
    expect(isBlockedIp('8.8.8.8')).toBe(false);
  });

  it('dispatches IPv6 literals to the IPv6 blocklist', () => {
    expect(isBlockedIp('::1')).toBe(true);
    expect(isBlockedIp('fe80::1')).toBe(true);
    expect(isBlockedIp('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedIp('2606:4700:4700::1111')).toBe(false);
  });

  it('fails closed for non-IP-literal input', () => {
    expect(isBlockedIp('example.com')).toBe(true);
    expect(isBlockedIp('localhost')).toBe(true);
    expect(isBlockedIp('')).toBe(true);
  });
});

// ─── Hostname literal bypasses ──────────────────────────────────────────────

describe('isBlockedHostnameLiteral', () => {
  describe('loopback-alias hostnames', () => {
    it('blocks "localhost"', () => {
      expect(isBlockedHostnameLiteral('localhost')).toBe(true);
    });

    it('blocks "localhost" case-insensitively', () => {
      expect(isBlockedHostnameLiteral('LOCALHOST')).toBe(true);
      expect(isBlockedHostnameLiteral('LocalHost')).toBe(true);
    });

    it('blocks "localhost." (trailing FQDN dot)', () => {
      expect(isBlockedHostnameLiteral('localhost.')).toBe(true);
    });

    it('blocks "localhost.localdomain"', () => {
      expect(isBlockedHostnameLiteral('localhost.localdomain')).toBe(true);
    });

    it('blocks any name ending in ".localhost"', () => {
      expect(isBlockedHostnameLiteral('foo.localhost')).toBe(true);
      expect(isBlockedHostnameLiteral('anything.localhost')).toBe(true);
    });

    it('does NOT block hostnames that merely contain "localhost" as a substring', () => {
      expect(isBlockedHostnameLiteral('sub.localhostx.com')).toBe(false);
      expect(isBlockedHostnameLiteral('notlocalhost.com')).toBe(false);
    });
  });

  describe('IP literals (delegated to isBlockedIp)', () => {
    it('blocks "127.0.0.1"', () => {
      expect(isBlockedHostnameLiteral('127.0.0.1')).toBe(true);
    });

    it('blocks bracketed IPv6 literal "[::1]"', () => {
      expect(isBlockedHostnameLiteral('[::1]')).toBe(true);
    });

    it('blocks unbracketed IPv6 literal "::1"', () => {
      expect(isBlockedHostnameLiteral('::1')).toBe(true);
    });

    it('does NOT block a public IP literal', () => {
      expect(isBlockedHostnameLiteral('1.1.1.1')).toBe(false);
      expect(isBlockedHostnameLiteral('2606:4700:4700::1111')).toBe(false);
    });
  });

  describe('numeric IPv4 literal encodings (decimal/octal/hex bypasses)', () => {
    it('blocks decimal-encoded loopback "2130706433" (== 127.0.0.1)', () => {
      expect(isBlockedHostnameLiteral('2130706433')).toBe(true);
    });

    it('blocks octal-encoded loopback "017700000001" (== 127.0.0.1)', () => {
      expect(isBlockedHostnameLiteral('017700000001')).toBe(true);
    });

    it('blocks hex-per-octet loopback "0x7f.0x0.0x0.0x1" (== 127.0.0.1)', () => {
      expect(isBlockedHostnameLiteral('0x7f.0x0.0x0.0x1')).toBe(true);
    });

    it('blocks whole-number hex loopback "0x7f000001" (== 127.0.0.1)', () => {
      expect(isBlockedHostnameLiteral('0x7f000001')).toBe(true);
    });

    it('blocks legacy short-form loopback "127.1" (== 127.0.0.1)', () => {
      expect(isBlockedHostnameLiteral('127.1')).toBe(true);
    });

    it('blocks decimal-encoded RFC1918 "3232235521" (== 192.168.0.1)', () => {
      expect(isBlockedHostnameLiteral('3232235521')).toBe(true);
    });

    it('does NOT block a numeric encoding of a public address', () => {
      // 134744072 == 8.8.8.8
      expect(isBlockedHostnameLiteral('134744072')).toBe(false);
    });
  });

  describe('ordinary DNS names (not literal bypasses)', () => {
    it('does NOT block ordinary public hostnames', () => {
      expect(isBlockedHostnameLiteral('example.com')).toBe(false);
      expect(isBlockedHostnameLiteral('api.example.com')).toBe(false);
      expect(isBlockedHostnameLiteral('my-webhook-receiver.example.org')).toBe(
        false,
      );
    });
  });

  it('fails closed on empty input', () => {
    expect(isBlockedHostnameLiteral('')).toBe(true);
    expect(isBlockedHostnameLiteral('   ')).toBe(true);
  });
});

// ─── Spec-mandated bypass strings, expressed as full URLs ──────────────────

describe('exact bypass strings called out in the spec', () => {
  const extractHost = (rawUrl: string): string => new URL(rawUrl).hostname;

  it('http://localhost is blocked', () => {
    const hostname = extractHost('http://localhost');
    expect(isBlockedHostnameLiteral(hostname)).toBe(true);
  });

  it('http://127.0.0.1 is blocked', () => {
    const hostname = extractHost('http://127.0.0.1');
    expect(isBlockedHostnameLiteral(hostname)).toBe(true);
  });

  it('http://169.254.169.254 (cloud metadata) is blocked', () => {
    const hostname = extractHost('http://169.254.169.254/latest/meta-data');
    expect(isBlockedHostnameLiteral(hostname)).toBe(true);
  });

  it('http://10.x (RFC1918) is blocked', () => {
    const hostname = extractHost('http://10.1.2.3');
    expect(isBlockedHostnameLiteral(hostname)).toBe(true);
  });

  it('http://172.16-31.x (RFC1918) is blocked', () => {
    expect(isBlockedHostnameLiteral(extractHost('http://172.16.0.1'))).toBe(
      true,
    );
    expect(isBlockedHostnameLiteral(extractHost('http://172.31.255.254'))).toBe(
      true,
    );
  });

  it('http://192.168.x (RFC1918) is blocked', () => {
    const hostname = extractHost('http://192.168.1.1');
    expect(isBlockedHostnameLiteral(hostname)).toBe(true);
  });

  it('https://example.com/webhook (legitimate public target) is NOT blocked', () => {
    const hostname = extractHost('https://example.com/webhook');
    expect(isBlockedHostnameLiteral(hostname)).toBe(false);
  });
});
