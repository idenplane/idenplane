import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { PrismaService } from '../prisma/prisma.service.js';
import { PluginLoaderService } from './plugin-loader.service.js';
import { PluginRegistry } from './plugin-registry.js';
import type {
  AuthMePlugin,
  PluginContext,
  EventListenerPlugin,
  TokenEnrichmentPlugin,
} from './plugin.interface.js';
import {
  isEventListenerPlugin,
  isTokenEnrichmentPlugin,
} from './plugin.interface.js';

export interface PluginSummary {
  name: string;
  version: string;
  description?: string;
  type: string;
  enabled: boolean;
  config: Record<string, any> | null;
  installedAt: Date;
  updatedAt: Date;
}

/**
 * PluginManagerService manages the full plugin lifecycle:
 * discovery, loading, enabling, disabling, and uninstalling.
 *
 * All calls into plugin code are wrapped in try/catch for isolation.
 */
@Injectable()
export class PluginManagerService implements OnModuleInit {
  private readonly logger = new Logger(PluginManagerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly loader: PluginLoaderService,
    private readonly registry: PluginRegistry,
  ) {}

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  async onModuleInit(): Promise<void> {
    await this.loadAndSyncPlugins();
  }

  /**
   * Discover plugins from disk and npm, register them in the registry,
   * and sync enabled/disabled state from the database.
   */
  async loadAndSyncPlugins(): Promise<void> {
    this.logger.log('Starting plugin discovery...');

    const discovered = await this.loader.discoverAll();
    this.logger.log(`Discovered ${discovered.length} plugin(s).`);

    for (const { plugin, sourcePath } of discovered) {
      await this.installOrSync(plugin, sourcePath);
    }

    this.logger.log(
      `Plugin system initialised. ${this.registry.size} plugin(s) registered.`,
    );
  }

  /**
   * Compute a SHA-256 hex digest of a file on disk.
   * Returns null if the file cannot be read (e.g. bundled/virtual module).
   */
  private computeFileHash(filePath: string): string | null {
    try {
      const contents = readFileSync(filePath);
      return createHash('sha256').update(contents).digest('hex');
    } catch {
      return null;
    }
  }

  /**
   * Install a plugin if it is not already in the DB, or sync its state from DB.
   * @param sourcePath Absolute path to the plugin's resolved entry file — used
   *   for integrity verification.
   */
  private async installOrSync(
    plugin: AuthMePlugin,
    sourcePath: string,
  ): Promise<void> {
    try {
      const currentHash = this.computeFileHash(sourcePath);

      let record = await this.prisma.installedPlugin.findUnique({
        where: { name: plugin.name },
      });

      if (!record) {
        // First time seeing this plugin — persist it as enabled by default,
        // recording the current file hash as the trusted baseline.
        record = await this.prisma.installedPlugin.create({
          data: {
            name: plugin.name,
            version: plugin.version,
            type: plugin.type,
            enabled: true,
            config: Prisma.JsonNull,
            fileHash: currentHash,
          },
        });

        const context = this.buildContext(plugin, null);
        await this.invokeLifecycle(plugin, 'onInstall', context);
        this.logger.log(
          `Installed new plugin '${plugin.name}' (hash: ${currentHash ?? 'unavailable'}).`,
        );
      } else {
        // Already known — verify file integrity against the stored hash.
        if (record.fileHash && currentHash && record.fileHash !== currentHash) {
          this.logger.warn(
            `Integrity check failed for plugin '${plugin.name}': ` +
              `stored hash ${record.fileHash} does not match current file hash ${currentHash}. ` +
              `The plugin file may have been modified after installation. ` +
              `If this is expected (e.g. a manual update), re-install the plugin to update the baseline.`,
          );
        } else if (!record.fileHash && currentHash) {
          // No stored hash yet (plugin was recorded before this feature existed) — store it now.
          await this.prisma.installedPlugin.update({
            where: { name: plugin.name },
            data: { fileHash: currentHash },
          });
        }

        // Update version in case it changed
        if (record.version !== plugin.version) {
          await this.prisma.installedPlugin.update({
            where: { name: plugin.name },
            data: { version: plugin.version, fileHash: currentHash },
          });
        }
      }

      // Register in the in-memory registry with the persisted enabled state
      this.registry.register(plugin, record.enabled);

      if (record.enabled) {
        const context = this.buildContext(
          plugin,
          record.config as Record<string, any> | null,
        );
        await this.invokeLifecycle(plugin, 'onEnable', context);
      }
    } catch (err) {
      this.logger.error(
        `Failed to install/sync plugin '${plugin.name}': ${(err as Error).message}`,
      );
    }
  }

  // ─── Admin Operations ─────────────────────────────────────────────────────

  async listPlugins(): Promise<PluginSummary[]> {
    const records = await this.prisma.installedPlugin.findMany({
      orderBy: { installedAt: 'asc' },
    });

    return records.map((r) => ({
      name: r.name,
      version: r.version,
      description: this.registry.get(r.name)?.plugin.description,
      type: r.type,
      enabled: r.enabled,
      config: r.config as Record<string, any> | null,
      installedAt: r.installedAt,
      updatedAt: r.updatedAt,
    }));
  }

  async getPlugin(name: string): Promise<PluginSummary> {
    const record = await this.prisma.installedPlugin.findUnique({
      where: { name },
    });

    if (!record) {
      throw new NotFoundException(`Plugin '${name}' not found`);
    }

    return {
      name: record.name,
      version: record.version,
      description: this.registry.get(name)?.plugin.description,
      type: record.type,
      enabled: record.enabled,
      config: record.config as Record<string, any> | null,
      installedAt: record.installedAt,
      updatedAt: record.updatedAt,
    };
  }

  async enablePlugin(name: string): Promise<PluginSummary> {
    const record = await this.prisma.installedPlugin.findUnique({
      where: { name },
    });
    if (!record) throw new NotFoundException(`Plugin '${name}' not found`);
    if (record.enabled)
      throw new ConflictException(`Plugin '${name}' is already enabled`);

    await this.prisma.installedPlugin.update({
      where: { name },
      data: { enabled: true },
    });

    const entry = this.registry.get(name);
    if (entry) {
      this.registry.setEnabled(name, true);
      const context = this.buildContext(
        entry.plugin,
        record.config as Record<string, any> | null,
      );
      await this.invokeLifecycle(entry.plugin, 'onEnable', context);
    }

    this.logger.log(`Plugin '${name}' enabled.`);
    return this.getPlugin(name);
  }

  async disablePlugin(name: string): Promise<PluginSummary> {
    const record = await this.prisma.installedPlugin.findUnique({
      where: { name },
    });
    if (!record) throw new NotFoundException(`Plugin '${name}' not found`);
    if (!record.enabled)
      throw new ConflictException(`Plugin '${name}' is already disabled`);

    await this.prisma.installedPlugin.update({
      where: { name },
      data: { enabled: false },
    });

    const entry = this.registry.get(name);
    if (entry) {
      this.registry.setEnabled(name, false);
      const context = this.buildContext(
        entry.plugin,
        record.config as Record<string, any> | null,
      );
      await this.invokeLifecycle(entry.plugin, 'onDisable', context);
    }

    this.logger.log(`Plugin '${name}' disabled.`);
    return this.getPlugin(name);
  }

  async uninstallPlugin(name: string): Promise<void> {
    const record = await this.prisma.installedPlugin.findUnique({
      where: { name },
    });
    if (!record) throw new NotFoundException(`Plugin '${name}' not found`);

    const entry = this.registry.get(name);
    if (entry) {
      const context = this.buildContext(
        entry.plugin,
        record.config as Record<string, any> | null,
      );
      await this.invokeLifecycle(entry.plugin, 'onUninstall', context);
      this.registry.unregister(name);
    }

    await this.prisma.installedPlugin.delete({ where: { name } });
    this.logger.log(`Plugin '${name}' uninstalled.`);
  }

  // ─── Extension Point Dispatch ─────────────────────────────────────────────

  /**
   * Dispatch an event to all enabled EventListenerPlugin instances that
   * subscribe to the given event type. Each plugin is called in isolation.
   */
  async dispatchEvent(event: {
    type: string;
    realmId?: string;
    userId?: string;
    sessionId?: string;
    clientId?: string;
    ipAddress?: string;
    error?: string;
    details?: Record<string, unknown>;
  }): Promise<void> {
    const listeners =
      this.registry.getEnabledByType<EventListenerPlugin>('event-listener');

    for (const listener of listeners) {
      if (
        listener.subscribedEvents.includes('*') ||
        listener.subscribedEvents.includes(event.type)
      ) {
        try {
          await listener.onEvent({
            ...event,
            timestamp: new Date().toISOString(),
          });
        } catch (err) {
          this.logger.warn(
            `EventListenerPlugin '${listener.name}' threw on event '${event.type}': ${(err as Error).message}`,
          );
        }
      }
    }
  }

  /**
   * Run the token payload through all enabled TokenEnrichmentPlugin instances.
   * Each plugin receives the current (possibly already enriched) token payload
   * and may return a modified version. Failures fall back to the previous value.
   */
  async enrichToken(
    tokenPayload: Record<string, unknown>,
    user: any,
    realm: string,
  ): Promise<Record<string, unknown>> {
    const enrichers =
      this.registry.getEnabledByType<TokenEnrichmentPlugin>('token-enrichment');

    let result = { ...tokenPayload };

    for (const enricher of enrichers) {
      try {
        /* eslint-disable @typescript-eslint/no-unsafe-assignment */
        result = await enricher.enrichToken(result, user, realm);
      } catch (err) {
        this.logger.warn(
          `TokenEnrichmentPlugin '${enricher.name}' threw during enrichment: ${(err as Error).message}`,
        );
        // Keep previous value on failure
      }
    }

    return result;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private buildContext(
    plugin: AuthMePlugin,
    config: Record<string, any> | null,
  ): PluginContext {
    return {
      prisma: this.prisma,
      logger: new Logger(`Plugin:${plugin.name}`),
      config: config ?? {},
    };
  }

  /**
   * Invoke a lifecycle hook on a plugin, isolating any thrown errors.
   */
  private async invokeLifecycle(
    plugin: AuthMePlugin,
    hook: 'onInstall' | 'onEnable' | 'onDisable' | 'onUninstall',
    context: PluginContext,
  ): Promise<void> {
    const fn = plugin[hook];
    if (typeof fn !== 'function') return;

    try {
      await fn.call(plugin, context);
    } catch (err) {
      this.logger.warn(
        `Plugin '${plugin.name}' threw during '${hook}': ${(err as Error).message}`,
      );
    }
  }

  // ─── Type-narrowing helpers exposed for integration ───────────────────────

  isEventListener(p: AuthMePlugin): p is EventListenerPlugin {
    return isEventListenerPlugin(p);
  }

  isTokenEnrichment(p: AuthMePlugin): p is TokenEnrichmentPlugin {
    return isTokenEnrichmentPlugin(p);
  }
}
