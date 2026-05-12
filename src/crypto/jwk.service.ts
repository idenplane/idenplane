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

export interface GeneratedKeyPair {
  kid: string;
  publicKeyPem: string;
  privateKeyPem: string;
}

@Injectable()
export class JwkService {
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
    const privateKey = await importPKCS8(privateKeyPem, 'RS256');

    return new SignJWT(payload)
      .setProtectedHeader({ alg: 'RS256', kid, typ: 'JWT' })
      .setIssuedAt()
      .setExpirationTime(`${expiresInSeconds}s`)
      .setJti(randomUUID())
      .sign(privateKey);
  }

  async verifyJwt(
    token: string,
    publicKeyPem: string,
  ): Promise<JWTPayload> {
    const publicKey = await importSPKI(publicKeyPem, 'RS256');
    const { payload } = await jwtVerify(token, publicKey);
    return payload;
  }

  async publicKeyToJwk(publicKeyPem: string, kid: string): Promise<JWK> {
    const publicKey = await importSPKI(publicKeyPem, 'RS256');
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
