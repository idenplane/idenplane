import 'reflect-metadata';
import { randomBytes, X509Certificate } from 'node:crypto';
import { isIP } from 'node:net';
import {
  BasicConstraintsExtension,
  ExtendedKeyUsage,
  ExtendedKeyUsageExtension,
  KeyUsageFlags,
  KeyUsagesExtension,
  SubjectAlternativeNameExtension,
  X509Certificate as ParsedCertificate,
  X509CertificateGenerator,
  type Extension,
  type JsonGeneralNames,
  type JsonName,
} from '@peculiar/x509';
import {
  CertificateFormat,
  CertificateKeyAlgorithm,
  type CertificateInfoDto,
  type GenerateCertificateDto,
} from './dto/certificate.dto.js';

/** Parse signed certificate data, never PEM comments or invented defaults. */
export function parseCertificateInfo(pem: string): CertificateInfoDto {
  if (typeof pem !== 'string' || !pem.includes('-----BEGIN CERTIFICATE-----')) {
    throw new Error('Invalid certificate format: missing PEM header');
  }
  if (Buffer.byteLength(pem) > 64 * 1024) {
    throw new Error('Certificate exceeds the 64 KiB size limit');
  }
  let certificate: X509Certificate;
  try {
    certificate = new X509Certificate(pem);
  } catch {
    throw new Error('Invalid X.509 certificate');
  }
  const extension = new ParsedCertificate(certificate.raw).getExtension(
    SubjectAlternativeNameExtension,
  );
  const prefixes: Record<string, string> = {
    dns: 'DNS',
    ip: 'IP',
    url: 'URI',
    email: 'email',
  };
  const sans = extension?.names
    .toJSON()
    .map((name) => `${prefixes[name.type] ?? name.type}:${name.value}`);
  return {
    subject: certificate.subject,
    issuer: certificate.issuer,
    notBefore: new Date(certificate.validFrom).toISOString(),
    notAfter: new Date(certificate.validTo).toISOString(),
    fingerprint: `SHA256:${certificate.fingerprint256}`,
    sans: sans?.length ? sans : undefined,
    isCA: certificate.ca,
  };
}

/** Produce a standards-encoded, signed certificate and an exportable PKCS#8 key. */
export async function generateCertificate(dto: GenerateCertificateDto) {
  if (dto.format && dto.format !== CertificateFormat.PEM) {
    throw new Error('Only PEM certificate output is supported');
  }
  const days = dto.validityDays ?? 365;
  if (!Number.isSafeInteger(days) || days < 1 || days > 3650) {
    throw new Error('Certificate validity must be between 1 and 3650 days');
  }
  const algorithm = dto.keyAlgorithm ?? CertificateKeyAlgorithm.ECDSA_P256;
  if (!Object.values(CertificateKeyAlgorithm).includes(algorithm)) {
    throw new Error('Unsupported certificate key algorithm');
  }
  const rsa =
    algorithm === CertificateKeyAlgorithm.RSA_2048 ||
    algorithm === CertificateKeyAlgorithm.RSA_4096;
  const keyAlgorithm = rsa
    ? {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength:
          algorithm === CertificateKeyAlgorithm.RSA_4096 ? 4096 : 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      }
    : {
        name: 'ECDSA',
        namedCurve:
          algorithm === CertificateKeyAlgorithm.ECDSA_P384 ? 'P-384' : 'P-256',
      };
  const signingAlgorithm = {
    name: keyAlgorithm.name,
    hash:
      algorithm === CertificateKeyAlgorithm.ECDSA_P384 ? 'SHA-384' : 'SHA-256',
  };
  const keys = await crypto.subtle.generateKey(keyAlgorithm, true, [
    'sign',
    'verify',
  ]);
  if (!('privateKey' in keys)) {
    throw new Error('Certificate generation requires an asymmetric key pair');
  }
  const notBefore = new Date(Math.floor((Date.now() - 60_000) / 1000) * 1000);
  const notAfter = dto.expiresAt
    ? new Date(dto.expiresAt)
    : new Date(notBefore.getTime() + days * 86_400_000);
  if (
    !Number.isFinite(notAfter.getTime()) ||
    notAfter.getTime() <= Date.now()
  ) {
    throw new Error('Certificate expiration must be in the future');
  }
  const fields = [
    [
      'CN',
      dto.subjectCommonName ??
        dto.name ??
        `device-${randomBytes(4).toString('hex')}`,
    ],
    ['OU', dto.subjectOrganizationalUnit],
    ['O', dto.subjectOrganization],
    ['L', dto.subjectLocality],
    ['ST', dto.subjectState],
    ['C', dto.subjectCountry],
  ];
  const name: JsonName = fields
    .filter(([, value]) => value)
    .map(([field, value]) => ({ [field!]: [value!] }));
  const isCA = dto.isCertificateAuthority ?? false;
  const extensions: Extension[] = [
    new BasicConstraintsExtension(isCA, isCA ? 0 : undefined, true),
    new KeyUsagesExtension(
      isCA
        ? KeyUsageFlags.keyCertSign | KeyUsageFlags.cRLSign
        : KeyUsageFlags.digitalSignature,
      true,
    ),
  ];
  if (!isCA)
    extensions.push(
      new ExtendedKeyUsageExtension([ExtendedKeyUsage.clientAuth]),
    );
  if (dto.subjectAlternativeNames) {
    const names: JsonGeneralNames = dto.subjectAlternativeNames
      .split(',')
      .map((entry) => {
        const separator = entry.indexOf(':');
        const type = entry.slice(0, separator).trim().toUpperCase();
        const value = entry.slice(separator + 1).trim();
        if (separator < 1 || !value)
          throw new Error('Invalid Subject Alternative Name');
        if (type === 'DNS') return { type: 'dns', value };
        if (type === 'IP' && isIP(value)) return { type: 'ip', value };
        if (type === 'URI') {
          new URL(value);
          return { type: 'url', value };
        }
        if (type === 'EMAIL') return { type: 'email', value };
        throw new Error('Unsupported or invalid Subject Alternative Name');
      });
    extensions.push(new SubjectAlternativeNameExtension(names));
  }
  // A positive, non-zero, 128-bit serial number.
  const serial = randomBytes(16);
  serial[0] = (serial[0] & 0x7f) | 1;
  const certificate = await X509CertificateGenerator.createSelfSigned(
    {
      name,
      keys,
      signingAlgorithm,
      serialNumber: serial.toString('hex'),
      notBefore,
      notAfter,
      extensions,
    },
    crypto,
  );
  const certificatePem = certificate.toString('pem');
  const privateKey = Buffer.from(
    await crypto.subtle.exportKey('pkcs8', keys.privateKey),
  );
  const privateKeyPem = `-----BEGIN PRIVATE KEY-----\n${privateKey
    .toString('base64')
    .match(/.{1,64}/g)!
    .join('\n')}\n-----END PRIVATE KEY-----`;
  return {
    certificatePem,
    privateKeyPem,
    info: parseCertificateInfo(certificatePem),
  };
}
