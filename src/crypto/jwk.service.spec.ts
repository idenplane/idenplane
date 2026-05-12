import { JwkService } from './jwk.service.js';

describe('JwkService', () => {
  let service: JwkService;

  beforeEach(() => {
    service = new JwkService();
  });

  describe('generateRsaKeyPair', () => {
    it('should generate a key pair with kid, public and private keys', async () => {
      const keyPair = await service.generateRsaKeyPair();
      expect(keyPair.kid).toBeDefined();
      expect(keyPair.publicKeyPem).toContain('-----BEGIN PUBLIC KEY-----');
      expect(keyPair.privateKeyPem).toContain('-----BEGIN PRIVATE KEY-----');
    });
  });

  describe('signJwt / verifyJwt', () => {
    it('should sign and verify a JWT', async () => {
      const keyPair = await service.generateRsaKeyPair();
      const payload = { sub: 'user-1', iss: 'test' };

      const token = await service.signJwt(
        payload,
        keyPair.privateKeyPem,
        keyPair.kid,
        300,
      );

      expect(token).toBeDefined();
      expect(token.split('.')).toHaveLength(3);

      const verified = await service.verifyJwt(token, keyPair.publicKeyPem);
      expect(verified.sub).toBe('user-1');
      expect(verified.iss).toBe('test');
    });

    it('should reject a tampered token', async () => {
      const keyPair = await service.generateRsaKeyPair();
      const token = await service.signJwt(
        { sub: 'user-1' },
        keyPair.privateKeyPem,
        keyPair.kid,
        300,
      );

      const tampered = token.slice(0, -5) + 'xxxxx';
      await expect(
        service.verifyJwt(tampered, keyPair.publicKeyPem),
      ).rejects.toThrow();
    });

    it('should reject a token signed with a different key', async () => {
      const keyPair1 = await service.generateRsaKeyPair();
      const keyPair2 = await service.generateRsaKeyPair();

      const token = await service.signJwt(
        { sub: 'user-1' },
        keyPair1.privateKeyPem,
        keyPair1.kid,
        300,
      );

      await expect(
        service.verifyJwt(token, keyPair2.publicKeyPem),
      ).rejects.toThrow();
    });
  });

  describe('computeAtHash', () => {
    it('should return a base64url string', () => {
      const hash = service.computeAtHash('some-access-token');
      expect(hash).toBeDefined();
      expect(hash.length).toBeGreaterThan(0);
      // base64url: no +, /, or =
      expect(hash).not.toMatch(/[+/=]/);
    });

    it('should return consistent results', () => {
      const hash1 = service.computeAtHash('token-abc');
      const hash2 = service.computeAtHash('token-abc');
      expect(hash1).toBe(hash2);
    });

    it('should return different results for different tokens', () => {
      const hash1 = service.computeAtHash('token-abc');
      const hash2 = service.computeAtHash('token-xyz');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('publicKeyToJwk', () => {
    it('should return a JWK with correct properties', async () => {
      const keyPair = await service.generateRsaKeyPair();
      const jwk = await service.publicKeyToJwk(
        keyPair.publicKeyPem,
        keyPair.kid,
      );

      expect(jwk.kty).toBe('RSA');
      expect(jwk.kid).toBe(keyPair.kid);
      expect(jwk.alg).toBe('RS256');
      expect(jwk.use).toBe('sig');
      expect(jwk.n).toBeDefined();
      expect(jwk.e).toBeDefined();
    });
  });
});
