jest.mock('../crypto/jwk.service.js', () => ({ JwkService: jest.fn() }));

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BootstrapFileError,
  parseBootstrapFile,
  readBootstrapFile,
  type ParseOptions,
} from './bootstrap-file.js';

const CLIENT_SECRET = 'dummy-client-secret-0123456789abcdef';
const USER_PASSWORD = 'dummy-initial-password';

const options = (env: Record<string, string> = {}): ParseOptions => ({
  env,
  isSecretHash: (v) => v.startsWith('$argon2'),
});

const realmDoc = (overrides: Record<string, unknown> = {}) => ({
  version: 2,
  realm: { name: 'acme', displayName: 'Acme' },
  ...overrides,
});

const parse = (doc: unknown, env?: Record<string, string>) =>
  parseBootstrapFile(JSON.stringify(doc), options(env));

/** The problems a bad file reports. */
function problemsOf(doc: unknown, env?: Record<string, string>) {
  try {
    parse(doc, env);
  } catch (err) {
    expect(err).toBeInstanceOf(BootstrapFileError);
    return (err as BootstrapFileError).problems;
  }
  throw new Error('expected the file to be refused');
}

describe('parseBootstrapFile', () => {
  it('accepts a file with no realms (it only closes the wizard)', () => {
    expect(parse({ version: 1 })).toEqual({ realms: [] });
    expect(parse({ version: 1, realms: [] })).toEqual({ realms: [] });
  });

  it('returns each realm as an import document', () => {
    const plan = parse({ version: 1, realms: [realmDoc()] });
    expect(plan.realms).toHaveLength(1);
    expect(plan.realms[0]).toMatchObject({
      name: 'acme',
      displayName: 'Acme',
      document: { version: 2, realm: { name: 'acme' }, secretsIncluded: true },
    });
  });

  it('refuses unknown keys, a wrong version and a non-array realms', () => {
    expect(problemsOf({ version: 2, realms: {}, extra: 1 })).toEqual(
      expect.arrayContaining([
        { path: 'extra', message: 'is not a known key' },
        { path: 'version', message: 'must be 1' },
        { path: 'realms', message: 'must be an array' },
      ]),
    );
  });

  it('refuses invalid JSON without quoting the content', () => {
    const secret = 'dummy-secret-that-must-not-leak';
    let message = '';
    try {
      parseBootstrapFile(`{"version": 1, ${secret}}`, options());
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/not valid JSON/);
    expect(message).not.toContain(secret);
  });

  it.each(['master', 'public'])(
    'refuses the reserved realm name %s',
    (name) => {
      expect(
        problemsOf({ version: 1, realms: [realmDoc({ realm: { name } })] }),
      ).toEqual([expect.objectContaining({ path: 'realms[0].realm.name' })]);
    },
  );

  it('refuses a realm declared twice, a missing name and a wrong version', () => {
    const problems = problemsOf({
      version: 1,
      realms: [
        realmDoc(),
        realmDoc(),
        realmDoc({ version: 1, realm: { displayName: 'x' } }),
      ],
    });
    expect(problems.map((p) => p.path)).toEqual([
      'realms[1].realm.name',
      'realms[2].version',
      'realms[2].realm.name',
    ]);
  });

  describe('${env:NAME}', () => {
    it('is replaced with the environment variable, in nested strings', () => {
      const plan = parse(
        {
          version: 1,
          realms: [
            realmDoc({
              realm: {
                name: 'acme',
                smtpHost: 'smtp.example.com',
                smtpPassword: '${env:SMTP_PASSWORD}',
              },
              clients: [
                { clientId: 'app', clientSecret: 'x-${env:CLIENT_SECRET}' },
              ],
            }),
          ],
        },
        { SMTP_PASSWORD: 'dummy-smtp', CLIENT_SECRET },
      );
      const doc = plan.realms[0].document as {
        realm: Record<string, unknown>;
        clients: Array<Record<string, unknown>>;
      };
      expect(doc.realm['smtpPassword']).toBe('dummy-smtp');
      expect(doc.clients[0]['clientSecret']).toBe(`x-${CLIENT_SECRET}`);
    });

    it('keeps $${env:NAME} as the literal text', () => {
      const plan = parse({
        version: 1,
        realms: [
          realmDoc({ realm: { name: 'acme', displayName: '$${env:HOME}' } }),
        ],
      });
      expect(plan.realms[0].displayName).toBe('${env:HOME}');
    });

    it('refuses a variable that is not set, or empty, naming the path', () => {
      const problems = problemsOf(
        {
          version: 1,
          realms: [
            realmDoc({
              realm: { name: 'acme', smtpPassword: '${env:MISSING}' },
              clients: [{ clientId: 'app', clientSecret: '${env:EMPTY}' }],
            }),
          ],
        },
        { EMPTY: '' },
      );
      expect(problems).toEqual([
        {
          path: 'realms[0].realm.smtpPassword',
          message: '${env:MISSING} is not set',
        },
        {
          path: 'realms[0].clients[0].clientSecret',
          message: '${env:EMPTY} is not set',
        },
      ]);
    });

    it.each(['ADMIN_API_KEY', 'WEBHOOK_SECRET_KEY', 'DATABASE_URL'])(
      'refuses the server secret %s',
      (name) => {
        const problems = problemsOf(
          {
            version: 1,
            realms: [
              realmDoc({
                realm: { name: 'acme', displayName: `\${env:${name}}` },
              }),
            ],
          },
          { [name]: 'dummy-value' },
        );
        expect(problems[0].message).toMatch(/server secret/);
      },
    );

    it('never puts a value in a message', () => {
      try {
        parse(
          {
            version: 1,
            realms: [
              realmDoc({
                realm: { name: 'acme', smtpPassword: '${env:SMTP_PASSWORD}' },
                clients: [{ clientId: 'app', clientSecret: '${env:SHORT}' }],
              }),
            ],
          },
          { SMTP_PASSWORD: 'dummy-smtp-value', SHORT: 'dummy-short' },
        );
      } catch (err) {
        expect((err as Error).message).not.toContain('dummy-short');
        expect((err as Error).message).not.toContain('dummy-smtp-value');
        return;
      }
      throw new Error('expected the short client secret to be refused');
    });
  });

  describe('users[].initialPassword', () => {
    it('is taken out of the import document and returned by username', () => {
      const plan = parse({
        version: 1,
        realms: [
          realmDoc({
            users: [
              {
                username: 'owner',
                email: 'owner@example.com',
                initialPassword: USER_PASSWORD,
              },
              { username: 'other' },
            ],
          }),
        ],
      });
      const realm = plan.realms[0];
      expect(realm.document['users']).toEqual([
        { username: 'owner', email: 'owner@example.com' },
        { username: 'other' },
      ]);
      expect([...realm.initialPasswords]).toEqual([['owner', USER_PASSWORD]]);
    });

    it.each([
      ['too short', 'Sh0rt-pw'],
      ['a known default', 'CHANGE_THIS_PASSWORD'],
      ['not a string', 12345678901234],
    ])('is refused when %s', (_label, initialPassword) => {
      const problems = problemsOf({
        version: 1,
        realms: [realmDoc({ users: [{ username: 'owner', initialPassword }] })],
      });
      expect(problems).toEqual([
        expect.objectContaining({ path: 'realms[0].users[0].initialPassword' }),
      ]);
    });
  });

  describe('client secrets', () => {
    const withClient = (client: Record<string, unknown>) => ({
      version: 1,
      realms: [realmDoc({ clients: [{ clientId: 'app', ...client }] })],
    });

    it('requires one for a confidential client that authenticates with it', () => {
      expect(problemsOf(withClient({}))).toEqual([
        expect.objectContaining({ path: 'realms[0].clients[0].clientSecret' }),
      ]);
      expect(
        problemsOf(
          withClient({ tokenEndpointAuthMethod: 'client_secret_post' }),
        ),
      ).toHaveLength(1);
    });

    it('does not require one for a public client or private_key_jwt', () => {
      expect(() => parse(withClient({ clientType: 'PUBLIC' }))).not.toThrow();
      expect(() =>
        parse(withClient({ tokenEndpointAuthMethod: 'private_key_jwt' })),
      ).not.toThrow();
    });

    it('refuses a short or default secret, and keeps a stored hash', () => {
      expect(
        problemsOf(withClient({ clientSecret: 'dummy-short' })),
      ).toHaveLength(1);
      expect(problemsOf(withClient({ clientSecret: 'changeme' }))).toHaveLength(
        1,
      );
      expect(() =>
        parse(withClient({ clientSecret: CLIENT_SECRET })),
      ).not.toThrow();
      expect(() =>
        parse(withClient({ clientSecret: '$argon2id$v=19$dummy' })),
      ).not.toThrow();
    });
  });
});

describe('readBootstrapFile', () => {
  it('reads the file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bootstrap-'));
    const file = join(dir, 'bootstrap.json');
    writeFileSync(file, '{"version":1}');
    expect(readBootstrapFile(file)).toBe('{"version":1}');
  });

  it('fails with the path and the error code', () => {
    expect(() => readBootstrapFile('/nonexistent/bootstrap.json')).toThrow(
      /cannot be read \(ENOENT\)/,
    );
  });
});
