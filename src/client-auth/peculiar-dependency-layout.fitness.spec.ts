import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * @peculiar/asn1-schema keeps its schema registry in module state, so every
 * package that defines or reads ASN.1 schemas must load the same copy of it.
 * Two copies split the registry and fail at load time ("Cannot get schema for
 * 'AlgorithmIdentifier' target") or, worse, only when a rarely used schema is
 * read (Android key attestation's KeyDescription).
 *
 * The app uses @peculiar/x509 3 (asn1-schema 3) while @simplewebauthn/server
 * still depends on @peculiar/x509 2 (asn1-schema 2), so both families are
 * installed. This spec checks that each family resolves exactly one
 * asn1-schema and one asn1js, wherever npm placed the packages.
 */

const ROOT = resolve(__dirname, '..', '..');
const SHARED = ['@peculiar/asn1-schema', 'asn1js'];

/** Node's lookup of a package directory from another package's directory. */
function packageDir(from: string, name: string): string {
  let dir = from;
  for (;;) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) {
      return realpathSync(candidate);
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`${name} not found from ${from}`);
    dir = parent;
  }
}

function dependencyNames(dir: string): string[] {
  const manifest = JSON.parse(
    readFileSync(join(dir, 'package.json'), 'utf8'),
  ) as {
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
  return [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ].filter((name) => name.startsWith('@peculiar/') || name === 'asn1js');
}

/** Every copy of each shared package that the family of `entry` loads. */
function sharedCopies(entry: string): Map<string, Set<string>> {
  const copies = new Map(SHARED.map((name) => [name, new Set<string>()]));
  const seen = new Set<string>();
  const queue = [packageDir(ROOT, entry)];
  while (queue.length > 0) {
    const dir = queue.pop()!;
    if (seen.has(dir)) continue;
    seen.add(dir);
    for (const name of dependencyNames(dir)) {
      const target = packageDir(dir, name);
      copies.get(name)?.add(target);
      queue.push(target);
    }
  }
  return copies;
}

describe('@peculiar dependency layout', () => {
  it.each(['@peculiar/x509', '@simplewebauthn/server'])(
    '%s loads a single asn1-schema and asn1js',
    (entry) => {
      for (const [name, dirs] of sharedCopies(entry)) {
        expect({ name, copies: [...dirs] }).toEqual({
          name,
          copies: [expect.any(String)],
        });
      }
    },
  );

  it('the app gets @peculiar/x509 3', () => {
    const manifest = JSON.parse(
      readFileSync(
        join(packageDir(ROOT, '@peculiar/x509'), 'package.json'),
        'utf8',
      ),
    ) as { version: string };
    expect(manifest.version.startsWith('3.')).toBe(true);
  });
});
