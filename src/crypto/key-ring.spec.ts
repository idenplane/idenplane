import {
  createCipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  scryptSync,
} from 'crypto';
import { CryptoService } from './crypto.service.js';
import {
  ENVELOPE_PREFIX,
  UnreadableSecretError,
  deriveKey,
  isEnvelope,
  keyIdOf,
  keyRingFromEnv,
  looksEncrypted,
  parseEnvelope,
  seal,
  tryOpen,
} from './key-ring.js';

const KEY_VARS = [
  'WEBHOOK_SECRET_KEY',
  'WEBHOOK_ENCRYPTION_SALT',
  'WEBHOOK_SECRET_KEY_PREVIOUS',
  'WEBHOOK_ENCRYPTION_SALT_PREVIOUS',
] as const;

/** A CryptoService built under exactly these key variables. */
function cryptoWith(
  env: Partial<Record<(typeof KEY_VARS)[number], string>>,
): CryptoService {
  const saved = KEY_VARS.map((k) => [k, process.env[k]] as const);
  for (const k of KEY_VARS) {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    return new CryptoService();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** Ciphertext as versions before key rotation wrote it: no key id. */
function legacyEncrypt(raw: string, salt: string, plaintext: string): string {
  const key = scryptSync(raw, salt, 32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}

describe('key ring', () => {
  const A = { WEBHOOK_SECRET_KEY: 'key-a', WEBHOOK_ENCRYPTION_SALT: 'salt-a' };
  const B = { WEBHOOK_SECRET_KEY: 'key-b', WEBHOOK_ENCRYPTION_SALT: 'salt-b' };
  const BafterA = {
    ...B,
    WEBHOOK_SECRET_KEY_PREVIOUS: 'key-a',
    WEBHOOK_ENCRYPTION_SALT_PREVIOUS: 'salt-a',
  };
  const a = cryptoWith(A);
  const b = cryptoWith(B);
  const rotating = cryptoWith(BafterA);

  describe('configuration', () => {
    it('has no previous key unless one is configured', () => {
      const ring = keyRingFromEnv(A);
      expect(ring.previous).toBeUndefined();
      expect(ring.current.key).toEqual(deriveKey('key-a', 'salt-a'));
      expect(a.hasPreviousKey()).toBe(false);
      expect(a.previousKeyId).toBeUndefined();
    });

    it('derives the previous key from its own key and salt', () => {
      const ring = keyRingFromEnv(BafterA);
      expect(ring.previous?.key).toEqual(deriveKey('key-a', 'salt-a'));
      expect(rotating.hasPreviousKey()).toBe(true);
      expect(rotating.previousKeyId).toBe(a.currentKeyId);
      expect(rotating.currentKeyId).toBe(b.currentKeyId);
    });

    it('reuses the current key or salt for the half left out', () => {
      const saltOnly = keyRingFromEnv({
        ...B,
        WEBHOOK_ENCRYPTION_SALT_PREVIOUS: 'salt-a',
      });
      expect(saltOnly.previous?.key).toEqual(deriveKey('key-b', 'salt-a'));
      const keyOnly = keyRingFromEnv({
        ...B,
        WEBHOOK_SECRET_KEY_PREVIOUS: 'key-a',
      });
      expect(keyOnly.previous?.key).toEqual(deriveKey('key-a', 'salt-b'));
    });

    it('ignores a previous key equal to the current one', () => {
      const ring = keyRingFromEnv({
        ...B,
        WEBHOOK_SECRET_KEY_PREVIOUS: 'key-b',
      });
      expect(ring.previous).toBeUndefined();
      expect(ring.previousIsCurrent).toBe(true);
    });

    it('accepts the built-in development key as the previous one', () => {
      const ring = keyRingFromEnv({
        ...B,
        WEBHOOK_SECRET_KEY_PREVIOUS: 'dev-webhook-secret-key-replace-me',
        WEBHOOK_ENCRYPTION_SALT_PREVIOUS: 'idenplane-webhook-salt',
      });
      expect(ring.previous?.id).toBe(cryptoWith({}).currentKeyId);
    });

    it('key ids are 8 hex characters, distinct per key, and not key bytes', () => {
      const key = deriveKey('key-a', 'salt-a');
      expect(keyIdOf(key)).toMatch(/^[0-9a-f]{8}$/);
      expect(keyIdOf(key)).not.toBe(key.subarray(0, 4).toString('hex'));
      expect(a.currentKeyId).not.toBe(b.currentKeyId);
    });
  });

  describe('envelope format', () => {
    it('names the current key and round-trips', () => {
      const sealed = b.encrypt('hunter2');
      expect(sealed.startsWith(`${ENVELOPE_PREFIX}${b.currentKeyId}.`)).toBe(
        true,
      );
      expect(isEnvelope(sealed)).toBe(true);
      expect(looksEncrypted(sealed)).toBe(true);
      expect(b.decrypt(sealed)).toBe('hunter2');
      expect(b.open(sealed)).toEqual({ plaintext: 'hunter2', slot: 'current' });
    });

    it('round-trips the empty string and unicode', () => {
      for (const value of ['', 'ключ-🔑-'.repeat(50)]) {
        expect(b.decrypt(b.encrypt(value))).toBe(value);
      }
    });

    it('binds the key id: an edited id or body fails', () => {
      const sealed = b.encrypt('hunter2');
      const parts = parseEnvelope(sealed)!;
      const otherId = parts.keyId === '00000000' ? '11111111' : '00000000';
      expect(() => b.decrypt(sealed.replace(parts.keyId, otherId))).toThrow();
      const body = Buffer.from(parts.packed);
      body[body.length - 1] ^= 0xff;
      expect(() =>
        b.decrypt(
          `${ENVELOPE_PREFIX}${parts.keyId}.${body.toString('base64')}`,
        ),
      ).toThrow();
    });

    it('recognizes only well-formed envelopes', () => {
      const sealed = b.encrypt('x');
      const body = sealed.slice(ENVELOPE_PREFIX.length + 9);
      for (const value of [
        `${ENVELOPE_PREFIX}${b.currentKeyId}`,
        `${ENVELOPE_PREFIX}abc.${body}`,
        `${ENVELOPE_PREFIX}ABCDEF12.${body}`,
        `${ENVELOPE_PREFIX}zzzzzzzz.${body}`,
        `${ENVELOPE_PREFIX}${b.currentKeyId}.${body}!`,
        `${ENVELOPE_PREFIX}${b.currentKeyId}.QUJD`,
        'ek1.password-typed-by-someone',
        body,
      ]) {
        expect(isEnvelope(value)).toBe(false);
      }
    });
  });

  it('treats a non-string value as no envelope', () => {
    for (const value of [['ek1.'], { length: 40 }, 42, null, undefined]) {
      expect(parseEnvelope(value as unknown as string)).toBeUndefined();
    }
  });

  describe('decryption', () => {
    it('reads legacy ciphertext with the current key', () => {
      const legacy = legacyEncrypt('key-a', 'salt-a', 'old-secret');
      expect(isEnvelope(legacy)).toBe(false);
      expect(a.decrypt(legacy)).toBe('old-secret');
      expect(a.open(legacy)?.slot).toBe('current');
    });

    it('while rotating, reads both formats under the previous key, and says so', () => {
      const legacy = legacyEncrypt('key-a', 'salt-a', 'old-secret');
      const envelope = a.encrypt('new-secret');
      expect(rotating.decrypt(legacy)).toBe('old-secret');
      expect(rotating.decrypt(envelope)).toBe('new-secret');
      expect(rotating.open(legacy)?.slot).toBe('previous');
      expect(rotating.open(envelope)?.slot).toBe('previous');
      expect(rotating.open(rotating.encrypt('x'))?.slot).toBe('current');
    });

    it('encrypts only with the current key', () => {
      const sealed = rotating.encrypt('x');
      expect(parseEnvelope(sealed)?.keyId).toBe(b.currentKeyId);
      expect(b.decrypt(sealed)).toBe('x');
      expect(() => a.decrypt(sealed)).toThrow(UnreadableSecretError);
    });

    it('after the previous key is removed, its values no longer open', () => {
      const legacy = legacyEncrypt('key-a', 'salt-a', 'old-secret');
      expect(() => b.decrypt(legacy)).toThrow();
      expect(() => b.decrypt(a.encrypt('x'))).toThrow(UnreadableSecretError);
    });

    it('encryptSecret keeps ciphertext under either key, and an unknown envelope', () => {
      const underA = a.encrypt('x');
      expect(rotating.encryptSecret(underA)).toBe(underA);
      expect(b.encryptSecret(underA)).toBe(underA);
      expect(b.decryptSecret('plain')).toBe('plain');
      expect(() => b.decryptSecret(underA)).toThrow(UnreadableSecretError);
      expect(rotating.decryptSecret(underA)).toBe('x');
    });

    it('tryOpen on the ring tells keys apart without trying both for envelopes', () => {
      const ring = keyRingFromEnv(BafterA);
      expect(tryOpen(ring, seal(ring, 'v'))).toEqual({
        plaintext: 'v',
        slot: 'current',
      });
      expect(tryOpen(ring, 'not ciphertext')).toBeUndefined();
    });
  });

  describe('hmac', () => {
    it('is unchanged by the key ring: HKDF of the scrypt-derived current key', () => {
      const key = scryptSync('key-b', 'salt-b', 32);
      const purposeKey = Buffer.from(
        hkdfSync('sha256', key, Buffer.alloc(0), 'idenplane:hmac:otp', 32),
      );
      const expected = createHmac('sha256', purposeKey)
        .update('123456', 'utf8')
        .digest('hex');
      expect(b.hmac('otp', '123456')).toBe(expected);
      // The previous key plays no part.
      expect(rotating.hmac('otp', '123456')).toBe(expected);
    });
  });
});
