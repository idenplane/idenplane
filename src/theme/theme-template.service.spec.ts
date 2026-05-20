import { ThemeTemplateService } from './theme-template.service.js';

jest.mock('fs', () => ({
  existsSync: jest.fn(),
}));

import { existsSync } from 'fs';
const mockedExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;

describe('ThemeTemplateService', () => {
  let service: ThemeTemplateService;
  let themeService: {
    getInheritanceChain: jest.Mock;
    getThemesDir: jest.Mock;
  };

  beforeEach(() => {
    themeService = {
      getInheritanceChain: jest.fn(),
      getThemesDir: jest.fn().mockReturnValue('/app/themes'),
    };
    service = new ThemeTemplateService(themeService as any);
    jest.clearAllMocks();
    themeService.getThemesDir.mockReturnValue('/app/themes');
  });

  describe('resolve', () => {
    it('should return template from first theme in chain', () => {
      themeService.getInheritanceChain.mockReturnValue(['dark', 'idenplane']);
      mockedExistsSync.mockReturnValueOnce(true); // dark has the template

      const result = service.resolve('dark', 'login', 'login');

      expect(result).toMatch(/dark[/\\]login[/\\]templates[/\\]login\.hbs/);
    });

    it('should fall back to parent theme if child has no template', () => {
      themeService.getInheritanceChain.mockReturnValue(['dark', 'idenplane']);
      mockedExistsSync
        .mockReturnValueOnce(false) // dark doesn't have it
        .mockReturnValueOnce(true); // idenplane does

      const result = service.resolve('dark', 'login', 'login');

      expect(result).toMatch(/idenplane[/\\]login[/\\]templates[/\\]login\.hbs/);
    });

    it('should throw if template not found in any theme', () => {
      themeService.getInheritanceChain.mockReturnValue(['dark', 'idenplane']);
      mockedExistsSync.mockReturnValue(false);

      expect(() => service.resolve('dark', 'login', 'nonexistent')).toThrow(
        /Template not found: nonexistent/,
      );
    });

    it('should include inheritance chain in error message', () => {
      themeService.getInheritanceChain.mockReturnValue(['dark', 'idenplane']);
      mockedExistsSync.mockReturnValue(false);

      expect(() => service.resolve('dark', 'login', 'missing')).toThrow(
        /dark → idenplane/,
      );
    });

    it('should resolve nested template names (layouts/main)', () => {
      themeService.getInheritanceChain.mockReturnValue(['idenplane']);
      mockedExistsSync.mockReturnValueOnce(true);

      const result = service.resolve('idenplane', 'login', 'layouts/main');

      expect(result).toMatch(/layouts[/\\]main\.hbs/);
    });
  });

  describe('exists', () => {
    it('should return true when template exists', () => {
      themeService.getInheritanceChain.mockReturnValue(['idenplane']);
      mockedExistsSync.mockReturnValueOnce(true);

      expect(service.exists('idenplane', 'login', 'login')).toBe(true);
    });

    it('should return false when template does not exist', () => {
      themeService.getInheritanceChain.mockReturnValue(['idenplane']);
      mockedExistsSync.mockReturnValue(false);

      expect(service.exists('idenplane', 'login', 'nonexistent')).toBe(false);
    });
  });
});
