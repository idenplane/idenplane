import 'reflect-metadata';
import {
  canonicalIp,
  configuredRules,
  isCaCertificate,
  matchesTlsClientAuthRule,
  type TlsClientAuthRules,
} from './certificate-checks.js';
import {
  issue,
  nameConstraints,
  unknownCritical,
  type TestIdentity,
} from './__mocks__/test-pki.js';
import { KeyUsageFlags } from '@peculiar/x509';

const none: TlsClientAuthRules = {
  tlsClientAuthSubjectDn: null,
  tlsClientAuthSanDns: null,
  tlsClientAuthSanUri: null,
  tlsClientAuthSanIp: null,
  tlsClientAuthSanEmail: null,
};

describe('matchesTlsClientAuthRule', () => {
  let device: TestIdentity;

  beforeAll(async () => {
    device = await issue({
      name: [{ C: ['US'] }, { O: ['Example'] }, { CN: ['device-1'] }],
      san: [
        { type: 'dns', value: 'Device-1.example.com' },
        { type: 'url', value: 'spiffe://example.com/device-1' },
        { type: 'ip', value: '2001:db8::1' },
        { type: 'ip', value: '192.0.2.7' },
        { type: 'email', value: 'device-1@example.com' },
      ],
    });
  });

  const matches = (rules: Partial<TlsClientAuthRules>) =>
    matchesTlsClientAuthRule(device.certificate, { ...none, ...rules });

  it('matches the subject DN as parsed RDNs', () => {
    expect(
      matches({ tlsClientAuthSubjectDn: 'CN=device-1,O=Example,C=US' }),
    ).toBe(true);
    expect(
      matches({ tlsClientAuthSubjectDn: 'cn=DEVICE-1, o=example, c=us' }),
    ).toBe(true);
    expect(
      matches({ tlsClientAuthSubjectDn: 'C=US,O=Example,CN=device-1' }),
    ).toBe(false);
    expect(matches({ tlsClientAuthSubjectDn: 'CN=device-1,O=Example' })).toBe(
      false,
    );
    expect(matches({ tlsClientAuthSubjectDn: 'not a dn' })).toBe(false);
  });

  it('matches a dNSName ignoring ASCII case, without wildcards', () => {
    expect(matches({ tlsClientAuthSanDns: 'device-1.example.com' })).toBe(true);
    expect(matches({ tlsClientAuthSanDns: '*.example.com' })).toBe(false);
    expect(matches({ tlsClientAuthSanDns: 'example.com' })).toBe(false);
  });

  it('matches a URI exactly', () => {
    expect(
      matches({ tlsClientAuthSanUri: 'spiffe://example.com/device-1' }),
    ).toBe(true);
    expect(
      matches({ tlsClientAuthSanUri: 'spiffe://example.com/device-1/' }),
    ).toBe(false);
    expect(
      matches({ tlsClientAuthSanUri: 'SPIFFE://example.com/device-1' }),
    ).toBe(false);
  });

  it('matches an IP address in canonical form', () => {
    expect(matches({ tlsClientAuthSanIp: '2001:0db8:0:0::1' })).toBe(true);
    expect(matches({ tlsClientAuthSanIp: '192.0.2.7' })).toBe(true);
    expect(matches({ tlsClientAuthSanIp: '192.0.2.8' })).toBe(false);
    expect(matches({ tlsClientAuthSanIp: '::ffff:192.0.2.7' })).toBe(false);
  });

  it('matches an email exactly', () => {
    expect(matches({ tlsClientAuthSanEmail: 'device-1@example.com' })).toBe(
      true,
    );
    expect(matches({ tlsClientAuthSanEmail: 'Device-1@example.com' })).toBe(
      false,
    );
  });

  it('never matches with no rule, or with more than one', () => {
    expect(matches({})).toBe(false);
    expect(
      matches({
        tlsClientAuthSanDns: 'device-1.example.com',
        tlsClientAuthSanEmail: 'device-1@example.com',
      }),
    ).toBe(false);
  });

  it('does not match a SAN rule against a certificate without SANs', async () => {
    const bare = await issue({ cn: 'device-1.example.com' });
    expect(
      matchesTlsClientAuthRule(bare.certificate, {
        ...none,
        tlsClientAuthSanDns: 'device-1.example.com',
      }),
    ).toBe(false);
  });

  it('lists the configured rules, ignoring empty strings', () => {
    expect(
      configuredRules({
        ...none,
        tlsClientAuthSanDns: 'a',
        tlsClientAuthSanUri: '',
      }),
    ).toEqual(['tlsClientAuthSanDns']);
  });
});

describe('canonicalIp', () => {
  it('canonicalises IPv6 and keeps IPv4', () => {
    expect(canonicalIp('2001:DB8:0::1')).toBe('2001:db8::1');
    expect(canonicalIp('10.0.0.1')).toBe('10.0.0.1');
    expect(canonicalIp('10.0.0.256')).toBeUndefined();
    expect(canonicalIp('host')).toBeUndefined();
  });
});

describe('isCaCertificate', () => {
  it('accepts a CA', async () => {
    expect(
      isCaCertificate((await issue({ ca: true })).certificate),
    ).toBeUndefined();
  });

  it.each([
    ['a leaf', { ca: false }, /not a CA/],
    [
      'no keyCertSign',
      { ca: true, keyUsage: KeyUsageFlags.digitalSignature },
      /keyCertSign/,
    ],
    [
      'nameConstraints',
      { ca: true, extraExtensions: [nameConstraints()] },
      /nameConstraints/,
    ],
    [
      'unknown critical',
      { ca: true, extraExtensions: [unknownCritical()] },
      /critical/,
    ],
  ])('refuses %s', async (_label, options, message) => {
    expect(isCaCertificate((await issue(options)).certificate)).toMatch(
      message,
    );
  });
});
