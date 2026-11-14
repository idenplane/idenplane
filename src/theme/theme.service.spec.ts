import { ThemeService } from './theme.service.js';
import type { Realm } from '@prisma/client';

// Mock fs/promises
jest.mock('fs/promises', () => ({
  readdir: jest.fn(),
  readFile: jest.fn(),
}));

import { readdir, readFile } from 'fs/promises';

const mockedReaddir = readdir as jest.MockedFunction<typeof readdir>;
const mockedReadFile = readFile as jest.MockedFunction<typeof readFile>;

/** readFile answers from `files`, keyed by path under themes/; else ENOENT. */
function serveFiles(files: Record<string, string>) {
  mockedReadFile.mockImplementation((async (path: unknown) => {
    const rel = String(path)
      .split('\\')
      .join('/')
      .split('/themes/')
      .pop() as string;
    if (rel in files) return files[rel];
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  }) as any);
}

describe('ThemeService', () => {
  let service: ThemeService;

  beforeEach(() => {
    service = new ThemeService();
    jest.clearAllMocks();
  });

  describe('onModuleInit / loadThemes', () => {
    it('should load themes from the themes directory', async () => {
      mockedReaddir.mockResolvedValue([
        { name: 'idenplane', isDirectory: () => true } as any,
        { name: 'dark', isDirectory: () => true } as any,
        { name: 'readme.txt', isDirectory: () => false } as any,
      ]);
      mockedReadFile
        .mockResolvedValueOnce(
          JSON.stringify({
            name: 'idenplane',
            displayName: 'Idenplane Default',
            description: 'Default theme',
            colors: { primaryColor: '#2563eb' },
            types: { login: { css: ['login.css'] } },
          }),
        )
        .mockResolvedValueOnce(
          JSON.stringify({
            name: 'dark',
            displayName: 'Dark',
            parent: 'idenplane',
            colors: { primaryColor: '#1e40af' },
            types: { login: { css: ['dark.css'] } },
          }),
        );

      await service.onModuleInit();

      expect(service.getTheme('idenplane')).toBeDefined();
      expect(service.getTheme('dark')).toBeDefined();
      expect(service.getTheme('idenplane')!.displayName).toBe(
        'Idenplane Default',
      );
    });

    it('should handle missing themes directory', async () => {
      mockedReaddir.mockRejectedValue(new Error('ENOENT'));

      await service.onModuleInit();

      expect(service.getAvailableThemes()).toHaveLength(0);
    });

    it('should skip themes with invalid theme.json', async () => {
      mockedReaddir.mockResolvedValue([
        { name: 'bad-theme', isDirectory: () => true } as any,
      ]);
      mockedReadFile.mockRejectedValue(new Error('ENOENT'));

      await service.onModuleInit();

      expect(service.getTheme('bad-theme')).toBeUndefined();
    });

    it('should normalize themes missing parent and types', async () => {
      mockedReaddir.mockResolvedValue([
        { name: 'minimal', isDirectory: () => true } as any,
      ]);
      mockedReadFile.mockResolvedValue(
        JSON.stringify({
          name: 'minimal',
          displayName: 'Minimal',
          colors: { primaryColor: '#000' },
        }),
      );

      await service.onModuleInit();

      const theme = service.getTheme('minimal');
      expect((theme as any).parent).toBeNull();
      expect(theme!.types).toEqual({});
    });
  });

  describe('getThemesDir', () => {
    it('should return a path ending in themes', () => {
      expect(service.getThemesDir()).toMatch(/themes$/);
    });
  });

  describe('getAvailableThemes', () => {
    it('should return theme info for all loaded themes', async () => {
      mockedReaddir.mockResolvedValue([
        { name: 'idenplane', isDirectory: () => true } as any,
      ]);
      serveFiles({
        'idenplane/theme.json': JSON.stringify({
          name: 'idenplane',
          displayName: 'Idenplane',
          description: 'Default',
          colors: { primaryColor: '#2563eb' },
        }),
      });

      await service.onModuleInit();

      const themes = service.getAvailableThemes();
      expect(themes).toHaveLength(1);
      expect(themes[0]).toEqual({
        name: 'idenplane',
        displayName: 'Idenplane',
        description: 'Default',
        colors: { primaryColor: '#2563eb' },
        warnings: [],
      });
    });
  });

  describe('login template warnings', () => {
    const GOOD =
      '{{#unless passwordFormHidden}}<form><input name="password"></form>{{/unless}}';
    const IGNORES_FLAG =
      '{{!-- passkeyOnly --}}<form><input name="password"></form>';

    const theme = (name: string, parent: string | null = null) =>
      JSON.stringify({ name, displayName: name, parent, colors: {} });

    async function load(files: Record<string, string>) {
      const dirs = [...new Set(Object.keys(files).map((f) => f.split('/')[0]))];
      mockedReaddir.mockResolvedValue(
        dirs.map((name) => ({ name, isDirectory: () => true })) as any,
      );
      serveFiles(files);
      await service.onModuleInit();
    }

    const warningsOf = (name: string) =>
      service.getAvailableThemes().find((t) => t.name === name)?.warnings;

    it('warns about a theme whose own login.hbs ignores passkeyOnly and passwordFormHidden', async () => {
      await load({
        'brand/theme.json': theme('brand', 'base'),
        'brand/login/templates/login.hbs': IGNORES_FLAG,
        'base/theme.json': theme('base'),
        'base/login/templates/login.hbs': GOOD,
      });
      expect(warningsOf('brand')).toEqual([
        expect.stringMatching(/does not read passkeyOnly/),
      ]);
      expect(warningsOf('base')).toEqual([]);
    });

    it('does not warn about a theme that inherits a login.hbs honouring the flag', async () => {
      await load({
        'child/theme.json': theme('child', 'base'),
        'child/login/resources/css/x.css': '',
        'base/theme.json': theme('base'),
        'base/login/templates/login.hbs': GOOD,
      });
      expect(warningsOf('child')).toEqual([]);
    });

    it('lists the warning of an inherited login.hbs, naming the theme that owns it', async () => {
      await load({
        'child/theme.json': theme('child', 'brand'),
        'brand/theme.json': theme('brand'),
        'brand/login/templates/login.hbs': IGNORES_FLAG,
      });
      expect(warningsOf('child')).toEqual([
        expect.stringMatching(/^Inherited from theme "brand": login.hbs/),
      ]);
    });

    it('never fails loading: a template that does not parse is a warning too', async () => {
      await load({
        'broken/theme.json': theme('broken'),
        'broken/login/templates/login.hbs': '{{#if passkeyOnly}}',
      });
      expect(service.getTheme('broken')).toBeDefined();
      expect(warningsOf('broken')).toEqual([
        expect.stringMatching(/does not parse/),
      ]);
    });
  });

  describe('getInheritanceChain', () => {
    beforeEach(async () => {
      mockedReaddir.mockResolvedValue([
        { name: 'base', isDirectory: () => true } as any,
        { name: 'child', isDirectory: () => true } as any,
        { name: 'grandchild', isDirectory: () => true } as any,
      ]);
      mockedReadFile
        .mockResolvedValueOnce(
          JSON.stringify({
            name: 'base',
            displayName: 'Base',
            colors: {},
          }),
        )
        .mockResolvedValueOnce(
          JSON.stringify({
            name: 'child',
            displayName: 'Child',
            parent: 'base',
            colors: {},
          }),
        )
        .mockResolvedValueOnce(
          JSON.stringify({
            name: 'grandchild',
            displayName: 'Grandchild',
            parent: 'child',
            colors: {},
          }),
        );

      await service.onModuleInit();
    });

    it('should return single-element chain for root theme', () => {
      expect(service.getInheritanceChain('base')).toEqual(['base']);
    });

    it('should return child-to-root chain', () => {
      expect(service.getInheritanceChain('child')).toEqual(['child', 'base']);
    });

    it('should return full chain for deeply nested theme', () => {
      expect(service.getInheritanceChain('grandchild')).toEqual([
        'grandchild',
        'child',
        'base',
      ]);
    });

    it('should return single element for unknown theme', () => {
      expect(service.getInheritanceChain('unknown')).toEqual(['unknown']);
    });

    it('should prevent circular references', async () => {
      // Manually set up circular chain scenario
      mockedReaddir.mockResolvedValue([
        { name: 'a', isDirectory: () => true } as any,
        { name: 'b', isDirectory: () => true } as any,
      ]);
      mockedReadFile
        .mockResolvedValueOnce(
          JSON.stringify({
            name: 'a',
            displayName: 'A',
            parent: 'b',
            colors: {},
          }),
        )
        .mockResolvedValueOnce(
          JSON.stringify({
            name: 'b',
            displayName: 'B',
            parent: 'a',
            colors: {},
          }),
        );

      const circularService = new ThemeService();
      await circularService.onModuleInit();

      const chain = circularService.getInheritanceChain('a');
      expect(chain).toEqual(['a', 'b']); // Should stop when cycle detected
    });
  });

  describe('resolveCss', () => {
    beforeEach(async () => {
      mockedReaddir.mockResolvedValue([
        { name: 'base', isDirectory: () => true } as any,
        { name: 'child', isDirectory: () => true } as any,
      ]);
      mockedReadFile
        .mockResolvedValueOnce(
          JSON.stringify({
            name: 'base',
            displayName: 'Base',
            colors: {},
            types: { login: { css: ['base.css'] } },
          }),
        )
        .mockResolvedValueOnce(
          JSON.stringify({
            name: 'child',
            displayName: 'Child',
            parent: 'base',
            colors: {},
            types: { login: { css: ['child.css'] } },
          }),
        );

      await service.onModuleInit();
    });

    it('should return CSS files in base-to-child order', () => {
      const css = service.resolveCss('child', 'login');

      expect(css).toEqual([
        '/themes/base/login/resources/base.css',
        '/themes/child/login/resources/child.css',
      ]);
    });

    it('should return only base CSS for root theme', () => {
      const css = service.resolveCss('base', 'login');
      expect(css).toEqual(['/themes/base/login/resources/base.css']);
    });

    it('should return empty array for theme type with no CSS', () => {
      const css = service.resolveCss('base', 'email');
      expect(css).toEqual([]);
    });
  });

  describe('resolveColors', () => {
    beforeEach(async () => {
      mockedReaddir.mockResolvedValue([
        { name: 'idenplane', isDirectory: () => true } as any,
      ]);
      mockedReadFile.mockResolvedValue(
        JSON.stringify({
          name: 'idenplane',
          displayName: 'Idenplane',
          colors: {
            primaryColor: '#2563eb',
            backgroundColor: '#f0f2f5',
            cardColor: '#ffffff',
            textColor: '#1a1a2e',
            labelColor: '#374151',
            inputBorderColor: '#d1d5db',
            inputBgColor: '#ffffff',
            mutedColor: '#6b7280',
          },
        }),
      );

      await service.onModuleInit();
    });

    it('inherits the colours a theme leaves out from its parent, then the defaults', async () => {
      mockedReaddir.mockResolvedValue([
        { name: 'base', isDirectory: () => true } as any,
        { name: 'child', isDirectory: () => true } as any,
      ]);
      serveFiles({
        'base/theme.json': JSON.stringify({
          name: 'base',
          colors: { primaryColor: '#111111', cardColor: '#222222' },
        }),
        'child/theme.json': JSON.stringify({
          name: 'child',
          parent: 'base',
          colors: { primaryColor: '#333333' },
        }),
      });
      await service.onModuleInit();

      const colors = service.resolveColors('child', { theme: {} } as any);
      expect(colors.primaryColor).toBe('#333333');
      expect(colors.cardColor).toBe('#222222');
      expect(colors.textColor).toBe('#1a1a2e');
      expect(colors.primaryHoverColor).toMatch(/^#[0-9a-f]{6}$/);

      // No colours at all: the defaults, never a crash.
      expect(
        service.resolveColors('missing', { theme: {} } as any).primaryColor,
      ).toBe('#2563eb');
    });

    it('should return theme colors with defaults', () => {
      const realm = { theme: {} } as any as Realm;
      const colors = service.resolveColors('idenplane', realm);

      expect(colors.primaryColor).toBe('#2563eb');
      expect(colors.backgroundColor).toBe('#f0f2f5');
      expect(colors.logoUrl).toBe('');
      expect(colors.appTitle).toBe('Idenplane');
    });

    it('should apply per-realm color overrides', () => {
      const realm = {
        theme: {
          primaryColor: '#ff0000',
          logoUrl: '/my-logo.png',
          appTitle: 'My App',
        },
      } as any as Realm;

      const colors = service.resolveColors('idenplane', realm);

      expect(colors.primaryColor).toBe('#ff0000');
      expect(colors.logoUrl).toBe('/my-logo.png');
      expect(colors.appTitle).toBe('My App');
    });

    it('should use default colors for unknown theme', () => {
      const realm = { theme: {} } as any as Realm;
      const colors = service.resolveColors('nonexistent', realm);

      expect(colors.primaryColor).toBe('#2563eb'); // default color
    });

    it('should compute primaryHoverColor from primaryColor', () => {
      const realm = { theme: {} } as any as Realm;
      const colors = service.resolveColors('idenplane', realm);

      expect(colors.primaryHoverColor).toBeDefined();
      expect(colors.primaryHoverColor).not.toBe(colors.primaryColor);
    });

    it('should use realm primaryHoverColor override', () => {
      const realm = {
        theme: { primaryHoverColor: '#0000ff' },
      } as any as Realm;

      const colors = service.resolveColors('idenplane', realm);
      expect(colors.primaryHoverColor).toBe('#0000ff');
    });
  });

  describe('resolveTheme', () => {
    beforeEach(async () => {
      mockedReaddir.mockResolvedValue([
        { name: 'idenplane', isDirectory: () => true } as any,
      ]);
      mockedReadFile.mockResolvedValue(
        JSON.stringify({
          name: 'idenplane',
          displayName: 'Idenplane',
          colors: {
            primaryColor: '#2563eb',
            backgroundColor: '#f0f2f5',
            cardColor: '#fff',
            textColor: '#1a1a2e',
            labelColor: '#374151',
            inputBorderColor: '#d1d5db',
            inputBgColor: '#fff',
            mutedColor: '#6b7280',
          },
          types: { login: { css: ['styles.css'] } },
        }),
      );

      await service.onModuleInit();
    });

    it('should resolve colors and CSS together', () => {
      const realm = {
        loginTheme: 'idenplane',
        themeName: 'idenplane',
        theme: {},
      } as any as Realm;

      const resolved = service.resolveTheme(realm);

      expect(resolved.primaryColor).toBeDefined();
      expect(resolved.themeCssFiles).toContain(
        '/themes/idenplane/login/resources/styles.css',
      );
    });

    it('should fall back to themeName if loginTheme is not set', () => {
      const realm = {
        loginTheme: null,
        themeName: 'idenplane',
        theme: {},
      } as any as Realm;

      const resolved = service.resolveTheme(realm);
      expect(resolved.themeCssFiles).toHaveLength(1);
    });

    it('should fall back to "idenplane" if no theme fields are set', () => {
      const realm = {
        loginTheme: null,
        themeName: null,
        theme: {},
      } as any as Realm;

      const resolved = service.resolveTheme(realm);
      expect(resolved.primaryColor).toBeDefined();
    });
  });

  describe('getRealmThemeName', () => {
    it('should return loginTheme for login type', () => {
      const realm = { loginTheme: 'dark', themeName: 'idenplane' } as any;
      expect(service.getRealmThemeName(realm, 'login')).toBe('dark');
    });

    it('should return accountTheme for account type', () => {
      const realm = { accountTheme: 'custom', themeName: 'idenplane' } as any;
      expect(service.getRealmThemeName(realm, 'account')).toBe('custom');
    });

    it('should return emailTheme for email type', () => {
      const realm = { emailTheme: 'branded', themeName: 'idenplane' } as any;
      expect(service.getRealmThemeName(realm, 'email')).toBe('branded');
    });

    it('should fall back to themeName when specific theme is not set', () => {
      const realm = { loginTheme: null, themeName: 'custom' } as any;
      expect(service.getRealmThemeName(realm, 'login')).toBe('custom');
    });

    it('should fall back to "idenplane" when nothing is set', () => {
      const realm = { loginTheme: null, themeName: null } as any;
      expect(service.getRealmThemeName(realm, 'login')).toBe('idenplane');
    });
  });
});
