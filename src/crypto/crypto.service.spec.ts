import * as argon2 from 'argon2';
import { CryptoService } from './crypto.service.js';

// argon2's native bindings export non-configurable properties, so
// jest.spyOn (which redefines the property) can't wrap them directly.
// Mocking the module and wrapping each export in jest.fn(actual) keeps the
// real implementation as the default behavior (so the round-trip tests
// below are unaffected) while letting specific tests override return
// values with mockReturnValueOnce.
jest.mock('argon2', () => {
  const actual = jest.requireActual('argon2') as typeof argon2;
  return {
    ...actual,
    hash: jest.fn(actual.hash),
    verify: jest.fn(actual.verify),
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('CryptoService', () => {
  let service: CryptoService;

  beforeEach(() => {
    service = new CryptoService();
  });

  describe('hashPassword / verifyPassword', () => {
    it('should hash and verify a password correctly', async () => {
      const hash = await service.hashPassword('password123');
      expect(hash).toBeDefined();
      expect(hash).not.toBe('password123');

      const valid = await service.verifyPassword(hash, 'password123');
      expect(valid).toBe(true);
    });

    it('should reject an incorrect password', async () => {
      const hash = await service.hashPassword('password123');
      const valid = await service.verifyPassword(hash, 'wrongpassword');
      expect(valid).toBe(false);
    });

    it('should produce different hashes for the same password', async () => {
      const hash1 = await service.hashPassword('password123');
      const hash2 = await service.hashPassword('password123');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('generateSecret', () => {
    it('should generate a hex string of the expected length', () => {
      const secret = service.generateSecret(16);
      expect(secret).toHaveLength(32); // 16 bytes = 32 hex chars
    });

    it('should default to 32 bytes', () => {
      const secret = service.generateSecret();
      expect(secret).toHaveLength(64); // 32 bytes = 64 hex chars
    });

    it('should generate unique values', () => {
      const a = service.generateSecret();
      const b = service.generateSecret();
      expect(a).not.toBe(b);
    });
  });

  describe('sha256', () => {
    it('should return consistent hash for the same input', () => {
      const hash1 = service.sha256('test');
      const hash2 = service.sha256('test');
      expect(hash1).toBe(hash2);
    });

    it('should return different hashes for different inputs', () => {
      const hash1 = service.sha256('test1');
      const hash2 = service.sha256('test2');
      expect(hash1).not.toBe(hash2);
    });

    it('should return a 64-character hex string', () => {
      const hash = service.sha256('test');
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[0-9a-f]+$/);
    });
  });

  describe('encrypt / decrypt', () => {
    it('should round-trip a plaintext value', () => {
      const plaintext = 'my-webhook-secret';
      const ciphertext = service.encrypt(plaintext);
      expect(service.decrypt(ciphertext)).toBe(plaintext);
    });

    it('should not store the plaintext in the ciphertext', () => {
      const plaintext = 'my-webhook-secret';
      const ciphertext = service.encrypt(plaintext);
      expect(ciphertext).not.toContain(plaintext);
    });

    it('should produce different ciphertext on each call (random IV)', () => {
      const plaintext = 'same-value';
      const c1 = service.encrypt(plaintext);
      const c2 = service.encrypt(plaintext);
      expect(c1).not.toBe(c2);
    });

    it('should throw when ciphertext is tampered with', () => {
      const ciphertext = service.encrypt('secret');
      // Flip a byte in the ciphertext (after the IV+tag header)
      const buf = Buffer.from(ciphertext, 'base64');
      buf[buf.length - 1] ^= 0xff;
      const tampered = buf.toString('base64');
      expect(() => service.decrypt(tampered)).toThrow();
    });

    it('should handle unicode and long secrets', () => {
      const plaintext = 'unicode-🔑-secret-' + 'x'.repeat(256);
      const ciphertext = service.encrypt(plaintext);
      expect(service.decrypt(ciphertext)).toBe(plaintext);
    });
  });

  describe('encryptSecret / decryptSecret', () => {
    it('should encrypt a plaintext value and decrypt it back', () => {
      const encrypted = service.encryptSecret('smtp-password-123');
      expect(encrypted).not.toBe('smtp-password-123');
      expect(service.decryptSecret(encrypted)).toBe('smtp-password-123');
    });

    it('should not re-encrypt a value that is already an encrypted envelope', () => {
      const once = service.encryptSecret('smtp-password-123');
      const twice = service.encryptSecret(once);
      expect(twice).toBe(once);
      expect(service.decryptSecret(twice)).toBe('smtp-password-123');
    });

    it('should treat pre-existing legacy plaintext as already-decrypted on read', () => {
      const legacyPlaintext = 'plaintext-password-from-before-this-fix';
      expect(service.decryptSecret(legacyPlaintext)).toBe(legacyPlaintext);
    });

    it('should pass through null, undefined, and empty string unchanged', () => {
      expect(service.encryptSecret(null)).toBeNull();
      expect(service.encryptSecret(undefined)).toBeUndefined();
      expect(service.encryptSecret('')).toBe('');
      expect(service.decryptSecret(null)).toBeNull();
      expect(service.decryptSecret(undefined)).toBeUndefined();
      expect(service.decryptSecret('')).toBe('');
    });
  });

  describe('Argon2 concurrency limiting', () => {
    const originalEnv = process.env['ARGON2_MAX_CONCURRENCY'];
    const hashMock = argon2.hash as jest.MockedFunction<typeof argon2.hash>;
    const verifyMock = argon2.verify as jest.MockedFunction<
      typeof argon2.verify
    >;

    beforeEach(() => {
      hashMock.mockClear();
      verifyMock.mockClear();
    });

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env['ARGON2_MAX_CONCURRENCY'];
      } else {
        process.env['ARGON2_MAX_CONCURRENCY'] = originalEnv;
      }
    });

    it('should queue a second hashPassword call until the first completes when concurrency is 1', async () => {
      process.env['ARGON2_MAX_CONCURRENCY'] = '1';
      const limitedService = new CryptoService();

      const first = deferred<string>();
      const second = deferred<string>();
      hashMock
        .mockReturnValueOnce(first.promise as Promise<string>)
        .mockReturnValueOnce(second.promise as Promise<string>);

      const call1 = limitedService.hashPassword('password-one');
      const call2 = limitedService.hashPassword('password-two');

      // Only the first call should have reached argon2.hash so far — the
      // second is queued behind the concurrency-1 limit.
      await Promise.resolve();
      await Promise.resolve();
      expect(hashMock).toHaveBeenCalledTimes(1);

      first.resolve('hash-one');
      await call1;

      // Releasing the first call lets the queued second call through.
      await Promise.resolve();
      await Promise.resolve();
      expect(hashMock).toHaveBeenCalledTimes(2);

      second.resolve('hash-two');
      expect(await call2).toBe('hash-two');
    });

    it('should route verifyPassword through the same concurrency limiter', async () => {
      process.env['ARGON2_MAX_CONCURRENCY'] = '1';
      const limitedService = new CryptoService();

      const first = deferred<boolean>();
      const second = deferred<boolean>();
      verifyMock
        .mockReturnValueOnce(first.promise as Promise<boolean>)
        .mockReturnValueOnce(second.promise as Promise<boolean>);

      const call1 = limitedService.verifyPassword('hash-one', 'password-one');
      const call2 = limitedService.verifyPassword('hash-two', 'password-two');

      await Promise.resolve();
      await Promise.resolve();
      expect(verifyMock).toHaveBeenCalledTimes(1);

      first.resolve(true);
      await call1;

      await Promise.resolve();
      await Promise.resolve();
      expect(verifyMock).toHaveBeenCalledTimes(2);

      second.resolve(false);
      expect(await call2).toBe(false);
    });
  });
});
