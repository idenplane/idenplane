import {
  canonicalDn,
  certificateNames,
  dnEquals,
  DistinguishedNameError,
  formatRfc4514,
  parseDerName,
  parseRfc4514,
  readTlv,
} from './distinguished-name.js';
import { issue } from './__mocks__/test-pki.js';

/** Subject of a certificate issued with a JSON name in DER order. */
async function subjectOf(name: Parameters<typeof issue>[0]['name']) {
  const { certificate } = await issue({ name });
  return parseDerName(certificateNames(certificate.raw).subject);
}

describe('distinguished names', () => {
  describe('parseRfc4514', () => {
    it('lists RDNs in reverse (DER) order', () => {
      expect(parseRfc4514('CN=dev,O=Acme,C=US')).toEqual([
        [{ oid: '2.5.4.6', value: { text: 'US' } }],
        [{ oid: '2.5.4.10', value: { text: 'Acme' } }],
        [{ oid: '2.5.4.3', value: { text: 'dev' } }],
      ]);
    });

    it('reads multi-valued RDNs', () => {
      expect(parseRfc4514('CN=a+UID=42,O=b')[1]).toEqual([
        { oid: '2.5.4.3', value: { text: 'a' } },
        { oid: '0.9.2342.19200300.100.1.1', value: { text: '42' } },
      ]);
    });

    it('unescapes specials and hex pairs', () => {
      const [[o], [cn]] = parseRfc4514('CN=caf\\C3\\A9 \\+1,O=Example\\, Inc.');
      expect(o.value).toEqual({ text: 'Example, Inc.' });
      expect(cn.value).toEqual({ text: 'café +1' });
    });

    it('keeps an escaped trailing space, drops an unescaped one', () => {
      expect(parseRfc4514('CN=a\\ ')[0][0].value).toEqual({ text: 'a ' });
      expect(parseRfc4514('CN=a  ')[0][0].value).toEqual({ text: 'a' });
    });

    it('tolerates spaces around separators', () => {
      expect(canonicalDn(parseRfc4514('CN = a , O = b'))).toBe(
        canonicalDn(parseRfc4514('CN=a,O=b')),
      );
    });

    it('decodes a #hex value as BER', () => {
      // UTF8String "abc"
      expect(parseRfc4514('2.5.4.3=#0c03616263')[0][0]).toEqual({
        oid: '2.5.4.3',
        value: { text: 'abc' },
      });
    });

    it('accepts numeric OIDs and case-insensitive names', () => {
      expect(parseRfc4514('cn=x')[0][0].oid).toBe('2.5.4.3');
      expect(parseRfc4514('OID.2.5.4.3=x')[0][0].oid).toBe('2.5.4.3');
      expect(parseRfc4514('1.2.3.4=x')[0][0].oid).toBe('1.2.3.4');
    });

    it.each([
      ['CN', 'no ='],
      ['CN=a,,O=b', 'empty RDN'],
      ['CN=a,', 'trailing separator'],
      ['FOO=a', 'unknown name'],
      ['CN=a"b', 'unescaped quote'],
      ['CN=a;O=b', 'semicolon'],
      ['CN=a\\zz', 'bad escape'],
      ['CN=#0c0361', 'truncated BER'],
      ['CN=\\FF', 'invalid UTF-8'],
    ])('refuses %s (%s)', (input) => {
      expect(() => parseRfc4514(input)).toThrow(DistinguishedNameError);
    });
  });

  describe('certificate subjects', () => {
    it('matches the RFC 4514 form, which is the reverse of DER order', async () => {
      const subject = await subjectOf([
        { C: ['US'] },
        { O: ['Acme'] },
        { CN: ['device-1'] },
      ]);
      expect(dnEquals(subject, parseRfc4514('CN=device-1,O=Acme,C=US'))).toBe(
        true,
      );
      expect(dnEquals(subject, parseRfc4514('C=US,O=Acme,CN=device-1'))).toBe(
        false,
      );
      expect(formatRfc4514(subject)).toBe('CN=device-1,O=Acme,C=US');
    });

    it('compares values case-insensitively with folded spaces', async () => {
      const subject = await subjectOf([
        { O: ['Acme  Corp'] },
        { CN: ['Device-1'] },
      ]);
      expect(dnEquals(subject, parseRfc4514('cn=device-1, o= acme corp'))).toBe(
        true,
      );
    });

    it('does not match a prefix, a superset, or another value', async () => {
      const subject = await subjectOf([{ O: ['Acme'] }, { CN: ['device-1'] }]);
      expect(dnEquals(subject, parseRfc4514('CN=device-1'))).toBe(false);
      expect(dnEquals(subject, parseRfc4514('CN=device-1,O=Acme,C=US'))).toBe(
        false,
      );
      expect(dnEquals(subject, parseRfc4514('CN=device-2,O=Acme'))).toBe(false);
    });

    it('compares a multi-valued RDN as a set', async () => {
      const subject = await subjectOf([
        { O: ['Acme'] },
        { CN: ['a'], '0.9.2342.19200300.100.1.1': ['42'] },
      ]);
      expect(dnEquals(subject, parseRfc4514('UID=42+CN=a,O=Acme'))).toBe(true);
      expect(dnEquals(subject, parseRfc4514('CN=a,UID=42,O=Acme'))).toBe(false);
    });

    it('does not let an escaped comma pass as a separator', async () => {
      const subject = await subjectOf([{ O: ['Acme, Inc.'] }, { CN: ['x'] }]);
      expect(dnEquals(subject, parseRfc4514('CN=x,O=Acme\\, Inc.'))).toBe(true);
      expect(dnEquals(subject, parseRfc4514('CN=x,O=Acme,O=Inc.'))).toBe(false);
    });

    it('reads the issuer too', async () => {
      const root = await issue({
        name: [{ O: ['Root Org'] }, { CN: ['Root'] }],
        ca: true,
      });
      const child = await issue({ issuer: root });
      const issuer = parseDerName(
        certificateNames(child.certificate.raw).issuer,
      );
      expect(formatRfc4514(issuer)).toBe('CN=Root,O=Root Org');
    });
  });

  describe('DER reading', () => {
    it('refuses truncated and indefinite lengths', () => {
      expect(() => readTlv(Buffer.from([0x30, 0x05, 0x00]), 0)).toThrow(
        DistinguishedNameError,
      );
      expect(() => readTlv(Buffer.from([0x30, 0x80, 0x00, 0x00]), 0)).toThrow(
        DistinguishedNameError,
      );
    });

    it('reads a long-form length', () => {
      const der = Buffer.concat([
        Buffer.from([0x04, 0x81, 0x80]),
        Buffer.alloc(128),
      ]);
      expect(readTlv(der, 0)).toMatchObject({ contentStart: 3, end: 131 });
    });

    it('decodes BMPString and refuses a malformed Name', () => {
      // SEQUENCE { SET { SEQUENCE { OID 2.5.4.3, BMPString "hi" } } }
      const name = Buffer.from('300f310d300b06035504031e0400680069', 'hex');
      expect(parseDerName(name)).toEqual([
        [{ oid: '2.5.4.3', value: { text: 'hi' } }],
      ]);
      expect(() => parseDerName(Buffer.from('3003020100', 'hex'))).toThrow(
        DistinguishedNameError,
      );
    });

    it('refuses something that is not a certificate', () => {
      expect(() => certificateNames(Buffer.from('3000', 'hex'))).toThrow(
        DistinguishedNameError,
      );
    });
  });
});
