import { pbkdf2Sync, randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import * as bcryptjs from 'bcryptjs';
import {
  auth0Password,
  authentikPassword,
  keycloakPassword,
} from './password-import.js';
import {
  parseLegacyPbkdf2,
  parsePbkdf2,
  verifyPbkdf2,
} from '../crypto/password-hash-formats.js';

// Test passwords only; never real credentials.
const PASSWORD = 'correct-horse-example-1';

function keycloakPbkdf2(
  digest: 'sha1' | 'sha256' | 'sha512',
  iterations = 1000,
) {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(PASSWORD, salt, iterations, 64, digest);
  return { salt: salt.toString('base64'), value: hash.toString('base64') };
}

async function verifies(stored: string | null): Promise<boolean> {
  const parsed = stored ? parsePbkdf2(stored) : null;
  return parsed ? verifyPbkdf2(PASSWORD, parsed) : false;
}

describe('keycloakPassword', () => {
  it.each([
    ['pbkdf2', 'sha1'],
    ['pbkdf2-sha256', 'sha256'],
    ['pbkdf2-sha512', 'sha512'],
  ] as const)(
    'current format (secretData/credentialData), %s',
    async (algorithm, digest) => {
      const { salt, value } = keycloakPbkdf2(digest);
      const imported = keycloakPassword([
        {
          type: 'password',
          secretData: JSON.stringify({ value, salt, additionalParameters: {} }),
          credentialData: JSON.stringify({
            hashIterations: 1000,
            algorithm,
            additionalParameters: {},
          }),
        },
      ]);
      expect(imported.algorithm).toBe(`pbkdf2-${digest}`);
      expect(imported.hash).toMatch(
        new RegExp(`^\\$pbkdf2-${digest}\\$i=1000,l=64\\$`),
      );
      expect(imported.warning).toBeUndefined();
      await expect(verifies(imported.hash)).resolves.toBe(true);
    },
  );

  it.each([
    ['pbkdf2-sha256', 'sha256'],
    ['pbkdf2-sha512', 'sha512'],
  ] as const)(
    'legacy format (hashedSaltedValue), %s',
    async (algorithm, digest) => {
      const { salt, value } = keycloakPbkdf2(digest);
      const imported = keycloakPassword([
        {
          type: 'password',
          hashedSaltedValue: value,
          salt,
          hashIterations: 1000,
          algorithm,
        },
      ]);
      expect(imported.algorithm).toBe(`pbkdf2-${digest}`);
      await expect(verifies(imported.hash)).resolves.toBe(true);
    },
  );

  it('a legacy credential without an algorithm keeps the form whose check tries each digest', async () => {
    const { salt, value } = keycloakPbkdf2('sha1');
    const imported = keycloakPassword([
      {
        type: 'password',
        hashedSaltedValue: value,
        salt,
        hashIterations: 1000,
      },
    ]);
    expect(imported.algorithm).toBe('pbkdf2-sha256');
    const candidates = parseLegacyPbkdf2(imported.hash!, imported.algorithm);
    const results = await Promise.all(
      candidates.map((c) => verifyPbkdf2(PASSWORD, c)),
    );
    expect(results).toContain(true);
  });

  it('Argon2 (the Keycloak 24+ default) becomes a PHC string', async () => {
    const salt = randomBytes(16);
    const raw = await argon2.hash(PASSWORD, {
      type: argon2.argon2id,
      raw: true,
      salt,
      memoryCost: 7168,
      timeCost: 5,
      parallelism: 1,
      hashLength: 32,
    });
    const imported = keycloakPassword([
      {
        type: 'password',
        secretData: JSON.stringify({
          value: raw.toString('base64'),
          salt: salt.toString('base64'),
        }),
        credentialData: JSON.stringify({
          hashIterations: 5,
          algorithm: 'argon2',
          additionalParameters: {
            hashLength: ['32'],
            memory: ['7168'],
            type: ['id'],
            version: ['1.3'],
            parallelism: ['1'],
          },
        }),
      },
    ]);
    expect(imported.algorithm).toBe('argon2');
    expect(imported.hash).toMatch(/^\$argon2id\$v=19\$m=7168,t=5,p=1\$/);
    await expect(argon2.verify(imported.hash!, PASSWORD)).resolves.toBe(true);
  });

  it('a plaintext value is passed on to be hashed', () => {
    expect(
      keycloakPassword([
        { type: 'password', value: PASSWORD, temporary: false },
      ]),
    ).toEqual({ hash: null, algorithm: 'argon2', plaintext: PASSWORD });
  });

  it.each([
    [
      'an unsupported algorithm',
      {
        secretData: JSON.stringify({ value: 'aGFzaA==', salt: 'c2FsdA==' }),
        credentialData: JSON.stringify({ hashIterations: 1, algorithm: 'md5' }),
      },
      /algorithm "md5" is not supported/,
    ],
    [
      'unreadable JSON',
      { secretData: '{not json', credentialData: '{}' },
      /not readable JSON/,
    ],
    [
      'a missing salt',
      {
        secretData: JSON.stringify({
          value: randomBytes(64).toString('base64'),
        }),
        credentialData: JSON.stringify({
          hashIterations: 1000,
          algorithm: 'pbkdf2-sha512',
        }),
      },
      /malformed/,
    ],
    [
      'absurd iterations',
      {
        secretData: JSON.stringify({
          value: randomBytes(64).toString('base64'),
          salt: 'c2FsdA==',
        }),
        credentialData: JSON.stringify({
          hashIterations: 1e12,
          algorithm: 'pbkdf2-sha256',
        }),
      },
      /malformed/,
    ],
  ])(
    '%s: no password and a warning, never a wrong label',
    (_label, cred, warning) => {
      const imported = keycloakPassword([{ type: 'password', ...cred }]);
      expect(imported.hash).toBeNull();
      expect(imported.algorithm).toBe('argon2');
      expect(imported.warning).toMatch(warning);
      expect(imported.warning).toMatch(/must reset it/);
    },
  );

  it('no password credential means no password, no warning', () => {
    expect(keycloakPassword(undefined)).toEqual({
      hash: null,
      algorithm: 'argon2',
    });
    expect(keycloakPassword([{ type: 'otp', value: 'x' }])).toEqual({
      hash: null,
      algorithm: 'argon2',
    });
  });
});

describe('auth0Password', () => {
  const bcrypt = bcryptjs.hashSync(PASSWORD, 4);

  it('password_hash (bcrypt) is kept', () => {
    expect(auth0Password({ password_hash: bcrypt })).toEqual({
      hash: bcrypt,
      algorithm: 'bcrypt',
    });
  });

  it('a custom PBKDF2 hash (PHC string) records its digest', async () => {
    const salt = randomBytes(16);
    const hash = pbkdf2Sync(PASSWORD, salt, 1000, 64, 'sha512');
    const value = `$pbkdf2-sha512$i=1000,l=64$${salt.toString('base64').replace(/=+$/, '')}$${hash.toString('base64').replace(/=+$/, '')}`;
    const imported = auth0Password({
      custom_password_hash: {
        algorithm: 'pbkdf2',
        hash: { value, encoding: 'utf8' },
      },
    });
    expect(imported.algorithm).toBe('pbkdf2-sha512');
    await expect(verifies(imported.hash)).resolves.toBe(true);
  });

  it('a custom Argon2 hash is kept', async () => {
    const value = await argon2.hash(PASSWORD, { type: argon2.argon2id });
    expect(
      auth0Password({
        custom_password_hash: {
          algorithm: 'argon2',
          hash: { value, encoding: 'utf8' },
        },
      }),
    ).toEqual({ hash: value, algorithm: 'argon2' });
  });

  it.each([
    [{ password_hash: 'not-bcrypt' }, /not a bcrypt hash/],
    [
      {
        custom_password_hash: {
          algorithm: 'md5',
          hash: { value: 'x', encoding: 'hex' },
        },
      },
      /"md5" is not supported/,
    ],
    [
      {
        custom_password_hash: {
          algorithm: 'pbkdf2',
          hash: { value: '$pbkdf2-md5$i=1$a$b', encoding: 'utf8' },
        },
      },
      /malformed/,
    ],
  ])('%j: no password and a warning', (user, warning) => {
    const imported = auth0Password(user);
    expect(imported.hash).toBeNull();
    expect(imported.warning).toMatch(warning);
  });
});

describe('authentikPassword', () => {
  it.each(['sha256', 'sha1'] as const)('Django pbkdf2_%s', async (digest) => {
    const salt = 'example-salt-1';
    const hash = pbkdf2Sync(
      PASSWORD,
      salt,
      1000,
      digest === 'sha1' ? 20 : 32,
      digest,
    );
    const imported = authentikPassword(
      `pbkdf2_${digest}$1000$${salt}$${hash.toString('base64')}`,
    );
    expect(imported.algorithm).toBe(`pbkdf2-${digest}`);
    await expect(verifies(imported.hash)).resolves.toBe(true);
  });

  it('Django bcrypt_sha256 is dropped with a warning, not stored as bcrypt', () => {
    const imported = authentikPassword(
      'bcrypt_sha256$$2b$12$' + 'a'.repeat(53),
    );
    expect(imported.hash).toBeNull();
    expect(imported.warning).toMatch(/"bcrypt_sha256" is not supported/);
  });

  it('Django bcrypt is carried over without its prefix and verifies', async () => {
    const bcrypt = await bcryptjs.hash(PASSWORD, 4);
    const imported = authentikPassword('bcrypt$' + bcrypt);
    expect(imported).toEqual({ hash: bcrypt, algorithm: 'bcrypt' });
    await expect(bcryptjs.compare(PASSWORD, imported.hash!)).resolves.toBe(
      true,
    );
  });

  it('a malformed Django bcrypt hash is dropped with a warning', () => {
    const imported = authentikPassword('bcrypt$not-a-bcrypt-hash');
    expect(imported.hash).toBeNull();
    expect(imported.warning).toMatch(/bcrypt password hash is malformed/);
  });

  it("Django's unusable-password marker becomes no password, explained", () => {
    const imported = authentikPassword('!' + 'x'.repeat(40));
    expect(imported.hash).toBeNull();
    expect(imported.warning).toMatch(/no usable password/);
    expect(imported.warning).not.toContain('x'.repeat(40));
  });
});
