import { createHash } from 'crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PluginLoaderService } from './plugin-loader.service.js';

/**
 * The integrity check against a real plugins directory. Manifests here use
 * the format `idenplane plugins hash` writes: the plugin's directory (or npm
 * package) name mapped to the lowercase hex SHA-256 of its entry file.
 */
describe('PluginLoaderService integrity manifest', () => {
  const PLUGIN_SOURCE =
    "module.exports = { name: 'hashed-plugin', version: '1.0.0', type: 'event-listener' };\n";
  const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

  let root: string;
  let pluginsDir: string;
  let nodeModules: string;
  let savedNodeEnv: string | undefined;
  let service: PluginLoaderService;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'idenplane-plugins-'));
    pluginsDir = join(root, 'plugins');
    nodeModules = join(root, 'node_modules');
    mkdirSync(join(pluginsDir, 'my-plugin'), { recursive: true });
    writeFileSync(join(pluginsDir, 'my-plugin', 'index.js'), PLUGIN_SOURCE);
    mkdirSync(join(nodeModules, 'idenplane-plugin-npm'), { recursive: true });
    writeFileSync(
      join(nodeModules, 'idenplane-plugin-npm', 'index.js'),
      PLUGIN_SOURCE,
    );
    savedNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    service = new PluginLoaderService();
  });

  afterEach(() => {
    process.env.NODE_ENV = savedNodeEnv;
    rmSync(root, { recursive: true, force: true });
  });

  const writeManifest = (dir: string, file: string, body: unknown) =>
    writeFileSync(join(dir, file), JSON.stringify(body));

  it('rejects a plugin without a manifest entry in production', async () => {
    const result = await service.discoverFromDirectory(pluginsDir);
    expect(result).toEqual([]);
  });

  it('loads a plugin whose directory name maps to its entry file hash', async () => {
    writeManifest(pluginsDir, '.manifest.json', {
      'my-plugin': sha256(PLUGIN_SOURCE),
    });
    const result = await service.discoverFromDirectory(pluginsDir);
    expect(result).toHaveLength(1);
    expect(result[0].plugin.name).toBe('hashed-plugin');
  });

  it('accepts an upper-case hex hash', async () => {
    writeManifest(pluginsDir, '.manifest.json', {
      'my-plugin': sha256(PLUGIN_SOURCE).toUpperCase(),
    });
    const result = await service.discoverFromDirectory(pluginsDir);
    expect(result).toHaveLength(1);
  });

  it('still accepts the entry file path as the key', async () => {
    writeManifest(pluginsDir, '.manifest.json', {
      [join(pluginsDir, 'my-plugin', 'index.js')]: sha256(PLUGIN_SOURCE),
    });
    const result = await service.discoverFromDirectory(pluginsDir);
    expect(result).toHaveLength(1);
  });

  it('refuses a plugin whose file no longer matches the manifest', async () => {
    writeManifest(pluginsDir, '.manifest.json', {
      'my-plugin': sha256('something else'),
    });
    const result = await service.discoverFromDirectory(pluginsDir);
    expect(result).toEqual([]);
  });

  it('loads an npm plugin keyed by package name', async () => {
    writeManifest(nodeModules, '.idenplane-plugin-manifest.json', {
      'idenplane-plugin-npm': sha256(PLUGIN_SOURCE),
    });
    const result = await service.discoverFromNpm(nodeModules);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('npm');
  });

  it('does not match a local plugin against an npm package-name key', async () => {
    writeManifest(nodeModules, '.idenplane-plugin-manifest.json', {
      'my-plugin': sha256(PLUGIN_SOURCE),
    });
    const result = await service.discoverFromDirectory(pluginsDir);
    expect(result).toEqual([]);
  });
});
