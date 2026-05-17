import { Injectable, Logger } from '@nestjs/common';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { createHash } from 'crypto';
import { join, resolve } from 'path';
import type { AuthMePlugin } from './plugin.interface.js';

export interface DiscoveredPlugin {
  plugin: AuthMePlugin;
  source: 'directory' | 'npm';
  sourcePath: string;
}

/**
 * PluginLoaderService discovers and loads plugins from two sources:
 *
 * 1. `plugins/` directory at the project root — each subdirectory is a plugin.
 *    The subdirectory must export a default export or a named `plugin` export
 *    that satisfies the AuthMePlugin interface.
 *
 * 2. npm packages with the `authme-plugin-` prefix installed in node_modules.
 */
@Injectable()
export class PluginLoaderService {
  private readonly logger = new Logger(PluginLoaderService.name);

  /**
   * Discover all plugins from the plugins directory and npm packages.
   * Failures in individual plugins are isolated and logged; other plugins
   * continue loading.
   */
  async discoverAll(
    pluginsRootDir?: string,
    nodeModulesDir?: string,
  ): Promise<DiscoveredPlugin[]> {
    const discovered: DiscoveredPlugin[] = [];

    const fromDir = await this.discoverFromDirectory(pluginsRootDir);
    discovered.push(...fromDir);

    const fromNpm = await this.discoverFromNpm(nodeModulesDir);
    discovered.push(...fromNpm);

    return discovered;
  }

  /**
   * Load plugins from a `plugins/` directory. Each immediate subdirectory is
   * treated as a plugin package. The directory must contain an `index.js` (or
   * `index.ts` when running with ts-node) file.
   */
  async discoverFromDirectory(
    pluginsRootDir?: string,
  ): Promise<DiscoveredPlugin[]> {
    const rootDir = pluginsRootDir ?? resolve(process.cwd(), 'plugins');

    if (!existsSync(rootDir)) {
      this.logger.debug(
        `Plugins directory '${rootDir}' does not exist; skipping.`,
      );
      return [];
    }

    const discovered: DiscoveredPlugin[] = [];
    let entries: string[];

    try {
      entries = readdirSync(rootDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch (err) {
      this.logger.warn(
        `Failed to read plugins directory '${rootDir}': ${(err as Error).message}`,
      );
      return [];
    }

    for (const entry of entries) {
      const pluginPath = join(rootDir, entry);
      const pluginResult = await this.loadFromPath(pluginPath, 'directory');
      if (pluginResult) {
        discovered.push(pluginResult);
      }
    }

    return discovered;
  }

  /**
   * Discover plugins installed as npm packages with the `authme-plugin-` prefix.
   */
  async discoverFromNpm(nodeModulesDir?: string): Promise<DiscoveredPlugin[]> {
    const nmDir = nodeModulesDir ?? resolve(process.cwd(), 'node_modules');

    if (!existsSync(nmDir)) {
      return [];
    }

    const discovered: DiscoveredPlugin[] = [];
    let entries: string[];

    try {
      entries = readdirSync(nmDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name.startsWith('authme-plugin-'))
        .map((d) => d.name);
    } catch (err) {
      this.logger.warn(
        `Failed to read node_modules for npm plugins: ${(err as Error).message}`,
      );
      return [];
    }

    for (const packageName of entries) {
      const pluginPath = join(nmDir, packageName);
      const pluginResult = await this.loadFromPath(pluginPath, 'npm');
      if (pluginResult) {
        discovered.push(pluginResult);
      }
    }

    return discovered;
  }

  /**
   * Attempt to dynamically import a plugin from the given path.
   * Returns null on any failure to maintain isolation.
   */
  private async loadFromPath(
    pluginPath: string,
    source: 'directory' | 'npm',
  ): Promise<DiscoveredPlugin | null> {
    try {
      // Try standard index file locations
      const candidates = [
        join(pluginPath, 'index.js'),
        join(pluginPath, 'dist', 'index.js'),
        join(pluginPath, 'index.ts'),
      ];

      let loaded: any = null;
      let resolvedPath = pluginPath;

      for (const candidate of candidates) {
        if (existsSync(candidate)) {
          // Compute SHA-256 hash BEFORE loading the plugin code
          const fileHash = this.computeFileHash(candidate);
          const manifestHash = this.getManifestHash(candidate);

          if (manifestHash && fileHash && manifestHash !== fileHash) {
            this.logger.error(
              `Plugin integrity check FAILED for '${candidate}' — ` +
                `expected hash ${manifestHash}, got ${fileHash}. ` +
                `Plugin will NOT be loaded. Update the manifest if this change is intentional.`,
            );
            return null;
          }

          if (!manifestHash && fileHash) {
            if (process.env.NODE_ENV === 'production') {
              this.logger.error(
                `Plugin '${candidate}' rejected — no manifest hash found. ` +
                  `In production, all plugins must have integrity verification. ` +
                  `Generate a manifest with: authme plugins hash`,
              );
              return null;
            }
            this.logger.warn(
              `Plugin '${candidate}' has no manifest hash — loading without integrity verification.`,
            );
          }

          /* eslint-disable @typescript-eslint/no-unsafe-assignment */
          loaded = await import(candidate);
          resolvedPath = candidate;
          break;
        }
      }

      if (!loaded) {
        this.logger.debug(
          `No index file found in plugin directory '${pluginPath}'; skipping.`,
        );
        return null;
      }

      // Support both default export and named `plugin` export
      /* eslint-disable @typescript-eslint/no-unsafe-member-access */
      const pluginExport: AuthMePlugin = loaded.default ?? loaded.plugin;

      if (!pluginExport) {
        this.logger.warn(
          `Plugin at '${pluginPath}' does not export a default or named 'plugin' export; skipping.`,
        );
        return null;
      }

      if (!this.validatePlugin(pluginExport)) {
        this.logger.warn(
          `Plugin at '${pluginPath}' failed validation; skipping.`,
        );
        return null;
      }

      this.logger.log(
        `Discovered plugin '${pluginExport.name}' v${pluginExport.version} from ${source} (${resolvedPath})`,
      );

      return { plugin: pluginExport, source, sourcePath: resolvedPath };
    } catch (err) {
      this.logger.warn(
        `Failed to load plugin from '${pluginPath}': ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Validate that a loaded module satisfies the minimum AuthMePlugin shape.
   */
  validatePlugin(candidate: unknown): candidate is AuthMePlugin {
    if (typeof candidate !== 'object' || candidate === null) return false;

    const p = candidate as Record<string, unknown>;

    if (typeof p['name'] !== 'string' || !p['name']) return false;
    if (typeof p['version'] !== 'string' || !p['version']) return false;
    if (typeof p['type'] !== 'string' || !p['type']) return false;

    const validTypes = [
      'auth-provider',
      'event-listener',
      'token-enrichment',
      'theme',
    ];
    if (!validTypes.includes(p['type'])) return false;

    return true;
  }

  /**
   * Compute SHA-256 hash of a file on disk.
   */
  private computeFileHash(filePath: string): string | null {
    try {
      const content = readFileSync(filePath);
      return createHash('sha256').update(content).digest('hex');
    } catch {
      return null;
    }
  }

  /**
   * Look up the expected hash for a plugin file from the manifest.
   *
   * Two manifest locations are checked in order:
   *  1. `plugins/.manifest.json`  — for plugins loaded from the local plugins/
   *     directory (source === 'directory').
   *  2. `node_modules/.authme-plugin-manifest.json` — for npm-installed plugins
   *     (source === 'npm').  The npm manifest uses the npm package name as its
   *     key (e.g. "authme-plugin-my-plugin") in addition to the full file path.
   *
   * Both manifests map file paths (absolute or relative) OR plugin names to
   * their expected SHA-256 hashes.
   */
  private getManifestHash(filePath: string): string | null {
    const absoluteFilePath = resolve(filePath);

    // Helper: look up a hash in a manifest file using several possible keys.
    const lookupInManifest = (
      manifestPath: string,
      extraKeys: string[] = [],
    ): string | null => {
      try {
        if (!existsSync(manifestPath)) return null;
        const manifest = JSON.parse(
          readFileSync(manifestPath, 'utf-8'),
        ) as Record<string, string>;
        // Try the provided path as-is, its resolved absolute form, then any
        // extra keys (e.g. package name).
        return (
          manifest[filePath] ??
          manifest[absoluteFilePath] ??
          extraKeys.reduce<string | null>(
            (found, key) => found ?? manifest[key] ?? null,
            null,
          ) ??
          null
        );
      } catch {
        return null;
      }
    };

    // 1. Local plugins/ manifest
    const localManifest = resolve(process.cwd(), 'plugins', '.manifest.json');
    const localHash = lookupInManifest(localManifest);
    if (localHash !== null) return localHash;

    // 2. npm manifest — also try the package name derived from the path so
    //    that entries like { "authme-plugin-foo": "<hash>" } are matched even
    //    when the manifest was generated without full paths.
    const npmManifest = resolve(
      process.cwd(),
      'node_modules',
      '.authme-plugin-manifest.json',
    );
    // Extract package name: last segment of node_modules/<name>/...
    const nmDir = resolve(process.cwd(), 'node_modules');
    let packageName: string | undefined;
    if (absoluteFilePath.startsWith(nmDir + '/')) {
      packageName = absoluteFilePath.slice(nmDir.length + 1).split('/')[0];
    }
    return lookupInManifest(npmManifest, packageName ? [packageName] : []);
  }
}
