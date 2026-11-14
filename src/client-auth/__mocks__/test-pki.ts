import 'reflect-metadata';
import { X509Certificate } from 'node:crypto';
import {
  BasicConstraintsExtension,
  ExtendedKeyUsageExtension,
  Extension,
  KeyUsageFlags,
  KeyUsagesExtension,
  SubjectAlternativeNameExtension,
  X509Certificate as ParsedCertificate,
  X509CertificateGenerator,
  type JsonGeneralName,
  type JsonName,
} from '@peculiar/x509';

/**
 * Real certificates for the mTLS tests, built in-process with WebCrypto: no
 * external tools, no checked-in keys. Names are JSON in DER order (the most
 * significant RDN first), so an RFC 4514 string of the same name is the
 * reverse.
 */

const ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' };
const DAY = 86_400_000;

export interface TestIdentity {
  certificate: X509Certificate;
  pem: string;
  privateKeyPem: string;
  keys: CryptoKeyPair;
}

export interface IssueOptions {
  /** Defaults to [{ CN: [cn] }]. */
  name?: JsonName;
  cn?: string;
  /** Self-signed when absent. */
  issuer?: TestIdentity;
  ca?: boolean;
  pathLength?: number;
  /** Omit the basicConstraints extension altogether. */
  noBasicConstraints?: boolean;
  keyUsage?: KeyUsageFlags;
  /** OIDs; omitted when undefined. */
  eku?: string[];
  san?: JsonGeneralName[];
  notBefore?: Date;
  notAfter?: Date;
  extraExtensions?: Extension[];
  serialNumber?: string;
}

let serial = 1;

export const OIDS = {
  clientAuth: '1.3.6.1.5.5.7.3.2',
  serverAuth: '1.3.6.1.5.5.7.3.1',
  anyEku: '2.5.29.37.0',
};

export async function issue(options: IssueOptions = {}): Promise<TestIdentity> {
  const keys = (await crypto.subtle.generateKey(ALGORITHM, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const name = options.name ?? [{ CN: [options.cn ?? 'test'] }];
  const extensions: Extension[] = [];
  if (!options.noBasicConstraints) {
    extensions.push(
      new BasicConstraintsExtension(
        options.ca ?? false,
        options.pathLength,
        true,
      ),
    );
  }
  if (options.keyUsage !== undefined) {
    extensions.push(new KeyUsagesExtension(options.keyUsage, true));
  } else if (options.ca) {
    extensions.push(
      new KeyUsagesExtension(
        KeyUsageFlags.keyCertSign | KeyUsageFlags.cRLSign,
        true,
      ),
    );
  }
  if (options.eku) {
    extensions.push(new ExtendedKeyUsageExtension(options.eku, false));
  }
  if (options.san) {
    extensions.push(new SubjectAlternativeNameExtension(options.san, false));
  }
  extensions.push(...(options.extraExtensions ?? []));

  const issuerKeys = options.issuer?.keys ?? keys;
  const generated = await X509CertificateGenerator.create(
    {
      serialNumber:
        options.serialNumber ?? (serial++).toString(16).padStart(4, '0'),
      subject: name,
      // The issuer's subject exactly as encoded, so the names chain.
      issuer: options.issuer
        ? new ParsedCertificate(options.issuer.pem).subjectName
        : name,
      notBefore: options.notBefore ?? new Date(Date.now() - DAY),
      notAfter: options.notAfter ?? new Date(Date.now() + 30 * DAY),
      signingKey: issuerKeys.privateKey,
      publicKey: keys.publicKey,
      signingAlgorithm: ALGORITHM,
      extensions,
    },
    crypto,
  );
  const pem = generated.toString('pem');
  const pkcs8 = Buffer.from(
    await crypto.subtle.exportKey('pkcs8', keys.privateKey),
  ).toString('base64');
  return {
    certificate: new X509Certificate(pem),
    pem,
    privateKeyPem: `-----BEGIN PRIVATE KEY-----\n${pkcs8.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----\n`,
    keys,
  };
}

/** A name-constraints extension (permitted dNSName e.local). */
export function nameConstraints(): Extension {
  return new Extension(
    '2.5.29.30',
    true,
    Buffer.from('300da00b3009820765 2e6c6f63616c'.replace(/ /g, ''), 'hex'),
  );
}

/** A critical extension nobody processes. */
export function unknownCritical(): Extension {
  return new Extension('1.3.6.1.4.1.55555.1', true, Buffer.from('0500', 'hex'));
}

/** Root CA → intermediate CA → client leaf. */
export async function chain(leaf: IssueOptions = {}): Promise<{
  root: TestIdentity;
  intermediate: TestIdentity;
  leaf: TestIdentity;
}> {
  const root = await issue({
    name: [{ O: ['Test PKI'] }, { CN: ['Test Root'] }],
    ca: true,
  });
  const intermediate = await issue({
    name: [{ O: ['Test PKI'] }, { CN: ['Test Intermediate'] }],
    ca: true,
    issuer: root,
  });
  const client = await issue({
    eku: [OIDS.clientAuth],
    ...leaf,
    issuer: leaf.issuer ?? intermediate,
  });
  return { root, intermediate, leaf: client };
}
