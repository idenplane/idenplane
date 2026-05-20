import { Injectable, Logger } from '@nestjs/common';
import type { IdenplanePlugin } from './plugin.interface.js';

export interface PluginRegistryEntry {
  plugin: IdenplanePlugin;
  enabled: boolean;
  loadedAt: Date;
}

/**
 * In-memory registry of loaded plugins.
 *
 * Serves as a fast lookup store; the authoritative persistence layer is the
 * `InstalledPlugin` Prisma model managed by PluginManagerService.
 */
@Injectable()
export class PluginRegistry {
  private readonly logger = new Logger(PluginRegistry.name);
  private readonly entries = new Map<string, PluginRegistryEntry>();

  /** Register a plugin in the in-memory registry. */
  register(plugin: IdenplanePlugin, enabled = true): void {
    if (this.entries.has(plugin.name)) {
      this.logger.warn(
        `Plugin '${plugin.name}' is already registered; overwriting.`,
      );
    }
    this.entries.set(plugin.name, { plugin, enabled, loadedAt: new Date() });
    this.logger.debug(
      `Registered plugin '${plugin.name}' (v${plugin.version})`,
    );
  }

  /** Unregister a plugin by name. Returns true if it existed. */
  unregister(name: string): boolean {
    const existed = this.entries.has(name);
    this.entries.delete(name);
    return existed;
  }

  /** Set the enabled flag for a registered plugin. */
  setEnabled(name: string, enabled: boolean): void {
    const entry = this.entries.get(name);
    if (!entry) {
      throw new Error(`Plugin '${name}' is not registered`);
    }
    entry.enabled = enabled;
  }

  /** Return the registry entry for the given plugin name, or undefined. */
  get(name: string): PluginRegistryEntry | undefined {
    return this.entries.get(name);
  }

  /** Return all registered plugins (enabled and disabled). */
  getAll(): PluginRegistryEntry[] {
    return Array.from(this.entries.values());
  }

  /** Return only enabled plugins. */
  getEnabled(): PluginRegistryEntry[] {
    return this.getAll().filter((e) => e.enabled);
  }

  /** Return enabled plugins filtered by type. */
  getEnabledByType<T extends IdenplanePlugin>(type: T['type']): T[] {
    return this.getEnabled()
      .filter((e) => e.plugin.type === type)
      .map((e) => e.plugin as T);
  }

  /** Returns true if a plugin with this name is registered and enabled. */
  isEnabled(name: string): boolean {
    return this.entries.get(name)?.enabled ?? false;
  }

  /** Returns total count of registered plugins. */
  get size(): number {
    return this.entries.size;
  }
}
