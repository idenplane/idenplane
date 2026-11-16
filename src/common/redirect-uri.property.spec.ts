import fc from 'fast-check';
import { matchesRedirectUri } from './redirect-uri.utils';

/**
 * Property-based tests for redirect URI matching. A wrong "match" here sends
 * an authorization code to whoever controls the redirect URI.
 *
 * Since 0.11.0 the rule is exact string matching (RFC 9700 §2.1), with one
 * exception: the port of a loopback IP redirect URI (RFC 8252 §7.3). The old
 * `/*` wildcard only applies with the per-client opt-in, and must even then
 * never leave the registered origin or path.
 */

const scheme = fc.constantFrom('https', 'http');
const port = fc.option(fc.integer({ min: 1, max: 65535 }), { nil: undefined });
const path = fc.webPath();
const exactUrl = fc.webUrl({ withQueryParameters: true, withFragments: false });

/** A registered redirect URI: exact, or a `/*` wildcard under a base path. */
const registered = fc
  .record({ scheme, host: fc.domain(), port, path, wildcard: fc.boolean() })
  .map(({ scheme: s, host, port: p, path: rest, wildcard }) => {
    const base = `${s}://${host}${p === undefined ? '' : `:${p}`}${rest}`;
    return wildcard ? `${base.replace(/\/$/, '')}/*` : base;
  });

/** The origin a registered entry stands for (its wildcard removed). */
const originOf = (pattern: string) =>
  new URL(pattern.endsWith('/*') ? pattern.slice(0, -1) : pattern).origin;

/** The origin of a candidate, or null when no URL parser would accept it. */
function originOrNull(uri: string): string | null {
  try {
    return new URL(uri).origin;
  } catch {
    return null;
  }
}

/**
 * Candidates built to look like a registered URI: the registered text,
 * then a character that might end the host early or extend it (`.`, `@`,
 * `:`, `\`, an encoded slash...), then anything.
 */
const lookalike = (pattern: string) => {
  const base = pattern.endsWith('/*') ? pattern.slice(0, -2) : pattern;
  const host = new URL(base).host;
  const prefix = base.slice(0, base.indexOf(host) + host.length);
  return fc
    .tuple(
      fc.constantFrom(
        '.',
        '@',
        ':',
        '\\',
        '%2F',
        '%2f',
        '%40',
        '#',
        '?',
        '-',
        '_',
        '.evil.example',
        '@evil.example',
        ':443@evil.example',
        '',
      ),
      fc.oneof(fc.webPath(), fc.domain(), fc.string({ maxLength: 20 })),
    )
    .map(([joint, tail]) => `${prefix}${joint}${tail}`);
};

/** Candidates that extend a registered entry, to tempt a prefix match. */
const extension = (pattern: string) => {
  const base = pattern.endsWith('/*') ? pattern.slice(0, -1) : pattern;
  return fc
    .tuple(
      fc.constantFrom(
        '',
        '/',
        '/..',
        '/../',
        '/./',
        '/%2e%2e/',
        '/%2E%2E%2F',
        '%2f..%2f',
        '\\..\\',
        '?',
        '?x=1',
        '#',
        '#frag',
        'x',
      ),
      fc.oneof(fc.webPath(), fc.string({ maxLength: 20 })),
    )
    .map(([joint, tail]) => `${base}${joint}${tail}`);
};

const candidate = (pattern: string) =>
  fc.oneof(
    fc.webUrl({ withQueryParameters: true, withFragments: true }),
    lookalike(pattern),
    extension(pattern),
    fc.string({ maxLength: 60 }),
  );

const loopbackHost = fc.constantFrom('127.0.0.1', '[::1]');
const loopbackPort = fc.integer({ min: 1, max: 65535 });

describe('matchesRedirectUri (property-based)', () => {
  it('always accepts a URI that is registered exactly', () => {
    fc.assert(
      fc.property(
        exactUrl,
        fc.array(registered, { maxLength: 5 }),
        fc.nat(),
        fc.boolean(),
        (uri, others, at, allowWildcard) => {
          const list = [...others];
          list.splice(at % (list.length + 1), 0, uri);
          expect(matchesRedirectUri(uri, list, { allowWildcard })).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('accepts nothing when nothing is registered', () => {
    fc.assert(
      fc.property(fc.string(), fc.boolean(), (uri, allowWildcard) => {
        expect(matchesRedirectUri(uri, [], { allowWildcard })).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('without the opt-in, accepts only a registered string (no loopback here)', () => {
    fc.assert(
      fc.property(
        registered.chain((pattern) =>
          candidate(pattern).map((uri) => ({ pattern, uri })),
        ),
        ({ pattern, uri }) => {
          // fc.domain() never yields a loopback IP literal, so the port
          // exception cannot apply: only the registered string itself (with
          // no fragment) is accepted.
          expect(matchesRedirectUri(uri, [pattern])).toBe(
            uri === pattern && !uri.includes('#'),
          );
        },
      ),
      { numRuns: 1000 },
    );
  });

  it('never accepts a URI with a fragment, even with the opt-in', () => {
    fc.assert(
      fc.property(registered, fc.string({ maxLength: 20 }), (pattern, frag) => {
        const base = pattern.endsWith('/*')
          ? `${pattern.slice(0, -1)}cb`
          : pattern;
        const uri = `${base}#${frag}`;
        expect(matchesRedirectUri(uri, [pattern, uri])).toBe(false);
        expect(
          matchesRedirectUri(uri, [pattern, uri], { allowWildcard: true }),
        ).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  it('with the opt-in, never accepts a URI on another origin than a registered entry', () => {
    fc.assert(
      fc.property(
        registered.chain((pattern) =>
          candidate(pattern).map((uri) => ({ pattern, uri })),
        ),
        ({ pattern, uri }) => {
          if (!matchesRedirectUri(uri, [pattern], { allowWildcard: true }))
            return;
          if (uri === pattern) return;
          // It matched: it must parse, and to the registered origin
          // (scheme, host and port).
          expect(originOrNull(uri)).toBe(originOf(pattern));
        },
      ),
      { numRuns: 1000 },
    );
  });

  it('with the opt-in, never accepts a wildcard match whose path climbs out of the base', () => {
    fc.assert(
      fc.property(
        registered
          .filter((p) => p.endsWith('/*'))
          .chain((pattern) =>
            extension(pattern).map((uri) => ({ pattern, uri })),
          ),
        ({ pattern, uri }) => {
          if (!matchesRedirectUri(uri, [pattern], { allowWildcard: true }))
            return;
          if (uri === pattern) return;
          // However a URL parser resolves it, the path stays at or below
          // the registered base, and there is no fragment.
          const resolved = new URL(uri);
          const base = new URL(pattern.slice(0, -1));
          const basePath = base.pathname;
          expect(
            resolved.pathname.startsWith(basePath) ||
              `${resolved.pathname}/` === basePath,
          ).toBe(true);
          expect(resolved.hash).toBe('');
        },
      ),
      { numRuns: 1000 },
    );
  });

  it('never accepts a URI whose host differs from every registered host', () => {
    fc.assert(
      fc.property(
        fc.array(registered, { minLength: 1, maxLength: 5 }),
        exactUrl,
        fc.boolean(),
        (patterns, uri, allowWildcard) => {
          const hosts = patterns.map(
            (p) => new URL(p.endsWith('/*') ? p.slice(0, -1) : p).hostname,
          );
          fc.pre(!hosts.includes(new URL(uri).hostname));
          expect(matchesRedirectUri(uri, patterns, { allowWildcard })).toBe(
            false,
          );
        },
      ),
      { numRuns: 300 },
    );
  });

  it('accepts a loopback IP redirect URI on any port, and nothing that differs otherwise', () => {
    fc.assert(
      fc.property(
        loopbackHost,
        fc.option(loopbackPort, { nil: undefined }),
        loopbackPort,
        path,
        fc.string({ minLength: 1, maxLength: 10 }),
        (host, registeredPort, usedPort, rest, extra) => {
          const reg = `http://${host}${registeredPort === undefined ? '' : `:${registeredPort}`}${rest}`;
          const used = `http://${host}:${usedPort}${rest}`;
          expect(matchesRedirectUri(used, [reg])).toBe(true);
          // Anything else that differs still fails: more text, https.
          expect(matchesRedirectUri(`${used}${extra}`, [reg])).toBe(false);
          expect(
            matchesRedirectUri(`https://${host}:${usedPort}${rest}`, [reg]),
          ).toBe(false);
        },
      ),
      { numRuns: 500 },
    );
  });
});
