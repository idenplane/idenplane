import { randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import * as bcryptjs from 'bcryptjs';
import { CryptoService } from './crypto.service.js';
import { PasswordVerificationService } from './password-verification.service.js';
import {
  decodeBase64,
  encodePbkdf2,
  parseLegacyPbkdf2,
  parsePbkdf2,
  verifyBcrypt,
  verifyPbkdf2,
} from './password-hash-formats.js';
import { PASSWORD, WRONG, pbkdf2 } from './__mocks__/password-hash-fixtures.js';

describe('password hash formats', () => {
  describe('PBKDF2 (PHC form)', () => {
    it.each(['sha1', 'sha256', 'sha512'] as const)(
      '%s: round-trips, verifies the right password, refuses a wrong one',
      async (digest) => {
        const { salt, hash, iterations } = pbkdf2(digest);
        const stored = encodePbkdf2({ digest, iterations, salt, hash });
        expect(stored).toMatch(new RegExp(`^\\$pbkdf2-${digest}\\$i=1000,l=`));
        const parsed = parsePbkdf2(stored);
        expect(parsed).toMatchObject({ digest, iterations });
        await expect(verifyPbkdf2(PASSWORD, parsed!)).resolves.toBe(true);
        await expect(verifyPbkdf2(WRONG, parsed!)).resolves.toBe(false);
      },
    );

    it('a key derived with one digest does not verify as another', async () => {
      const { salt, hash, iterations } = pbkdf2('sha512');
      const asSha256 = { digest: 'sha256' as const, iterations, salt, hash };
      await expect(verifyPbkdf2(PASSWORD, asSha256)).resolves.toBe(false);
    });

    it('accepts padded base64 and no l= (Auth0 writes it that way)', () => {
      const { salt, hash } = pbkdf2('sha256');
      const stored = `$pbkdf2-sha256$i=1000$${salt.toString('base64')}$${hash.toString('base64')}`;
      expect(parsePbkdf2(stored)).toMatchObject({ iterations: 1000 });
    });

    it.each([
      [
        'an unknown digest',
        '$pbkdf2-md5$i=1000$c2FsdHNhbHQ$aGFzaGhhc2hoYXNoaGFzaA',
      ],
      ['no iterations', '$pbkdf2-sha256$$c2FsdHNhbHQ$aGFzaGhhc2hoYXNoaGFzaA'],
      [
        'zero iterations',
        '$pbkdf2-sha256$i=0$c2FsdHNhbHQ$aGFzaGhhc2hoYXNoaGFzaA',
      ],
      [
        'too many iterations',
        '$pbkdf2-sha256$i=999999999$c2FsdHNhbHQ$aGFzaGhhc2hoYXNoaGFzaA',
      ],
      [
        'a wrong l=',
        '$pbkdf2-sha256$i=1000,l=99$c2FsdHNhbHQ$aGFzaGhhc2hoYXNoaGFzaA',
      ],
      ['bad base64', '$pbkdf2-sha256$i=1000$c2Fsd*Nh$aGFzaGhhc2hoYXNoaGFzaA'],
      ['a too short key', '$pbkdf2-sha256$i=1000$c2FsdHNhbHQ$aGFzaA'],
      ['a missing part', '$pbkdf2-sha256$i=1000$aGFzaGhhc2hoYXNoaGFzaA'],
    ])('refuses %s', (_label, stored) => {
      expect(parsePbkdf2(stored)).toBeNull();
    });
  });

  describe('legacy PBKDF2 rows (importers before 0.11.0)', () => {
    it('iterations$salt$hash labelled pbkdf2-sha256 verifies SHA-256, and also the SHA-512 keys the old importer mislabelled', async () => {
      for (const digest of ['sha256', 'sha512', 'sha1'] as const) {
        const { salt, hash, iterations } = pbkdf2(digest);
        const stored = `${iterations}$${salt.toString('base64')}$${hash.toString('base64')}`;
        const candidates = parseLegacyPbkdf2(stored, 'pbkdf2-sha256');
        const results = await Promise.all(
          candidates.map((c) => verifyPbkdf2(PASSWORD, c)),
        );
        expect(results.filter(Boolean)).toHaveLength(1);
      }
    });

    it('salt:hash means 27 500 iterations', () => {
      const stored = `${randomBytes(16).toString('base64')}:${randomBytes(32).toString('base64')}`;
      expect(parseLegacyPbkdf2(stored, 'pbkdf2-sha256')[0]).toMatchObject({
        iterations: 27500,
        digest: 'sha256',
      });
    });

    it('needs a PBKDF2 label and a well-formed value', () => {
      const ok = `1000$${randomBytes(16).toString('base64')}$${randomBytes(32).toString('base64')}`;
      expect(parseLegacyPbkdf2(ok, 'argon2')).toEqual([]);
      expect(parseLegacyPbkdf2(ok, null)).toEqual([]);
      expect(parseLegacyPbkdf2('27500$not base64$x', 'pbkdf2-sha256')).toEqual(
        [],
      );
      expect(parseLegacyPbkdf2('a$b$c$d', 'pbkdf2-sha256')).toEqual([]);
      expect(
        parseLegacyPbkdf2(ok, 'pbkdf2-sha512').map((c) => c.digest),
      ).toEqual(['sha512']);
    });
  });

  describe('bcrypt', () => {
    const hash = bcryptjs.hashSync(PASSWORD, 4);

    it.each(['$2a$', '$2b$', '$2y$'])('%s verifies', async (prefix) => {
      const stored = prefix + hash.slice(4);
      await expect(verifyBcrypt(PASSWORD, stored)).resolves.toBe(true);
      await expect(verifyBcrypt(WRONG, stored)).resolves.toBe(false);
    });

    it.each([
      ['a truncated hash', hash.slice(0, 40)],
      ['an unknown version', '$2x$' + hash.slice(4)],
      ['a cost above the cap', '$2b$31$' + hash.slice(7)],
      ['garbage', 'not-a-hash'],
    ])('%s is false, not an exception', async (_label, stored) => {
      await expect(verifyBcrypt(PASSWORD, stored)).resolves.toBe(false);
    });
  });

  it('decodeBase64 is strict', () => {
    expect(decodeBase64('c2FsdA==')?.toString()).toBe('salt');
    expect(decodeBase64('c2FsdA')?.toString()).toBe('salt');
    expect(decodeBase64('c2F$dA==')).toBeNull();
    expect(decodeBase64('')).toBeNull();
    expect(decodeBase64('c')).toBeNull();
  });
});

describe('PasswordVerificationService', () => {
  const crypto = new CryptoService();
  let updateMany: jest.Mock;
  let service: PasswordVerificationService;

  beforeEach(() => {
    updateMany = jest.fn().mockResolvedValue({ count: 1 });
    service = new PasswordVerificationService(crypto, {
      user: { updateMany },
    } as never);
  });

  const user = (passwordHash: string | null, passwordAlgorithm = 'argon2') => ({
    id: 'user-1',
    passwordHash,
    passwordAlgorithm,
  });

  it('Argon2id written today: verifies, no upgrade', async () => {
    const stored = await crypto.hashPassword(PASSWORD);
    await expect(service.check(user(stored), PASSWORD)).resolves.toEqual({
      valid: true,
      scheme: 'argon2',
      needsUpgrade: false,
    });
    await expect(service.verifyUserPassword(user(stored), WRONG)).resolves.toBe(
      false,
    );
    await expect(
      service.verifyUserPassword(user(stored), PASSWORD),
    ).resolves.toBe(true);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('Argon2 with weaker parameters (a Keycloak or Authentik import) is upgraded', async () => {
    const stored = await argon2.hash(PASSWORD, {
      type: argon2.argon2id,
      memoryCost: 7168,
      timeCost: 5,
      parallelism: 1,
    });
    await expect(service.check(user(stored), PASSWORD)).resolves.toMatchObject({
      valid: true,
      needsUpgrade: true,
    });
    const argon2i = await argon2.hash(PASSWORD, { type: argon2.argon2i });
    await expect(service.check(user(argon2i), PASSWORD)).resolves.toMatchObject(
      {
        valid: true,
        needsUpgrade: true,
      },
    );
  });

  it.each([
    ['bcrypt', () => bcryptjs.hashSync(PASSWORD, 4), 'bcrypt', 'bcrypt'],
    [
      'PBKDF2-SHA1',
      () => encodePbkdf2({ digest: 'sha1', ...pbkdf2('sha1') }),
      'pbkdf2-sha1',
      'pbkdf2',
    ],
    [
      'PBKDF2-SHA256',
      () => encodePbkdf2({ digest: 'sha256', ...pbkdf2('sha256') }),
      'pbkdf2-sha256',
      'pbkdf2',
    ],
    [
      'PBKDF2-SHA512',
      () => encodePbkdf2({ digest: 'sha512', ...pbkdf2('sha512') }),
      'pbkdf2-sha512',
      'pbkdf2',
    ],
    [
      'legacy Keycloak row (SHA-512 labelled pbkdf2-sha256)',
      () => {
        const { salt, hash, iterations } = pbkdf2('sha512');
        return `${iterations}$${salt.toString('base64')}$${hash.toString('base64')}`;
      },
      'pbkdf2-sha256',
      'legacy-pbkdf2',
    ],
  ])(
    '%s: verifies, refuses a wrong password, upgrades to Argon2id on success',
    async (_label, make, algorithm, scheme) => {
      const stored = make();
      await expect(
        service.check(user(stored, algorithm), WRONG),
      ).resolves.toEqual({
        valid: false,
        scheme,
        needsUpgrade: false,
      });
      await expect(
        service.verifyUserPassword(user(stored, algorithm), WRONG),
      ).resolves.toBe(false);
      expect(updateMany).not.toHaveBeenCalled();

      await expect(
        service.verifyUserPassword(user(stored, algorithm), PASSWORD),
      ).resolves.toBe(true);
      expect(updateMany).toHaveBeenCalledTimes(1);
      const { where, data } = updateMany.mock.calls[0][0];
      // Conditional on the hash being unchanged: a concurrent password
      // change wins.
      expect(where).toEqual({ id: 'user-1', passwordHash: stored });
      expect(data.passwordAlgorithm).toBe('argon2');
      expect(data.passwordHash).toMatch(/^\$argon2id\$/);
      expect(Object.keys(data).sort()).toEqual([
        'passwordAlgorithm',
        'passwordHash',
      ]);
      await expect(argon2.verify(data.passwordHash, PASSWORD)).resolves.toBe(
        true,
      );
    },
  );

  it.each([
    ['null', null],
    ['empty', ''],
    ['a Keycloak value stored raw', '27500$c2FsdA==$aGFzaA=='],
    ['an Argon2 prefix with garbage', '$argon2id$garbage'],
    ['a truncated Argon2 hash', '$argon2id$v=19$m=65536,t=3,p=4$c2FsdHNhbHQ'],
    ['a bcrypt prefix with garbage', '$2b$10$garbage'],
    ['a PBKDF2 prefix with garbage', '$pbkdf2-sha256$i=1000$$'],
    ['plaintext', 'correct-horse-example-1'],
    ['a scheme nobody supports', '{SSHA}c2FsdA=='],
  ])(
    'a malformed hash (%s) is false, never an exception',
    async (_label, stored) => {
      await expect(
        service.check(user(stored, 'pbkdf2-sha256'), PASSWORD),
      ).resolves.toMatchObject({ valid: false });
      await expect(
        service.verifyUserPassword(user(stored, 'pbkdf2-sha256'), PASSWORD),
      ).resolves.toBe(false);
      expect(updateMany).not.toHaveBeenCalled();
    },
  );

  it('refuses a password over the length limit without hashing it', async () => {
    const stored = bcryptjs.hashSync(PASSWORD, 4);
    await expect(
      service.check(user(stored, 'bcrypt'), 'x'.repeat(1025)),
    ).resolves.toMatchObject({
      valid: false,
    });
  });

  it('a failed upgrade write does not fail the sign-in', async () => {
    updateMany.mockRejectedValueOnce(new Error('db down'));
    const stored = bcryptjs.hashSync(PASSWORD, 4);
    await expect(
      service.verifyUserPassword(user(stored, 'bcrypt'), PASSWORD),
    ).resolves.toBe(true);
  });

  describe('equalizeTiming (sign-in for a user that cannot be checked)', () => {
    it('runs one real Argon2 verification against a dummy hash made once per process', async () => {
      const hash = jest.spyOn(crypto, 'hashPassword');
      const verify = jest.spyOn(crypto, 'verifyPassword');
      try {
        await expect(service.equalizeTiming(PASSWORD)).resolves.toBeUndefined();
        await expect(service.equalizeTiming(WRONG)).resolves.toBeUndefined();
        expect(hash).toHaveBeenCalledTimes(1);
        expect(verify).toHaveBeenCalledTimes(2);
        const [dummy, presented] = verify.mock.calls[0];
        expect(dummy).toMatch(/^\$argon2id\$/);
        expect(presented).toBe(PASSWORD);
        // The dummy is a hash of a random secret, never of the password.
        await expect(crypto.verifyPassword(dummy, PASSWORD)).resolves.toBe(
          false,
        );
      } finally {
        hash.mockRestore();
        verify.mockRestore();
      }
    });

    it('caps the presented password at the length limit', async () => {
      const verify = jest.spyOn(crypto, 'verifyPassword');
      try {
        await service.equalizeTiming('x'.repeat(100_000));
        expect(verify.mock.calls[0][1].length).toBeLessThanOrEqual(1024);
      } finally {
        verify.mockRestore();
      }
    });

    it('never throws, and retries making the dummy hash after a failure', async () => {
      const hash = jest
        .spyOn(crypto, 'hashPassword')
        .mockRejectedValueOnce(new Error('argon2 unavailable'));
      try {
        await expect(service.equalizeTiming(PASSWORD)).resolves.toBeUndefined();
        await expect(service.equalizeTiming(PASSWORD)).resolves.toBeUndefined();
        expect(hash).toHaveBeenCalledTimes(2);
      } finally {
        hash.mockRestore();
      }
    });
  });
});

describe('CryptoService.verifyPassword', () => {
  const crypto = new CryptoService();

  it('returns false instead of throwing on a hash that is not Argon2', async () => {
    // argon2.verify throws "pchstr must contain a $ as first char" here.
    await expect(
      crypto.verifyPassword('27500$c2FsdA==$aGFzaA==', PASSWORD),
    ).resolves.toBe(false);
    await expect(
      crypto.verifyPassword('$argon2id$broken', PASSWORD),
    ).resolves.toBe(false);
  });
});
