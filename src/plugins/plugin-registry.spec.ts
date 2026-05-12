import { PluginRegistry } from './plugin-registry.js';
import type { AuthMePlugin, EventListenerPlugin } from './plugin.interface.js';

const makePlugin = (overrides: Partial<AuthMePlugin> = {}): AuthMePlugin => ({
  name: 'test-plugin',
  version: '1.0.0',
  type: 'event-listener',
  ...overrides,
});

describe('PluginRegistry', () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = new PluginRegistry();
  });

  // ─── register ───────────────────────────────────────────────────────────────

  describe('register', () => {
    it('should register a new plugin and report correct size', () => {
      const plugin = makePlugin();
      registry.register(plugin);
      expect(registry.size).toBe(1);
    });

    it('should set enabled to true by default', () => {
      const plugin = makePlugin();
      registry.register(plugin);
      expect(registry.get('test-plugin')?.enabled).toBe(true);
    });

    it('should set enabled to false when passed as false', () => {
      const plugin = makePlugin();
      registry.register(plugin, false);
      expect(registry.get('test-plugin')?.enabled).toBe(false);
    });

    it('should overwrite an existing entry when registering same name', () => {
      const v1 = makePlugin({ version: '1.0.0' });
      const v2 = makePlugin({ version: '2.0.0' });
      registry.register(v1);
      registry.register(v2);
      expect(registry.size).toBe(1);
      expect(registry.get('test-plugin')?.plugin.version).toBe('2.0.0');
    });

    it('should record the loadedAt timestamp', () => {
      const before = new Date();
      const plugin = makePlugin();
      registry.register(plugin);
      const entry = registry.get('test-plugin');
      expect(entry?.loadedAt).toBeInstanceOf(Date);
      expect(entry!.loadedAt.getTime()).toBeGreaterThanOrEqual(
        before.getTime(),
      );
    });
  });

  // ─── unregister ─────────────────────────────────────────────────────────────

  describe('unregister', () => {
    it('should remove an existing plugin and return true', () => {
      registry.register(makePlugin());
      const result = registry.unregister('test-plugin');
      expect(result).toBe(true);
      expect(registry.size).toBe(0);
    });

    it('should return false when the plugin does not exist', () => {
      const result = registry.unregister('nonexistent');
      expect(result).toBe(false);
    });
  });

  // ─── setEnabled ─────────────────────────────────────────────────────────────

  describe('setEnabled', () => {
    it('should change the enabled flag', () => {
      registry.register(makePlugin());
      registry.setEnabled('test-plugin', false);
      expect(registry.isEnabled('test-plugin')).toBe(false);
      registry.setEnabled('test-plugin', true);
      expect(registry.isEnabled('test-plugin')).toBe(true);
    });

    it('should throw when the plugin is not registered', () => {
      expect(() => registry.setEnabled('missing', true)).toThrow();
    });
  });

  // ─── getAll / getEnabled ─────────────────────────────────────────────────────

  describe('getAll', () => {
    it('should return all registered entries', () => {
      registry.register(makePlugin({ name: 'a' }));
      registry.register(makePlugin({ name: 'b' }), false);
      expect(registry.getAll()).toHaveLength(2);
    });
  });

  describe('getEnabled', () => {
    it('should return only enabled entries', () => {
      registry.register(makePlugin({ name: 'enabled' }), true);
      registry.register(makePlugin({ name: 'disabled' }), false);
      const enabled = registry.getEnabled();
      expect(enabled).toHaveLength(1);
      expect(enabled[0].plugin.name).toBe('enabled');
    });
  });

  // ─── getEnabledByType ────────────────────────────────────────────────────────

  describe('getEnabledByType', () => {
    it('should return only enabled plugins of the requested type', () => {
      registry.register(
        makePlugin({ name: 'listener', type: 'event-listener' }),
        true,
      );
      registry.register(
        makePlugin({ name: 'enricher', type: 'token-enrichment' }),
        true,
      );
      registry.register(
        makePlugin({ name: 'disabled-listener', type: 'event-listener' }),
        false,
      );

      const listeners =
        registry.getEnabledByType<EventListenerPlugin>('event-listener');
      expect(listeners).toHaveLength(1);
      expect(listeners[0].name).toBe('listener');
    });

    it('should return an empty array when no matching plugins are enabled', () => {
      registry.register(
        makePlugin({ name: 'enricher', type: 'token-enrichment' }),
        true,
      );
      const themes = registry.getEnabledByType('theme');
      expect(themes).toHaveLength(0);
    });
  });

  // ─── isEnabled ───────────────────────────────────────────────────────────────

  describe('isEnabled', () => {
    it('should return false for unknown plugins', () => {
      expect(registry.isEnabled('unknown')).toBe(false);
    });
  });
});
