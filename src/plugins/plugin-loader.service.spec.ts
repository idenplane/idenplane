import { PluginLoaderService } from './plugin-loader.service.js';
import * as fs from 'fs';
import * as path from 'path';

// Mock the entire 'fs' module so we don't touch the real filesystem
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readdirSync: jest.fn(),
}));

const mockExistsSync = fs.existsSync as jest.Mock;
const mockReaddirSync = fs.readdirSync as jest.Mock;

describe('PluginLoaderService', () => {
  let service: PluginLoaderService;

  beforeEach(() => {
    service = new PluginLoaderService();
    jest.clearAllMocks();
  });

  // ─── validatePlugin ──────────────────────────────────────────────────────────

  describe('validatePlugin', () => {
    it('should return true for a valid event-listener plugin shape', () => {
      const valid = {
        name: 'my-plugin',
        version: '1.0.0',
        type: 'event-listener',
      };
      expect(service.validatePlugin(valid)).toBe(true);
    });

    it('should return true for all valid types', () => {
      for (const type of [
        'auth-provider',
        'event-listener',
        'token-enrichment',
        'theme',
      ]) {
        expect(
          service.validatePlugin({ name: 'p', version: '1.0.0', type }),
        ).toBe(true);
      }
    });

    it('should return false when name is missing', () => {
      expect(
        service.validatePlugin({ version: '1.0.0', type: 'event-listener' }),
      ).toBe(false);
    });

    it('should return false when version is missing', () => {
      expect(
        service.validatePlugin({ name: 'p', type: 'event-listener' }),
      ).toBe(false);
    });

    it('should return false when type is invalid', () => {
      expect(
        service.validatePlugin({
          name: 'p',
          version: '1.0.0',
          type: 'unknown-type',
        }),
      ).toBe(false);
    });

    it('should return false for null', () => {
      expect(service.validatePlugin(null)).toBe(false);
    });

    it('should return false for a string', () => {
      expect(service.validatePlugin('not-an-object')).toBe(false);
    });

    it('should return false for an empty object', () => {
      expect(service.validatePlugin({})).toBe(false);
    });
  });

  // ─── discoverFromDirectory ───────────────────────────────────────────────────

  describe('discoverFromDirectory', () => {
    it('should return empty array when the plugins directory does not exist', async () => {
      mockExistsSync.mockReturnValue(false);
      const result = await service.discoverFromDirectory('/no/such/dir');
      expect(result).toEqual([]);
    });

    it('should return empty array when the directory has no subdirectories', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([]);
      const result = await service.discoverFromDirectory('/plugins');
      expect(result).toEqual([]);
    });

    it('should skip a subdirectory that has no index file', async () => {
      mockExistsSync.mockImplementation((p: string) => {
        // plugins dir exists, but index files do not
        if (p === '/plugins') return true;
        return false;
      });
      mockReaddirSync.mockReturnValue([
        { isDirectory: () => true, name: 'my-plugin' },
      ]);

      const result = await service.discoverFromDirectory('/plugins');
      expect(result).toHaveLength(0);
    });

    it('should handle readdirSync errors gracefully', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockImplementation(() => {
        throw new Error('permission denied');
      });

      const result = await service.discoverFromDirectory('/plugins');
      expect(result).toEqual([]);
    });
  });

  // ─── discoverFromNpm ─────────────────────────────────────────────────────────

  describe('discoverFromNpm', () => {
    it('should return empty array when node_modules does not exist', async () => {
      mockExistsSync.mockReturnValue(false);
      const result = await service.discoverFromNpm('/node_modules');
      expect(result).toEqual([]);
    });

    it('should only consider packages with idenplane-plugin- prefix', async () => {
      mockExistsSync.mockImplementation((p: string) => {
        return p === '/node_modules';
      });
      mockReaddirSync.mockReturnValue([
        { isDirectory: () => true, name: 'some-other-package' },
        { isDirectory: () => true, name: 'idenplane-plugin-example' },
      ]);

      // No index file present → skip gracefully
      const result = await service.discoverFromNpm('/node_modules');
      // idenplane-plugin-example has no index file so it won't load, but it was considered
      expect(result).toHaveLength(0);
    });

    it('should handle readdirSync errors for npm directory gracefully', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockImplementation(() => {
        throw new Error('EACCES');
      });

      const result = await service.discoverFromNpm('/node_modules');
      expect(result).toEqual([]);
    });
  });

  // ─── discoverAll ─────────────────────────────────────────────────────────────

  describe('discoverAll', () => {
    it('should combine directory and npm results', async () => {
      // Both dirs do not exist → both return []
      mockExistsSync.mockReturnValue(false);

      const result = await service.discoverAll('/plugins', '/node_modules');
      expect(result).toEqual([]);
    });
  });
});
