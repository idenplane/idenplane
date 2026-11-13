import { Injectable } from '@nestjs/common';
import {
  generateKeyPair,
  exportJWK,
  importPKCS8,
  importSPKI,
  SignJWT,
  jwtVerify,
  type JWK,
  type JWTPayload,
} from 'jose';
import { randomUUID, createHash } from 'crypto';

type ImportedKey = Awaited<ReturnType<typeof importSPKI>>;

/**
 * Parsed keys kept per PEM. Parsing a PEM is the costliest step of signing
 * or verifying a token after the RSA operation itself, and a realm signs
 * with the same key until it rotates, so each one is parsed once. A PEM
 * names its key completely, so an entry can never be stale; the bound only
 * keeps rotated keys from accumulating.
 */
const MAX_IMPORTED_KEYS = 256;

class ImportedKeyCache {
  private readonly keys = new Map<string, Promise<ImportedKey>>();

  constructor(private readonly load: (pem: string) => Promise<ImportedKey>) {}

  get(pem: string): Promise<ImportedKey> {
    const cached = this.keys.get(pem);
    if (cached) return cached;
    if (this.keys.size >= MAX_IMPORTED_KEYS) {
      const oldest = this.keys.keys().next().value;
      if (oldest !== undefined) this.keys.delete(oldest);
    }
    // The promise itself is kept, so concurrent first uses parse once. A
    // PEM that fails to parse is not kept: the caller sees the error.
    const loading = this.load(pem);
    this.keys.set(pem, loading);
    loading.catch(() => {
      if (this.keys.get(pem) === loading) this.keys.delete(pem);
    });
    return loading;
  }
}

export interface GeneratedKeyPair {
  kid: string;
  publicKeyPem: string;
  privateKeyPem: string;
}

@Injectable()
export class JwkService {
  private readonly privateKeys = new ImportedKeyCache((pem) =>
    importPKCS8(pem, 'RS256'),
  );
  private readonly publicKeys = new ImportedKeyCache((pem) =>
    importSPKI(pem, 'RS256'),
  );

  async generateRsaKeyPair(): Promise<GeneratedKeyPair> {
    const { publicKey, privateKey } = await generateKeyPair('RS256', {
      extractable: true,
    });

    const publicKeyPem = await this.exportKeyToPem(publicKey, 'public');
    const privateKeyPem = await this.exportKeyToPem(privateKey, 'private');

    return {
      kid: randomUUID(),
      publicKeyPem,
      privateKeyPem,
    };
  }

  async signJwt(
    payload: JWTPayload,
    privateKeyPem: string,
    kid: string,
    expiresInSeconds: number,
  ): Promise<string> {
    const privateKey = await this.privateKeys.get(privateKeyPem);

    return new SignJWT(payload)
      .setProtectedHeader({ alg: 'RS256', kid, typ: 'JWT' })
      .setIssuedAt()
      .setExpirationTime(`${expiresInSeconds}s`)
      .setJti(randomUUID())
      .sign(privateKey);
  }

  async verifyJwt(token: string, publicKeyPem: string): Promise<JWTPayload> {
    const publicKey = await this.publicKeys.get(publicKeyPem);
    // cert-binding: exempt: the verification helper itself; every caller of verifyJwt is classified
    const { payload } = await jwtVerify(token, publicKey);
    return payload;
  }

  async publicKeyToJwk(publicKeyPem: string, kid: string): Promise<JWK> {
    const publicKey = await this.publicKeys.get(publicKeyPem);
    const jwk = await exportJWK(publicKey);
    return {
      ...jwk,
      kid,
      alg: 'RS256',
      use: 'sig',
    };
  }

  /**
   * Compute at_hash per OIDC Core section 3.3.2.11:
   * SHA-256 hash of the access token, take left half, base64url encode.
   */
  computeAtHash(accessToken: string): string {
    const hash = createHash('sha256').update(accessToken).digest();
    const leftHalf = hash.subarray(0, hash.length / 2);
    return Buffer.from(leftHalf).toString('base64url');
  }

  /**
   * Compute c_hash per OIDC Core section 3.3.2.11:
   * SHA-256 hash of the authorization code, take left half, base64url encode.
   */
  computeChash(code: string): string {
    const hash = createHash('sha256').update(code).digest();
    const leftHalf = hash.subarray(0, hash.length / 2);
    return Buffer.from(leftHalf).toString('base64url');
  }

  private async exportKeyToPem(
    key: CryptoKey,
    type: 'public' | 'private',
  ): Promise<string> {
    const exported = await crypto.subtle.exportKey(
      type === 'public' ? 'spki' : 'pkcs8',
      key,
    );
    const b64 = Buffer.from(exported).toString('base64');
    const lines = b64.match(/.{1,64}/g)?.join('\n') ?? b64;
    const label = type === 'public' ? 'PUBLIC KEY' : 'PRIVATE KEY';
    return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----`;
  }
}
