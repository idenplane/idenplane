/**
 * Fitness test for RFC 8705 §3: every place the server verifies a JWT either
 * enforces certificate binding or says, at the call site, why it need not.
 *
 * Each `verifyJwt(` / `jwtVerify(` call in `src/` must sit directly under a
 * comment line
 *
 *   // cert-binding: enforced
 *   // cert-binding: exempt: <reason>
 *
 * An `enforced` call must be followed by `assertCertificateBinding(` in the
 * same function, and every call site is pinned in {@link EXPECTED} so that a
 * new one, enforced or exempt, is a reviewed change to this file.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC = join(__dirname, '..');

/** Per file, the classification of each call site, in source order. */
const EXPECTED: Record<string, readonly ('enforced' | 'exempt')[]> = {
  // UserInfo enforces; introspection reports cnf (RFC 8705 §3.2); revocation
  // and the ID-token / logout-token checks grant no access.
  'tokens/tokens.service.ts': [
    'exempt', // introspect
    'exempt', // assertTokenBelongsToClient (revocation)
    'exempt', // revoke
    'exempt', // logoutByIdToken (ID token)
    'exempt', // validatePostLogoutRedirectUri (ID token)
    'enforced', // userinfo
    'exempt', // handleBackchannelLogout (logout token)
  ],
  'admin-auth/admin-auth.service.ts': ['enforced'], // validateAdminToken
  'realtime/session-events.gateway.ts': ['enforced'], // WebSocket upgrade
  'broker/broker.service.ts': ['exempt'], // broker state JWT
  'crypto/jwk.service.ts': ['exempt'], // the verifyJwt helper itself
};

const CALL = /\b(?:verifyJwt|jwtVerify)\s*\(/;
const DEFINITION = /\basync\s+verifyJwt\s*\(/;
const MARKER = /^\s*\/\/ cert-binding: (enforced|exempt:(.*))$/;
/** How far below an enforced call its assertCertificateBinding may be. */
const ENFORCE_WITHIN_LINES = 25;

interface CallSite {
  file: string;
  line: number;
  kind: 'enforced' | 'exempt' | 'unmarked';
  reason?: string;
  enforces: boolean;
}

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__mocks__' || entry.name === 'node_modules') continue;
      files.push(...sourceFiles(path));
    } else if (
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.spec.ts') &&
      !entry.name.endsWith('.d.ts')
    ) {
      files.push(path);
    }
  }
  return files;
}

/** The JWT verification call sites of one file's text. */
export function callSites(file: string, text: string): CallSite[] {
  const lines = text.split(/\r?\n/);
  const sites: CallSite[] = [];
  lines.forEach((line, index) => {
    const code = line.replace(/\/\/.*$/, '');
    if (!CALL.test(code) || DEFINITION.test(code)) return;
    // The comment block directly above the call.
    let marker: RegExpExecArray | null = null;
    for (let i = index - 1; i >= 0 && /^\s*\/\//.test(lines[i]); i--) {
      marker = MARKER.exec(lines[i]) ?? marker;
    }
    // The lines after the call, up to the next call site.
    const window = lines.slice(index + 1, index + 1 + ENFORCE_WITHIN_LINES);
    const next = window.findIndex((l) => CALL.test(l.replace(/\/\/.*$/, '')));
    const following = (next === -1 ? window : window.slice(0, next)).join('\n');
    sites.push({
      file,
      line: index + 1,
      kind: !marker
        ? 'unmarked'
        : marker[1] === 'enforced'
          ? 'enforced'
          : 'exempt',
      reason: marker?.[2]?.trim(),
      enforces: /\bassertCertificateBinding\s*\(/.test(following),
    });
  });
  return sites;
}

describe('certificate binding fitness (RFC 8705 §3)', () => {
  const sites = sourceFiles(SRC).flatMap((path) =>
    callSites(
      relative(SRC, path).split(sep).join('/'),
      readFileSync(path, 'utf8'),
    ),
  );

  it('finds the JWT verification call sites', () => {
    expect(sites.length).toBeGreaterThanOrEqual(10);
  });

  it('marks every call site as enforced or exempt with a reason', () => {
    const unmarked = sites
      .filter(
        (s) =>
          s.kind === 'unmarked' ||
          (s.kind === 'exempt' && (s.reason ?? '').length < 10),
      )
      .map((s) => `${s.file}:${s.line}`);
    expect(unmarked).toEqual([]);
  });

  it('calls assertCertificateBinding after every enforced call site', () => {
    const missing = sites
      .filter((s) => s.kind === 'enforced' && !s.enforces)
      .map((s) => `${s.file}:${s.line}`);
    expect(missing).toEqual([]);
  });

  it('pins every call site (a new one must be classified here)', () => {
    const actual: Record<string, string[]> = {};
    for (const site of sites) (actual[site.file] ??= []).push(site.kind);
    expect(actual).toEqual(EXPECTED);
  });

  describe('the scanner', () => {
    it('reports unmarked, exempt and enforced calls', () => {
      const found = callSites(
        'x.ts',
        [
          'const a = await this.jwkService.verifyJwt(t, k);',
          '// cert-binding: exempt: an ID token is never bound',
          'const b = await jwk.verifyJwt(t, k);',
          '// some context',
          '// cert-binding: enforced',
          'const c = await jwtVerify(t, k);',
          'assertCertificateBinding(c, cert);',
          'async verifyJwt(token: string) {}',
          '// verifyJwt(token) in a comment',
        ].join('\n'),
      );
      expect(found.map((s) => [s.kind, s.enforces])).toEqual([
        ['unmarked', false],
        ['exempt', false],
        ['enforced', true],
      ]);
      expect(found[1].reason).toBe('an ID token is never bound');
    });
  });
});
