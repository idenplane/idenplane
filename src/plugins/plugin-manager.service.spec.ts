import { NotFoundException, ConflictException } from '@nestjs/common';
import { PluginManagerService } from './plugin-manager.service.js';
import { PluginRegistry } from './plugin-registry.js';
import { PluginLoaderService } from './plugin-loader.service.js';
import {
  createMockPrismaService,
  MockPrismaService,
} from '../prisma/prisma.mock.js';
import type {
  EventListenerPlugin,
  TokenEnrichmentPlugin,
  PluginEvent,
} from './plugin.interface.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

const makeEventListenerPlugin = (
  name = 'test-listener',
): EventListenerPlugin => ({
  name,
  version: '1.0.0',
  description: 'A test event listener',
  type: 'event-listener',
  subscribedEvents: ['user.login'],
  onEvent: jest.fn().mockResolvedValue(undefined),
  onInstall: jest.fn().mockResolvedValue(undefined),
  onEnable: jest.fn().mockResolvedValue(undefined),
  onDisable: jest.fn().mockResolvedValue(undefined),
  onUninstall: jest.fn().mockResolvedValue(undefined),
});

const makeEnrichmentPlugin = (
  name = 'test-enricher',
): TokenEnrichmentPlugin => ({
  name,
  version: '1.0.0',
  type: 'token-enrichment',
  enrichToken: jest.fn().mockImplementation(async (token: any) => ({
    ...token,
    enriched: true,
  })),
});

const makeDbRecord = (overrides: Partial<any> = {}) => ({
  id: 'uuid-1',
  name: 'test-listener',
  version: '1.0.0',
  type: 'event-listener',
  enabled: true,
  config: null,
  installedAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('PluginManagerService', () => {
  let service: PluginManagerService;
  let prisma: MockPrismaService;
  let registry: PluginRegistry;
  let loader: PluginLoaderService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    registry = new PluginRegistry();
    loader = {
      discoverAll: jest.fn().mockResolvedValue([]),
      discoverFromDirectory: jest.fn().mockResolvedValue([]),
      discoverFromNpm: jest.fn().mockResolvedValue([]),
      validatePlugin: jest.fn().mockReturnValue(true),
    } as any;

    service = new PluginManagerService(prisma as any, loader, registry);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── onModuleInit / loadAndSyncPlugins ──────────────────────────────────

  describe('onModuleInit', () => {
    it('should call discoverAll and register discovered plugins', async () => {
      const plugin = makeEventListenerPlugin();
      (loader.discoverAll as jest.Mock).mockResolvedValue([
        { plugin, source: 'directory', sourcePath: '/plugins/test' },
      ]);

      prisma.installedPlugin.findUnique.mockResolvedValue(null);
      prisma.installedPlugin.create.mockResolvedValue(makeDbRecord());

      await service.onModuleInit();

      expect(loader.discoverAll).toHaveBeenCalled();
      expect(registry.size).toBe(1);
    });

    it('should sync existing plugin state from the database', async () => {
      const plugin = makeEventListenerPlugin();
      (loader.discoverAll as jest.Mock).mockResolvedValue([
        { plugin, source: 'directory', sourcePath: '/plugins/test' },
      ]);

      // Plugin already in DB, but disabled
      prisma.installedPlugin.findUnique.mockResolvedValue(
        makeDbRecord({ enabled: false }),
      );
      prisma.installedPlugin.update.mockResolvedValue(
        makeDbRecord({ enabled: false }),
      );

      await service.onModuleInit();

      expect(registry.isEnabled('test-listener')).toBe(false);
    });

    it('should persist a new plugin to the database with onInstall lifecycle', async () => {
      const plugin = makeEventListenerPlugin();
      (loader.discoverAll as jest.Mock).mockResolvedValue([
        { plugin, source: 'directory', sourcePath: '/plugins/test' },
      ]);

      prisma.installedPlugin.findUnique.mockResolvedValue(null);
      prisma.installedPlugin.create.mockResolvedValue(makeDbRecord());

      await service.onModuleInit();

      expect(prisma.installedPlugin.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'test-listener',
            type: 'event-listener',
          }),
        }),
      );
      expect(plugin.onInstall).toHaveBeenCalled();
    });

    it('should continue loading other plugins when one fails', async () => {
      const badPlugin = makeEventListenerPlugin('bad-plugin');
      const goodPlugin = makeEventListenerPlugin('good-plugin');

      (loader.discoverAll as jest.Mock).mockResolvedValue([
        { plugin: badPlugin, source: 'directory', sourcePath: '/plugins/bad' },
        {
          plugin: goodPlugin,
          source: 'directory',
          sourcePath: '/plugins/good',
        },
      ]);

      prisma.installedPlugin.findUnique
        .mockRejectedValueOnce(new Error('DB error'))
        .mockResolvedValueOnce(null);

      prisma.installedPlugin.create.mockResolvedValue(
        makeDbRecord({ name: 'good-plugin' }),
      );

      // Should not throw
      await service.onModuleInit();

      // good-plugin should still be in registry
      expect(registry.get('good-plugin')).toBeDefined();
    });
  });

  // ─── listPlugins ────────────────────────────────────────────────────────

  describe('listPlugins', () => {
    it('should return summaries from the database', async () => {
      prisma.installedPlugin.findMany.mockResolvedValue([makeDbRecord()]);

      const list = await service.listPlugins();

      expect(list).toHaveLength(1);
      expect(list[0].name).toBe('test-listener');
    });
  });

  // ─── getPlugin ──────────────────────────────────────────────────────────

  describe('getPlugin', () => {
    it('should return plugin summary for existing plugin', async () => {
      prisma.installedPlugin.findUnique.mockResolvedValue(makeDbRecord());

      const summary = await service.getPlugin('test-listener');

      expect(summary.name).toBe('test-listener');
      expect(summary.enabled).toBe(true);
    });

    it('should throw NotFoundException for unknown plugin', async () => {
      prisma.installedPlugin.findUnique.mockResolvedValue(null);

      await expect(service.getPlugin('no-such-plugin')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── enablePlugin ───────────────────────────────────────────────────────

  describe('enablePlugin', () => {
    it('should enable a disabled plugin', async () => {
      const plugin = makeEventListenerPlugin();
      registry.register(plugin, false);

      prisma.installedPlugin.findUnique
        .mockResolvedValueOnce(makeDbRecord({ enabled: false })) // for enablePlugin call
        .mockResolvedValueOnce(makeDbRecord({ enabled: true })); // for final getPlugin

      prisma.installedPlugin.update.mockResolvedValue(
        makeDbRecord({ enabled: true }),
      );

      const result = await service.enablePlugin('test-listener');

      expect(prisma.installedPlugin.update).toHaveBeenCalledWith({
        where: { name: 'test-listener' },
        data: { enabled: true },
      });
      expect(registry.isEnabled('test-listener')).toBe(true);
      expect(plugin.onEnable).toHaveBeenCalled();
    });

    it('should throw NotFoundException for unknown plugin', async () => {
      prisma.installedPlugin.findUnique.mockResolvedValue(null);
      await expect(service.enablePlugin('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ConflictException when plugin is already enabled', async () => {
      prisma.installedPlugin.findUnique.mockResolvedValue(
        makeDbRecord({ enabled: true }),
      );
      await expect(service.enablePlugin('test-listener')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // ─── disablePlugin ──────────────────────────────────────────────────────

  describe('disablePlugin', () => {
    it('should disable an enabled plugin', async () => {
      const plugin = makeEventListenerPlugin();
      registry.register(plugin, true);

      prisma.installedPlugin.findUnique
        .mockResolvedValueOnce(makeDbRecord({ enabled: true })) // for disablePlugin
        .mockResolvedValueOnce(makeDbRecord({ enabled: false })); // for getPlugin

      prisma.installedPlugin.update.mockResolvedValue(
        makeDbRecord({ enabled: false }),
      );

      await service.disablePlugin('test-listener');

      expect(registry.isEnabled('test-listener')).toBe(false);
      expect(plugin.onDisable).toHaveBeenCalled();
    });

    it('should throw NotFoundException for unknown plugin', async () => {
      prisma.installedPlugin.findUnique.mockResolvedValue(null);
      await expect(service.disablePlugin('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ConflictException when plugin is already disabled', async () => {
      prisma.installedPlugin.findUnique.mockResolvedValue(
        makeDbRecord({ enabled: false }),
      );
      await expect(service.disablePlugin('test-listener')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // ─── uninstallPlugin ────────────────────────────────────────────────────

  describe('uninstallPlugin', () => {
    it('should call onUninstall, remove from registry, and delete from DB', async () => {
      const plugin = makeEventListenerPlugin();
      registry.register(plugin, true);

      prisma.installedPlugin.findUnique.mockResolvedValue(makeDbRecord());
      prisma.installedPlugin.delete.mockResolvedValue(makeDbRecord());

      await service.uninstallPlugin('test-listener');

      expect(plugin.onUninstall).toHaveBeenCalled();
      expect(registry.get('test-listener')).toBeUndefined();
      expect(prisma.installedPlugin.delete).toHaveBeenCalledWith({
        where: { name: 'test-listener' },
      });
    });

    it('should throw NotFoundException for unknown plugin', async () => {
      prisma.installedPlugin.findUnique.mockResolvedValue(null);
      await expect(service.uninstallPlugin('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── dispatchEvent ──────────────────────────────────────────────────────

  describe('dispatchEvent', () => {
    it('should call onEvent on matching enabled event-listener plugins', async () => {
      const plugin = makeEventListenerPlugin();
      registry.register(plugin, true);

      await service.dispatchEvent({ type: 'user.login', realmId: 'realm-1' });

      expect(plugin.onEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'user.login', realmId: 'realm-1' }),
      );
    });

    it('should not call onEvent for non-subscribed event types', async () => {
      const plugin = makeEventListenerPlugin(); // subscribes to 'user.login'
      registry.register(plugin, true);

      await service.dispatchEvent({ type: 'user.logout' });

      expect(plugin.onEvent).not.toHaveBeenCalled();
    });

    it('should call onEvent for wildcard subscribed plugins', async () => {
      const plugin = makeEventListenerPlugin();
      plugin.subscribedEvents = ['*'];
      registry.register(plugin, true);

      await service.dispatchEvent({ type: 'anything.happened' });

      expect(plugin.onEvent).toHaveBeenCalled();
    });

    it('should not call onEvent on disabled plugins', async () => {
      const plugin = makeEventListenerPlugin();
      registry.register(plugin, false);

      await service.dispatchEvent({ type: 'user.login' });

      expect(plugin.onEvent).not.toHaveBeenCalled();
    });

    it('should isolate plugin errors and continue', async () => {
      const badPlugin = makeEventListenerPlugin('bad');
      badPlugin.subscribedEvents = ['*'];
      (badPlugin.onEvent as jest.Mock).mockRejectedValue(
        new Error('plugin crash'),
      );

      const goodPlugin = makeEventListenerPlugin('good');
      goodPlugin.subscribedEvents = ['*'];

      registry.register(badPlugin, true);
      registry.register(goodPlugin, true);

      // Should not throw
      await service.dispatchEvent({ type: 'user.login' });

      expect(goodPlugin.onEvent).toHaveBeenCalled();
    });
  });

  // ─── enrichToken ────────────────────────────────────────────────────────

  describe('enrichToken', () => {
    it('should return token unchanged when no enrichment plugins are registered', async () => {
      const token = { sub: 'user-1', iss: 'https://auth.example.com' };
      const result = await service.enrichToken(token, {}, 'my-realm');
      expect(result).toEqual(token);
    });

    it('should apply enrichment plugin and return enriched token', async () => {
      const plugin = makeEnrichmentPlugin();
      registry.register(plugin, true);

      const token = { sub: 'user-1' };
      const result = await service.enrichToken(token, {}, 'my-realm');

      expect(result).toMatchObject({ sub: 'user-1', enriched: true });
      expect(plugin.enrichToken).toHaveBeenCalledWith(token, {}, 'my-realm');
    });

    it('should chain multiple enrichment plugins', async () => {
      const p1 = makeEnrichmentPlugin('enricher-1');
      (p1.enrichToken as jest.Mock).mockImplementation(async (t: any) => ({
        ...t,
        claim1: 'value1',
      }));

      const p2 = makeEnrichmentPlugin('enricher-2');
      (p2.enrichToken as jest.Mock).mockImplementation(async (t: any) => ({
        ...t,
        claim2: 'value2',
      }));

      registry.register(p1, true);
      registry.register(p2, true);

      const result = await service.enrichToken({ sub: 'user-1' }, {}, 'realm');

      expect(result).toMatchObject({
        sub: 'user-1',
        claim1: 'value1',
        claim2: 'value2',
      });
    });

    it('should fall back to previous value when an enrichment plugin throws', async () => {
      const plugin = makeEnrichmentPlugin();
      (plugin.enrichToken as jest.Mock).mockRejectedValue(
        new Error('enrichment failed'),
      );
      registry.register(plugin, true);

      const token = { sub: 'user-1' };
      const result = await service.enrichToken(token, {}, 'realm');

      // Falls back to original token on error
      expect(result).toEqual(token);
    });

    it('should skip disabled enrichment plugins', async () => {
      const plugin = makeEnrichmentPlugin();
      registry.register(plugin, false);

      const token = { sub: 'user-1' };
      await service.enrichToken(token, {}, 'realm');

      expect(plugin.enrichToken).not.toHaveBeenCalled();
    });
  });
});
