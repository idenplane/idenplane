import { Command } from 'commander';
import { createHash } from 'crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

/**
 * Entry files the server's plugin loader tries, in this order
 * (src/plugins/plugin-loader.service.ts). The first one that exists is the
 * file it hashes and imports, so it is the one hashed here.
 */
export const PLUGIN_ENTRY_CANDIDATES = [
  'index.js',
  join('dist', 'index.js'),
  'index.ts',
];

/** Prefix of npm packages the server loads as plugins. */
export const NPM_PLUGIN_PREFIX = 'idenplane-plugin-';

/** Manifest the server reads for plugins in its `plugins/` directory. */
export const LOCAL_MANIFEST_FILE = '.manifest.json';

/** Manifest the server reads for npm plugins, inside `node_modules/`. */
export const NPM_MANIFEST_FILE = '.idenplane-plugin-manifest.json';

/** Plugin key (directory or package name) → lowercase hex SHA-256. */
export type PluginManifest = Record<string, string>;

export interface HashedPlugin {
  key: string;
  entryFile: string;
  sha256: string;
}

/** SHA-256 of a file's bytes, lowercase hex — the loader's format. */
export function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** The entry file the loader would pick for a plugin directory, if any. */
export function findPluginEntry(pluginDir: string): string | null {
  for (const candidate of PLUGIN_ENTRY_CANDIDATES) {
    const path = join(pluginDir, candidate);
    if (existsSync(path)) return path;
  }
  return null;
}

/**
 * Hashes every plugin the server would discover in `dir`: each subdirectory
 * of a `plugins/` directory, or each `idenplane-plugin-*` package of a
 * `node_modules/` directory (`npm`). Directories without an entry file are
 * skipped, as the loader skips them. Sorted by key.
 */
export function hashPlugins(dir: string, npm = false): HashedPlugin[] {
  const root = resolve(dir);
  if (!existsSync(root)) {
    throw new Error(`Directory not found: ${root}`);
  }
  const names = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => !npm || name.startsWith(NPM_PLUGIN_PREFIX))
    .sort();

  const hashed: HashedPlugin[] = [];
  for (const name of names) {
    const entryFile = findPluginEntry(join(root, name));
    if (!entryFile) continue;
    hashed.push({ key: name, entryFile, sha256: sha256File(entryFile) });
  }
  return hashed;
}

/** The manifest JSON object for a list of hashed plugins. */
export function buildManifest(plugins: HashedPlugin[]): PluginManifest {
  const manifest: PluginManifest = {};
  for (const p of plugins) manifest[p.key] = p.sha256;
  return manifest;
}

/** Manifest file contents exactly as written to disk. */
export function serializeManifest(manifest: PluginManifest): string {
  return JSON.stringify(manifest, null, 2) + '\n';
}

/**
 * Registers `idenplane plugins hash`, which computes the SHA-256 integrity
 * manifest the server checks before loading a plugin. In production
 * (`NODE_ENV=production`) a plugin without a matching manifest entry is not
 * loaded.
 */
export function registerPluginsCommand(program: Command): void {
  const plugins = program
    .command('plugins')
    .description('Work with server plugins on this machine');

  plugins
    .command('hash [dir]')
    .description(
      'Print the SHA-256 integrity manifest for the plugins in a plugins/ ' +
        'directory (default ./plugins), or with --npm for the ' +
        'idenplane-plugin-* packages in a node_modules/ directory ' +
        '(default ./node_modules)',
    )
    .option('--npm', 'Hash idenplane-plugin-* packages in node_modules')
    .option(
      '-w, --write',
      `Write the manifest where the server reads it (<dir>/${LOCAL_MANIFEST_FILE}, ` +
        `or <dir>/${NPM_MANIFEST_FILE} with --npm) instead of printing it`,
    )
    .action((dir: string | undefined, opts: { npm?: boolean; write?: boolean }) => {
      const target = resolve(dir ?? (opts.npm ? 'node_modules' : 'plugins'));
      const hashed = hashPlugins(target, opts.npm ?? false);
      if (hashed.length === 0) {
        console.error(
          opts.npm
            ? `No ${NPM_PLUGIN_PREFIX}* packages with an entry file in ${target}.`
            : `No plugins with an entry file (index.js, dist/index.js, index.ts) in ${target}.`,
        );
      }
      const content = serializeManifest(buildManifest(hashed));
      if (!opts.write) {
        process.stdout.write(content);
        return;
      }
      const file = join(target, opts.npm ? NPM_MANIFEST_FILE : LOCAL_MANIFEST_FILE);
      writeFileSync(file, content);
      for (const p of hashed) {
        console.error(`${p.sha256}  ${p.key} (${p.entryFile})`);
      }
      console.error(`Wrote ${file}`);
    });
}
