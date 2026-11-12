import { CidrMatcher, CidrListError, normalizeIp } from './cidr.js';

describe('CidrMatcher', () => {
  it('matches IPv4 addresses and blocks', () => {
    const list = CidrMatcher.parse('10.0.0.0/8, 192.168.1.7');
    expect(list.contains('10.1.2.3')).toBe(true);
    expect(list.contains('192.168.1.7')).toBe(true);
    expect(list.contains('192.168.1.8')).toBe(false);
    expect(list.contains('11.0.0.1')).toBe(false);
  });

  it('matches IPv6 addresses and blocks', () => {
    const list = CidrMatcher.parse('fd00::/8,2001:db8::1');
    expect(list.contains('fd12:3456::1')).toBe(true);
    expect(list.contains('2001:db8::1')).toBe(true);
    expect(list.contains('2001:db8::2')).toBe(false);
    expect(list.contains('fe80::1')).toBe(false);
  });

  it('matches an IPv4-mapped IPv6 peer against its IPv4 network', () => {
    const list = CidrMatcher.parse('10.0.0.0/8');
    expect(list.contains('::ffff:10.9.8.7')).toBe(true);
    expect(list.contains('::FFFF:11.0.0.1')).toBe(false);
    expect(normalizeIp('::ffff:10.9.8.7')).toBe('10.9.8.7');
  });

  it('accepts a mapped entry and matches the plain IPv4 peer', () => {
    const list = CidrMatcher.parse('::ffff:10.0.0.0/104');
    expect(list.contains('10.200.0.1')).toBe(true);
    expect(list.contains('11.0.0.1')).toBe(false);
  });

  it('does not match a missing or invalid address', () => {
    const list = CidrMatcher.parse('10.0.0.0/8');
    expect(list.contains(undefined)).toBe(false);
    expect(list.contains('')).toBe(false);
    expect(list.contains('not-an-ip')).toBe(false);
  });

  it.each([
    '*',
    '0.0.0.0/0',
    '::/0',
    '10.0.0.0/8,*',
    '10.*',
    '::ffff:0:0/96',
    '1.2.3.4/0',
  ])('refuses %s, which would trust every peer', (value) => {
    expect(() => CidrMatcher.parse(value)).toThrow(CidrListError);
  });

  it.each([
    '',
    ' , ',
    'example.com',
    '10.0.0.0/33',
    '10.0.0.0/x',
    'fd00::/129',
  ])('refuses the invalid list %j', (value) => {
    expect(() => CidrMatcher.parse(value)).toThrow(CidrListError);
  });
});
