import { ThemeMessageService } from './theme-message.service.js';

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
}));

import { existsSync, readFileSync } from 'fs';

const mockedExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;
const mockedReadFileSync = readFileSync as jest.MockedFunction<
  typeof readFileSync
>;

describe('ThemeMessageService', () => {
  let service: ThemeMessageService;
  let themeService: {
    getInheritanceChain: jest.Mock;
    getThemesDir: jest.Mock;
    getAvailableThemes: jest.Mock;
  };

  beforeEach(() => {
    themeService = {
      getInheritanceChain: jest.fn(),
      getThemesDir: jest.fn().mockReturnValue('/app/themes'),
      getAvailableThemes: jest.fn().mockReturnValue([]),
    };
    service = new ThemeMessageService(themeService as any);
    jest.clearAllMocks();
    themeService.getThemesDir.mockReturnValue('/app/themes');
    themeService.getAvailableThemes.mockReturnValue([]);
  });

  describe('getMessages', () => {
    it('should load and merge messages from theme chain (base first)', () => {
      themeService.getInheritanceChain.mockReturnValue(['child', 'base']);
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync
        .mockReturnValueOnce('greeting=Hello from base\nfarewell=Goodbye')
        .mockReturnValueOnce('greeting=Hello from child\nnewKey=New');

      const messages = service.getMessages('child', 'login', 'en');

      // Child should override base
      expect(messages['greeting']).toBe('Hello from child');
      expect(messages['farewell']).toBe('Goodbye');
      expect(messages['newKey']).toBe('New');
    });

    it('should cache messages', () => {
      themeService.getInheritanceChain.mockReturnValue(['base']);
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue('key=value');

      const first = service.getMessages('base', 'login', 'en');
      const second = service.getMessages('base', 'login', 'en');

      expect(first).toBe(second); // Same reference = cached
      expect(mockedReadFileSync).toHaveBeenCalledTimes(1);
    });

    it('should handle missing message files gracefully', () => {
      themeService.getInheritanceChain.mockReturnValue(['base']);
      mockedExistsSync.mockReturnValue(false);

      const messages = service.getMessages('base', 'login', 'en');

      expect(messages).toEqual({});
    });

    it('should skip comments and empty lines in properties files', () => {
      themeService.getInheritanceChain.mockReturnValue(['base']);
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(
        '# This is a comment\n! Another comment\n\nkey1=value1\nkey2=value2\n',
      );

      const messages = service.getMessages('base', 'login', 'en');

      expect(messages).toEqual({ key1: 'value1', key2: 'value2' });
    });

    it('should handle values with equals signs', () => {
      themeService.getInheritanceChain.mockReturnValue(['base']);
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue('url=https://example.com?a=1&b=2');

      const messages = service.getMessages('base', 'login', 'en');

      expect(messages['url']).toBe('https://example.com?a=1&b=2');
    });

    it('should fall back to English when locale has no messages', () => {
      themeService.getInheritanceChain.mockReturnValue(['base']);

      // First call for 'fr' — no file
      mockedExistsSync.mockReturnValueOnce(false);
      // Fallback to 'en' — has file
      mockedExistsSync.mockReturnValueOnce(true);
      mockedReadFileSync.mockReturnValue('greeting=Hello');

      const messages = service.getMessages('base', 'login', 'fr');

      expect(messages['greeting']).toBe('Hello');
    });

    it('should not fall back if locale is already en', () => {
      themeService.getInheritanceChain.mockReturnValue(['base']);
      mockedExistsSync.mockReturnValue(false);

      const messages = service.getMessages('base', 'login', 'en');

      expect(messages).toEqual({});
    });
  });

  describe('clearCache', () => {
    it('should clear the message cache', () => {
      themeService.getInheritanceChain.mockReturnValue(['base']);
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue('key=value');

      service.getMessages('base', 'login', 'en');
      service.clearCache();

      // After clearing, should read from file again
      service.getMessages('base', 'login', 'en');

      expect(mockedReadFileSync).toHaveBeenCalledTimes(2);
    });
  });

  describe('onModuleInit', () => {
    it('should pre-load messages for all themes and types', async () => {
      themeService.getAvailableThemes.mockReturnValue([
        { name: 'idenplane' },
        { name: 'dark' },
      ]);
      themeService.getInheritanceChain.mockReturnValue(['idenplane']);
      mockedExistsSync.mockReturnValue(false);

      await service.onModuleInit();

      // 2 themes × 3 types = 6 calls
      expect(themeService.getInheritanceChain).toHaveBeenCalledTimes(6);
    });
  });
});
