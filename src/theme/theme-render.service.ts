import { Injectable } from '@nestjs/common';
import { relative } from 'path';
import { randomBytes } from 'crypto';
import type { Request, Response } from 'express';
import type { Realm } from '@prisma/client';
import { ThemeService } from './theme.service.js';
import { ThemeTemplateService } from './theme-template.service.js';
import { ThemeMessageService } from './theme-message.service.js';
import { I18nService, SUPPORTED_LOCALES } from './i18n.service.js';
import type { ThemeType } from './theme.types.js';

/**
 * Sanitizes a CSS string so it cannot break out of a <style> block.
 *
 * Strips any occurrence of </style (case-insensitive) to prevent an attacker
 * from closing the surrounding <style> element and injecting arbitrary HTML or
 * script content.  A <script opening tag is also removed as defence-in-depth.
 *
 * Valid CSS selectors and property values that happen to contain angle brackets
 * (extremely rare, and never required for `</style`) are unaffected in normal
 * use; the restriction is intentionally narrow.
 */
export function sanitizeCss(css: string): string {
  // Remove any </style...> sequence (the closing bracket is optional because a
  // browser may still parse a partial tag).
  // Also remove opening <script tags for defence-in-depth.
  return css.replace(/<\/style/gi, '').replace(/<script/gi, '');
}

@Injectable()
export class ThemeRenderService {
  constructor(
    private readonly themeService: ThemeService,
    private readonly templateService: ThemeTemplateService,
    private readonly messageService: ThemeMessageService,
    private readonly i18n: I18nService,
  ) {}

  /**
   * Renders a themed page. Replaces @Render() decorator and direct res.render() calls.
   *
   * @param res - Express response object
   * @param realm - The current realm
   * @param themeType - Theme type: 'login', 'account', or 'email'
   * @param templateName - Template name without extension (e.g., "login", "account")
   * @param data - Page-specific template data (form fields, errors, etc.)
   * @param req - Optional Express request object used to detect locale from
   *              Accept-Language header or `?lang=` query parameter.
   */
  render(
    res: Response,
    realm: Realm,
    themeType: ThemeType,
    templateName: string,
    data: Record<string, unknown>,
    req?: Request,
  ): void {
    const themeName = this.themeService.getRealmThemeName(realm, themeType);
    const templatePath = this.templateService.resolve(
      themeName,
      themeType,
      templateName,
    );
    const layoutPath = this.templateService.resolve(
      themeName,
      themeType,
      'layouts/main',
    );
    const colors = this.themeService.resolveColors(themeName, realm);
    const cssFiles = this.themeService.resolveCss(themeName, themeType);

    // Resolve locale: prefer request-based detection, fall back to realm default, then 'en'
    const locale = req
      ? this.i18n.detectLocale(req)
      : (realm.defaultLocale ?? 'en');
    const messages = this.messageService.getMessages(
      themeName,
      themeType,
      locale,
    );
    const isRtl = this.i18n.isRtl(locale);

    // Convert absolute paths to relative (relative to themes dir) for Express view resolution
    const themesDir = this.themeService.getThemesDir();
    const relativeTemplate = relative(themesDir, templatePath);
    const relativeLayout = relative(themesDir, layoutPath);

    // Build the language switcher data: list of supported locales for the dropdown
    const currentUrl = req ? this.buildCurrentUrl(req) : '';
    const languageSwitcher = SUPPORTED_LOCALES.map((code) => ({
      code,
      label: this.getLocaleLabel(code),
      active: code === locale,
      url: this.buildLangUrl(currentUrl, code),
    }));

    // Sanitize customCss before it reaches the template.  The layout renders it
    // with {{{customCss}}} (triple-brace / unescaped) so that valid CSS syntax
    // such as `>`, `&`, and `{` is preserved.  We therefore must strip any
    // HTML break-out sequences here, server-side.
    const sanitizedColors = {
      ...colors,
      customCss: sanitizeCss(colors.customCss ?? ''),
    };

    // Generate a cryptographically random nonce for this response.  The nonce
    // is embedded in a per-response Content-Security-Policy header so that only
    // the inline <script> blocks produced by our own templates are allowed —
    // removing the need for the blanket 'unsafe-inline' directive (Issue #370).
    // The header also ensures login/account pages always carry a CSP even when
    // the request bypasses the global helmet middleware (Issue #352).
    const scriptNonce = randomBytes(16).toString('base64');
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        `script-src 'self' 'nonce-${scriptNonce}'`,
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data: blob:",
        "connect-src 'self'",
      ].join('; '),
    );

    res.render(relativeTemplate, {
      layout: relativeLayout,
      ...data,
      ...sanitizedColors,
      _messages: messages,
      themeCssFiles: cssFiles,
      realmName: data.realmName ?? realm.name,
      realmDisplayName:
        data.realmDisplayName ?? realm.displayName ?? realm.name,
      // i18n context
      locale,
      isRtl,
      dir: isRtl ? 'rtl' : 'ltr',
      languageSwitcher,
      currentLangLabel: this.getLocaleLabel(locale),
      // CSP nonce for inline <script> blocks in theme templates
      scriptNonce,
    });
  }

  // ─── Private helpers ──────────────────────────────────────

  /**
   * Returns the full URL of the current request (path + existing query params).
   */
  private buildCurrentUrl(req: Request): string {
    return req.originalUrl ?? req.url ?? '';
  }

  /**
   * Builds a URL that sets the `lang` query parameter to the given locale,
   * preserving all other existing query params.
   */
  private buildLangUrl(currentUrl: string, locale: string): string {
    try {
      // Use a fake base so URL can parse a path-only string
      const base = 'http://x';
      const url = new URL(currentUrl, base);
      url.searchParams.set('lang', locale);
      return url.pathname + url.search;
    } catch {
      // Fallback: append ?lang=XX
      const separator = currentUrl.includes('?') ? '&' : '?';
      return `${currentUrl}${separator}lang=${locale}`;
    }
  }

  /**
   * Returns a human-readable label for a locale code.
   */
  private getLocaleLabel(locale: string): string {
    const labels: Record<string, string> = {
      en: 'English',
      es: 'Espanol',
      fr: 'Francais',
      de: 'Deutsch',
      pt: 'Portugues',
      zh: '\u4e2d\u6587',
      ja: '\u65e5\u672c\u8a9e',
      ko: '\ud55c\uad6d\uc5b4',
      ar: '\u0627\u0644\u0639\u0631\u0628\u064a\u0629',
      ru: '\u0420\u0443\u0441\u0441\u043a\u0438\u0439',
    };
    return labels[locale] ?? locale;
  }
}
