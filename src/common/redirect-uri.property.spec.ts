import fc from 'fast-check';
import { matchesRedirectUri } from './redirect-uri.utils';

/**
 * Property-based tests for redirect URI matching. A wrong "match" here sends
 * an authorization code to whoever controls the redirect URI, so beyond the
 * examples the matcher must never accept a URI on a host the client did not
 * register, however the URI is put together.
 */

const scheme = fc.constantFrom('https', 'http');
const port = fc.option(fc.integer({ min: 1, max: 65535 }), { nil: undefined });
const path = fc.webPath();

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

const candidate = (pattern: string) =>
  fc.oneof(
    fc.webUrl({ withQueryParameters: true, withFragments: true }),
    lookalike(pattern),
    fc.string({ maxLength: 60 }),
  );

describe('matchesRedirectUri (property-based)', () => {
  it('always accepts a URI that is registered exactly', () => {
    fc.assert(
      fc.property(
        fc.webUrl({ withQueryParameters: true, withFragments: true }),
        fc.array(registered, { maxLength: 5 }),
        fc.nat(),
        (uri, others, at) => {
          const list = [...others];
          list.splice(at % (list.length + 1), 0, uri);
          expect(matchesRedirectUri(uri, list)).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('accepts nothing when nothing is registered', () => {
    fc.assert(
      fc.property(fc.string(), (uri) => {
        expect(matchesRedirectUri(uri, [])).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('never accepts a URI on another origin than a registered entry', () => {
    fc.assert(
      fc.property(
        registered.chain((pattern) =>
          candidate(pattern).map((uri) => ({ pattern, uri })),
        ),
        ({ pattern, uri }) => {
          if (!matchesRedirectUri(uri, [pattern])) return;
          // It matched: it must parse, and to the registered origin
          // (scheme, host and port).
          expect(originOrNull(uri)).toBe(originOf(pattern));
        },
      ),
      { numRuns: 1000 },
    );
  });

  it('never accepts a URI whose host differs from every registered host', () => {
    fc.assert(
      fc.property(
        fc.array(registered, { minLength: 1, maxLength: 5 }),
        fc.webUrl({ withQueryParameters: true, withFragments: true }),
        (patterns, uri) => {
          const hosts = patterns.map(
            (p) => new URL(p.endsWith('/*') ? p.slice(0, -1) : p).hostname,
          );
          fc.pre(!hosts.includes(new URL(uri).hostname));
          expect(matchesRedirectUri(uri, patterns)).toBe(false);
        },
      ),
      { numRuns: 300 },
    );
  });
});
