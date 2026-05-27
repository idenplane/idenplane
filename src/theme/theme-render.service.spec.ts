import { ThemeRenderService, sanitizeCss } from './theme-render.service.js';

describe('ThemeRenderService', () => {
  let service: ThemeRenderService;
  let themeService: {
    getRealmThemeName: jest.Mock;
    getThemesDir: jest.Mock;
    resolveColors: jest.Mock;
    resolveCss: jest.Mock;
  };
  let templateService: {
    resolve: jest.Mock;
  };
  let messageService: {
    getMessages: jest.Mock;
  };
  let i18nService: {
    detectLocale: jest.Mock;
    isRtl: jest.Mock;
  };

  const mockRealm = {
    name: 'test-realm',
    displayName: 'Test Realm',
    theme: {},
    defaultLocale: 'en',
  } as any;

  let mockRes: { render: jest.Mock; setHeader: jest.Mock };
  let mockReq: {
    query: Record<string, string>;
    headers: Record<string, string>;
  };

  beforeEach(() => {
    themeService = {
      getRealmThemeName: jest.fn().mockReturnValue('idenplane'),
      getThemesDir: jest.fn().mockReturnValue('/app/themes'),
      resolveColors: jest.fn().mockReturnValue({
        primaryColor: '#2563eb',
        backgroundColor: '#f0f2f5',
      }),
      resolveCss: jest
        .fn()
        .mockReturnValue(['/themes/idenplane/login/resources/styles.css']),
    };
    templateService = {
      resolve: jest
        .fn()
        .mockReturnValueOnce('/app/themes/idenplane/login/templates/login.hbs')
        .mockReturnValueOnce(
          '/app/themes/idenplane/login/templates/layouts/main.hbs',
        ),
    };
    messageService = {
      getMessages: jest.fn().mockReturnValue({ loginTitle: 'Sign In' }),
    };
    i18nService = {
      detectLocale: jest.fn().mockReturnValue('en'),
      isRtl: jest.fn().mockReturnValue(false),
    };

    service = new ThemeRenderService(
      themeService as any,
      templateService as any,
      messageService as any,
      i18nService as any,
    );

    mockRes = { render: jest.fn(), setHeader: jest.fn() };
    mockReq = { query: {}, headers: {} };
  });

  describe('render', () => {
    it('should call res.render with correct template and data', () => {
      service.render(
        mockRes as any,
        mockRealm,
        'login',
        'login',
        {
          formAction: '/login',
        },
        mockReq as any,
      );

      expect(mockRes.render).toHaveBeenCalledTimes(1);

      const [template, data] = mockRes.render.mock.calls[0];

      // Template should be relative to themes dir
      expect(template).toMatch(/idenplane[/\\]login[/\\]templates[/\\]login\.hbs/);

      // Data should include merged colors, messages, and page data
      expect(data.formAction).toBe('/login');
      expect(data.primaryColor).toBe('#2563eb');
      expect(data._messages).toEqual({ loginTitle: 'Sign In' });
      expect(data.themeCssFiles).toEqual([
        '/themes/idenplane/login/resources/styles.css',
      ]);
      expect(data.realmName).toBe('test-realm');
      expect(data.realmDisplayName).toBe('Test Realm');
    });

    it('should resolve theme name from realm', () => {
      service.render(
        mockRes as any,
        mockRealm,
        'login',
        'login',
        {},
        mockReq as any,
      );

      expect(themeService.getRealmThemeName).toHaveBeenCalledWith(
        mockRealm,
        'login',
      );
    });

    it('should resolve both template and layout', () => {
      service.render(
        mockRes as any,
        mockRealm,
        'login',
        'login',
        {},
        mockReq as any,
      );

      expect(templateService.resolve).toHaveBeenCalledTimes(2);
      expect(templateService.resolve).toHaveBeenCalledWith(
        'idenplane',
        'login',
        'login',
      );
      expect(templateService.resolve).toHaveBeenCalledWith(
        'idenplane',
        'login',
        'layouts/main',
      );
    });

    it('should include layout as relative path', () => {
      service.render(
        mockRes as any,
        mockRealm,
        'login',
        'login',
        {},
        mockReq as any,
      );

      const [, data] = mockRes.render.mock.calls[0];
      expect(data.layout).toMatch(/layouts[/\\]main\.hbs/);
    });

    it('should use data.realmName over realm.name when provided', () => {
      service.render(
        mockRes as any,
        mockRealm,
        'login',
        'login',
        {
          realmName: 'custom-name',
          realmDisplayName: 'Custom Display',
        },
        mockReq as any,
      );

      const [, data] = mockRes.render.mock.calls[0];
      expect(data.realmName).toBe('custom-name');
      expect(data.realmDisplayName).toBe('Custom Display');
    });

    it('should fall back to realm.name when data.realmName is not set', () => {
      service.render(
        mockRes as any,
        mockRealm,
        'login',
        'login',
        {},
        mockReq as any,
      );

      const [, data] = mockRes.render.mock.calls[0];
      expect(data.realmName).toBe('test-realm');
    });

    it('should fall back to realm.name when displayName is null', () => {
      const realmNoDisplay = { ...mockRealm, displayName: null };

      service.render(
        mockRes as any,
        realmNoDisplay,
        'login',
        'login',
        {},
        mockReq as any,
      );

      const [, data] = mockRes.render.mock.calls[0];
      expect(data.realmDisplayName).toBe('test-realm');
    });

    it('should detect locale from request', () => {
      i18nService.detectLocale.mockReturnValue('fr');
      i18nService.isRtl.mockReturnValue(false);

      service.render(
        mockRes as any,
        mockRealm,
        'login',
        'login',
        {},
        mockReq as any,
      );

      expect(i18nService.detectLocale).toHaveBeenCalledWith(mockReq);
      const [, data] = mockRes.render.mock.calls[0];
      expect(data.locale).toBe('fr');
      expect(data.dir).toBe('ltr');
    });

    it('should set dir="rtl" for Arabic locale', () => {
      i18nService.detectLocale.mockReturnValue('ar');
      i18nService.isRtl.mockReturnValue(true);

      service.render(
        mockRes as any,
        mockRealm,
        'login',
        'login',
        {},
        mockReq as any,
      );

      const [, data] = mockRes.render.mock.calls[0];
      expect(data.locale).toBe('ar');
      expect(data.dir).toBe('rtl');
      expect(data.isRtl).toBe(true);
    });

    it('should include languageSwitcher array in template data', () => {
      service.render(
        mockRes as any,
        mockRealm,
        'login',
        'login',
        {},
        mockReq as any,
      );

      const [, data] = mockRes.render.mock.calls[0];
      expect(Array.isArray(data.languageSwitcher)).toBe(true);
      expect(data.languageSwitcher.length).toBeGreaterThan(0);
      const enEntry = data.languageSwitcher.find((l: any) => l.code === 'en');
      expect(enEntry).toBeDefined();
      expect(enEntry.active).toBe(true);
    });

    it('should pass messages with detected locale to messageService', () => {
      i18nService.detectLocale.mockReturnValue('de');

      service.render(
        mockRes as any,
        mockRealm,
        'login',
        'login',
        {},
        mockReq as any,
      );

      expect(messageService.getMessages).toHaveBeenCalledWith(
        'idenplane',
        'login',
        'de',
      );
    });

    it('should use realm.defaultLocale when no req is provided', () => {
      const realmWithLocale = { ...mockRealm, defaultLocale: 'es' };

      service.render(mockRes as any, realmWithLocale, 'login', 'login', {});

      expect(messageService.getMessages).toHaveBeenCalledWith(
        'idenplane',
        'login',
        'es',
      );
    });

    it('should sanitize customCss before passing it to res.render', () => {
      themeService.resolveColors.mockReturnValue({
        primaryColor: '#2563eb',
        backgroundColor: '#f0f2f5',
        customCss: 'body { color: red; } </style><script>alert(1)</script>',
      });

      service.render(
        mockRes as any,
        mockRealm,
        'login',
        'login',
        {},
        mockReq as any,
      );

      const [, data] = mockRes.render.mock.calls[0];
      expect(data.customCss).not.toContain('</style');
      expect(data.customCss).not.toContain('<script');
      expect(data.customCss).toContain('body { color: red; }');
    });

    it('should set a Content-Security-Policy header with a nonce on each render', () => {
      service.render(
        mockRes as any,
        mockRealm,
        'login',
        'login',
        {},
        mockReq as any,
      );

      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Content-Security-Policy',
        expect.stringContaining("script-src 'self' 'nonce-"),
      );
    });

    it('should pass scriptNonce to the template and match the nonce in the CSP header', () => {
      service.render(
        mockRes as any,
        mockRealm,
        'login',
        'login',
        {},
        mockReq as any,
      );

      const [, data] = mockRes.render.mock.calls[0];
      const nonce: string = data.scriptNonce;

      expect(typeof nonce).toBe('string');
      expect(nonce.length).toBeGreaterThan(0);

      const [, cspValue] = mockRes.setHeader.mock.calls[0];
      expect(cspValue).toContain(`'nonce-${nonce}'`);
    });

    it('should generate a unique nonce on each render call', () => {
      templateService.resolve
        .mockReturnValueOnce('/app/themes/idenplane/login/templates/login.hbs')
        .mockReturnValueOnce(
          '/app/themes/idenplane/login/templates/layouts/main.hbs',
        )
        .mockReturnValueOnce('/app/themes/idenplane/login/templates/login.hbs')
        .mockReturnValueOnce(
          '/app/themes/idenplane/login/templates/layouts/main.hbs',
        );

      service.render(
        mockRes as any,
        mockRealm,
        'login',
        'login',
        {},
        mockReq as any,
      );
      service.render(
        mockRes as any,
        mockRealm,
        'login',
        'login',
        {},
        mockReq as any,
      );

      const nonce1 = mockRes.render.mock.calls[0][1].scriptNonce;
      const nonce2 = mockRes.render.mock.calls[1][1].scriptNonce;
      expect(nonce1).not.toBe(nonce2);
    });
  });

  describe('sanitizeCss', () => {
    it('should pass through valid CSS unchanged', () => {
      const css = 'body { color: red; } .foo > .bar { margin: 0; }';
      expect(sanitizeCss(css)).toBe(css);
    });

    it('should strip </style> to prevent breaking out of the style block', () => {
      // The closing > of </style> and the opening > of <script> are both left;
      // what matters is that the dangerous sequences that break out of the <style>
      // block are removed.
      expect(sanitizeCss('</style>')).toBe('>');
      const result = sanitizeCss('body{}</style><script>alert(1)</script>');
      expect(result).not.toContain('</style');
      expect(result).not.toContain('<script');
      expect(result).toContain('body{}');
      expect(result).toContain('alert(1)');
    });

    it('should strip </style case-insensitively', () => {
      expect(sanitizeCss('</STYLE>')).toBe('>');
      expect(sanitizeCss('</Style>')).toBe('>');
    });

    it('should strip <script case-insensitively', () => {
      expect(sanitizeCss('<script>alert(1)</script>')).toBe(
        '>alert(1)</script>',
      );
      expect(sanitizeCss('<SCRIPT>evil()</SCRIPT>')).toBe('>evil()</SCRIPT>');
    });

    it('should strip multiple occurrences', () => {
      const input = '</style><style>a{}</style>';
      // Both </style occurrences are removed
      expect(sanitizeCss(input)).not.toContain('</style');
    });

    it('should return empty string unchanged', () => {
      expect(sanitizeCss('')).toBe('');
    });

    it('should not leave a payload that a single pass would reform', () => {
      // A single .replace() pass would splice these back into a live tag:
      //   '<scr<script ipt' -> remove inner '<script' -> '<scr ipt'  (safe)
      //   '<<script script ...' style nesting. Verify the fixed-point loop
      //   leaves no '<script' or '</style' regardless of nesting.
      expect(sanitizeCss('<scr<script ipt>')).not.toMatch(/<script/i);
      expect(sanitizeCss('</sty</style le>')).not.toMatch(/<\/style/i);
      expect(sanitizeCss('<scr<SCRIPT>IPT>')).not.toMatch(/<script/i);
    });
  });
});
