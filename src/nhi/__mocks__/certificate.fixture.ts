import 'reflect-metadata';
import { X509CertificateGenerator, BasicConstraintsExtension, SubjectAlternativeNameExtension } from '@peculiar/x509';

/** Real certificates for security tests; no production keys or external tools. */
export async function makeTestCertificate(options: {
  name?: string;
  notBefore?: Date;
  notAfter?: Date;
  isCA?: boolean;
  dns?: string;
} = {}) {
  const algorithm = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' };
  const keys = await crypto.subtle.generateKey(algorithm, true, ['sign', 'verify']);
  const extensions = [new BasicConstraintsExtension(options.isCA ?? false, undefined, true)];
  const certificate = await X509CertificateGenerator.createSelfSigned({
    name: [{ CN: [options.name ?? 'audit-device'] }],
    keys,
    signingAlgorithm: algorithm,
    notBefore: options.notBefore ?? new Date(Date.now() - 60_000),
    notAfter: options.notAfter ?? new Date(Date.now() + 86_400_000),
    extensions: options.dns ? [...extensions, new SubjectAlternativeNameExtension([{ type: 'dns', value: options.dns }])] : extensions,
  }, crypto);
  const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', keys.privateKey));
  const privateKeyPem = `-----BEGIN PRIVATE KEY-----\n${der.toString('base64').match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----`;
  return { pem: certificate.toString('pem'), privateKeyPem, keys };
}
