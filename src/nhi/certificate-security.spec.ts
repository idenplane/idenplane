import { X509Certificate, createPrivateKey } from 'node:crypto';
import type { Realm } from '@prisma/client';
import { NhiService } from './nhi.service.js';
import { CertificateKeyAlgorithm } from './dto/certificate.dto.js';
import { makeTestCertificate } from './__mocks__/certificate.fixture.js';

describe('certificate interoperability and signed metadata', () => {
  const service = new NhiService({} as never, {} as never);
  const realm = { id: 'security-audit', name: 'security-audit' } as Realm;

  it.each(Object.values(CertificateKeyAlgorithm))(
    'generates a verifiable %s certificate with a matching private key',
    async (keyAlgorithm) => {
      const result = await service.generateDeviceCertificate(realm, {
        name: 'device',
        subjectCommonName: 'device.internal',
        keyAlgorithm,
        validityDays: 30,
        subjectAlternativeNames: 'DNS:device.internal,IP:127.0.0.1',
      });
      const certificate = new X509Certificate(result.certificatePem);
      expect(certificate.verify(certificate.publicKey)).toBe(true);
      expect(
        certificate.checkPrivateKey(createPrivateKey(result.privateKeyPem)),
      ).toBe(true);
      expect(
        Date.parse(certificate.validTo) - Date.parse(certificate.validFrom),
      ).toBe(30 * 86_400_000);
      expect(result.info.notAfter).toBe(
        new Date(certificate.validTo).toISOString(),
      );
      expect(certificate.checkHost('device.internal')).toBe('device.internal');
      expect(certificate.checkIP('127.0.0.1')).toBe('127.0.0.1');
      expect(certificate.ca).toBe(false);
    },
    20_000,
  );

  it('does not turn DN punctuation into additional subject fields', async () => {
    const result = await service.generateDeviceCertificate(realm, {
      name: 'device',
      subjectCommonName: 'device, O=injected',
    });
    const subject = new X509Certificate(result.certificatePem).toLegacyObject()
      .subject;
    expect(subject.CN).toBe('device, O=injected');
    expect(subject.O).toBeUndefined();
  });

  it('honors an explicit future expiry', async () => {
    const expiresAt = new Date(Date.now() + 7 * 86_400_000);
    expiresAt.setMilliseconds(0);
    const result = await service.generateDeviceCertificate(realm, {
      name: 'device',
      expiresAt: expiresAt.toISOString(),
    });
    expect(result.info.notAfter).toBe(expiresAt.toISOString());
  });

  it('rejects malformed data even when wrapped in PEM headers', () => {
    const pem = `-----BEGIN CERTIFICATE-----\n${Buffer.from('not an X.509 certificate').toString('base64')}\n-----END CERTIFICATE-----`;
    expect(service.validateCertificate(pem).valid).toBe(false);
  });

  it('reads the actual subject, SAN and dates from signed DER, ignoring appended text', async () => {
    const { pem } = await makeTestCertificate({
      name: 'real-device',
      dns: 'real-device.internal',
    });
    const cert = new X509Certificate(pem);
    const info = service.getCertificateInfo(
      pem + '\nCN=forged\nissuer=CN=forged\nbasicConstraints CA:true',
    );
    expect(info.subject).toBe(cert.subject);
    expect(info.notAfter).toBe(new Date(cert.validTo).toISOString());
    expect(info.isCA).not.toBe(true);
    expect(info.sans).toContain('DNS:real-device.internal');
  });

  it('rejects expired certificates instead of inventing future validity dates', async () => {
    const { pem } = await makeTestCertificate({
      notBefore: new Date(Date.now() - 3 * 86_400_000),
      notAfter: new Date(Date.now() - 86_400_000),
    });
    expect(service.validateCertificate(pem)).toMatchObject({
      valid: false,
      error: 'Certificate has expired',
    });
  });

  it('rejects not-yet-valid certificates', async () => {
    const { pem } = await makeTestCertificate({
      notBefore: new Date(Date.now() + 86_400_000),
      notAfter: new Date(Date.now() + 2 * 86_400_000),
    });
    expect(service.validateCertificate(pem).valid).toBe(false);
  });
});
