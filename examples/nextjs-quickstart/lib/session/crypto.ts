import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export function newSessionId(): string { return randomBytes(32).toString('base64url'); }
export function sessionHash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
export function validSessionId(value: string): boolean { return /^[A-Za-z0-9_-]{43}$/.test(value); }

export class SessionCipher {
  private readonly key: Buffer;
  constructor(key: Uint8Array) {
    if (key.length !== 32) throw new Error('Session encryption requires a 32-byte key');
    this.key = Buffer.from(key);
  }
  seal(value: unknown, context: string): string {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(context));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), encrypted]).toString('base64url');
  }
  open<T>(value: string, context: string): T {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid session ciphertext');
    const data = Buffer.from(value, 'base64url');
    if (data.length < 30 || data[0] !== 1) throw new Error('Invalid session ciphertext');
    const decipher = createDecipheriv('aes-256-gcm', this.key, data.subarray(1, 13));
    decipher.setAAD(Buffer.from(context));decipher.setAuthTag(data.subarray(13, 29));
    return JSON.parse(Buffer.concat([decipher.update(data.subarray(29)), decipher.final()]).toString('utf8')) as T;
  }
}
