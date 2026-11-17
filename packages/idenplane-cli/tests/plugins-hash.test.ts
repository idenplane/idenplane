import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Command } from 'commander';
import {
  buildManifest,
  hashPlugins,
  registerPluginsCommand,
  serializeManifest,
} from '../src/commands/plugins.js';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'idenplane-cli-plugins-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(path: string, content: string) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

async function run(args: string[]): Promise<string> {
  const program = new Command();
  program.exitOverride();
  registerPluginsCommand(program);
  const out: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  const originalError = console.error;
  process.stdout.write = ((chunk: string) => {
    out.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  console.error = () => {};
  try {
    await program.parseAsync(['node', 'idenplane', ...args]);
  } finally {
    process.stdout.write = original;
    console.error = originalError;
  }
  return out.join('');
}

test('hashes each plugin directory by name, with the loader’s entry file', () => {
  const plugins = join(root, 'plugins');
  write(join(plugins, 'b-plugin', 'index.js'), 'b');
  // dist/index.js is used only when there is no index.js
  write(join(plugins, 'a-plugin', 'dist', 'index.js'), 'a-dist');
  write(join(plugins, 'a-plugin', 'index.ts'), 'a-ts');
  // index.js wins over dist/index.js
  write(join(plugins, 'c-plugin', 'index.js'), 'c');
  write(join(plugins, 'c-plugin', 'dist', 'index.js'), 'c-dist');
  // no entry file: skipped, as the loader skips it
  mkdirSync(join(plugins, 'empty'), { recursive: true });
  // a plain file in plugins/ is not a plugin
  writeFileSync(join(plugins, 'README.md'), 'x');

  const manifest = buildManifest(hashPlugins(plugins));
  assert.deepEqual(manifest, {
    'a-plugin': sha256('a-dist'),
    'b-plugin': sha256('b'),
    'c-plugin': sha256('c'),
  });
  assert.deepEqual(Object.keys(manifest), ['a-plugin', 'b-plugin', 'c-plugin']);
  for (const hash of Object.values(manifest)) {
    assert.match(hash, /^[0-9a-f]{64}$/);
  }
});

test('with npm, hashes only idenplane-plugin-* packages', () => {
  const nm = join(root, 'node_modules');
  write(join(nm, 'idenplane-plugin-x', 'index.js'), 'x');
  write(join(nm, 'left-pad', 'index.js'), 'nope');
  assert.deepEqual(buildManifest(hashPlugins(nm, true)), {
    'idenplane-plugin-x': sha256('x'),
  });
});

test('fails on a missing directory', () => {
  assert.throws(() => hashPlugins(join(root, 'nope')), /Directory not found/);
});

test('prints the manifest as JSON', async () => {
  const plugins = join(root, 'plugins');
  write(join(plugins, 'p', 'index.js'), 'p');
  const out = await run(['plugins', 'hash', plugins]);
  assert.equal(out, serializeManifest({ p: sha256('p') }));
  assert.deepEqual(JSON.parse(out), { p: sha256('p') });
  assert.equal(existsSync(join(plugins, '.manifest.json')), false);
});

test('--write writes the manifest where the server reads it', async () => {
  const plugins = join(root, 'plugins');
  write(join(plugins, 'p', 'index.js'), 'p');
  const out = await run(['plugins', 'hash', plugins, '--write']);
  assert.equal(out, '');
  assert.deepEqual(
    JSON.parse(readFileSync(join(plugins, '.manifest.json'), 'utf8')),
    { p: sha256('p') },
  );

  const nm = join(root, 'node_modules');
  write(join(nm, 'idenplane-plugin-q', 'dist', 'index.js'), 'q');
  await run(['plugins', 'hash', nm, '--npm', '--write']);
  assert.deepEqual(
    JSON.parse(
      readFileSync(join(nm, '.idenplane-plugin-manifest.json'), 'utf8'),
    ),
    { 'idenplane-plugin-q': sha256('q') },
  );
});
