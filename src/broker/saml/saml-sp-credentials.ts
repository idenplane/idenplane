import 'reflect-metadata';
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  webcrypto,
} from 'node:crypto';
import { X509CertificateGenerator } from '@peculiar/x509';

/** The realm signing key as CachedLookupsService returns it. */
export interface RealmSigningKeyLike {
  kid: string;
  algorithm: string;
  publicKey: string;
  /** Decrypted PEM. */
  privateKey: string;
  createdAt: Date;
}

/**
 * Thrown when the realm's signing key cannot act as the SAML SP key (it is
 * not RSA). The realm's keys are RS256 today; the check keeps a future key
 * type from being used for RSA-SHA256 signatures by mistake.
 */
export class UnsupportedSpKeyError extends Error {
  constructor(algorithm: string) {
    super(
      `The realm's signing key is ${algorithm}; SAML signing needs an RSA (RS256) key`,
    );
    this.name = 'UnsupportedSpKeyError';
  }
}

export function assertRsaKey(key: RealmSigningKeyLike): void {
  if (key.algorithm !== 'RS256') throw new UnsupportedSpKeyError(key.algorithm);
  if (createPublicKey(key.publicKey).asymmetricKeyType !== 'rsa') {
    throw new UnsupportedSpKeyError(key.algorithm);
  }
}

const RSA_PKCS1_SHA256 = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
const TWENTY_YEARS_MS = 20 * 365.25 * 86_400_000;
const cache = new Map<string, Promise<string>>();

/**
 * The SP signing certificate published in SP metadata: a self-signed X.509
 * certificate for the realm's signing key. SAML only uses the key in it, so
 * it is derived from the key alone and is the same on every call and every
 * process (RSA PKCS#1 v1.5 signatures are deterministic): serial from the
 * key ID, validity from the key's creation. When the realm rotates its key
 * the certificate changes with it, and the IdP must get the new metadata.
 */
export async function spCertificatePem(
  key: RealmSigningKeyLike,
  realmName: string,
): Promise<string> {
  assertRsaKey(key);
  const cacheKey = `${realmName}\u0000${key.kid}\u0000${key.publicKey}`;
  let pending = cache.get(cacheKey);
  if (!pending) {
    pending = buildCertificate(key, realmName);
    cache.set(cacheKey, pending);
    pending.catch(() => cache.delete(cacheKey));
  }
  return pending;
}

async function buildCertificate(
  key: RealmSigningKeyLike,
  realmName: string,
): Promise<string> {
  const subtle = webcrypto.subtle;
  const pkcs8 = createPrivateKey(key.privateKey).export({
    type: 'pkcs8',
    format: 'der',
  });
  const spki = createPublicKey(key.publicKey).export({
    type: 'spki',
    format: 'der',
  });
  const privateKey = await subtle.importKey(
    'pkcs8',
    pkcs8,
    RSA_PKCS1_SHA256,
    false,
    ['sign'],
  );
  const publicKey = await subtle.importKey(
    'spki',
    spki,
    RSA_PKCS1_SHA256,
    true,
    ['verify'],
  );
  const serial = createHash('sha256').update(key.kid).digest().subarray(0, 16);
  serial[0] = (serial[0] & 0x7f) | 1;
  const notBefore = new Date(Math.floor(key.createdAt.getTime() / 1000) * 1000);
  const cn = `Idenplane SAML SP ${realmName}`.replace(/[,+="\\<>;#]/g, '_');
  const cert = await X509CertificateGenerator.createSelfSigned(
    {
      serialNumber: serial.toString('hex'),
      name: `CN=${cn}`,
      notBefore,
      notAfter: new Date(notBefore.getTime() + TWENTY_YEARS_MS),
      signingAlgorithm: RSA_PKCS1_SHA256,
      keys: { privateKey, publicKey } as CryptoKeyPair,
    },
    webcrypto as unknown as Crypto,
  );
  return cert.toString('pem');
}

/** The base64 body of a PEM (as metadata carries a certificate). */
export function pemBody(pem: string): string {
  return pem
    .replace(/-----BEGIN [A-Z ]+-----/g, '')
    .replace(/-----END [A-Z ]+-----/g, '')
    .replace(/\s+/g, '');
}
