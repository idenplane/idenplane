import { Injectable } from '@nestjs/common';
import type { Request } from 'express';

/** Languages supported by the i18n system. */
export const SUPPORTED_LOCALES = [
  'en',
  'es',
  'fr',
  'de',
  'pt',
  'zh',
  'ja',
  'ko',
  'ar',
  'ru',
] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** RTL (right-to-left) locales. */
const RTL_LOCALES = new Set<string>(['ar']);

@Injectable()
export class I18nService {
  /**
   * Detects the locale from a request.
   *
   * Priority order:
   * 1. `lang` query parameter  (e.g., `?lang=fr`)
   * 2. `Accept-Language` header (uses the first matching supported locale)
   * 3. Falls back to `'en'`
   *
   * Only locales present in SUPPORTED_LOCALES are accepted; everything else
   * falls back to the next source or finally English.
   */
  detectLocale(req: Request): string {
    // 1. Explicit query param override
    const queryLang = req.query?.['lang'];
    if (typeof queryLang === 'string') {
      const normalized = this.normalizeLocale(queryLang);
      if (normalized) return normalized;
    }

    // 2. Accept-Language header
    const acceptLanguage = req.headers?.['accept-language'];
    if (acceptLanguage) {
      const parsed = this.parseAcceptLanguage(acceptLanguage);
      for (const tag of parsed) {
        const normalized = this.normalizeLocale(tag);
        if (normalized) return normalized;
      }
    }

    return 'en';
  }

  /**
   * Returns `true` when the given locale uses right-to-left script.
   */
  isRtl(locale: string): boolean {
    return RTL_LOCALES.has(locale);
  }

  /**
   * Returns the list of all supported locale codes.
   */
  getSupportedLocales(): readonly string[] {
    return SUPPORTED_LOCALES;
  }

  /**
   * Normalises a raw locale tag (e.g., "fr-FR", "FR", "fr") to a supported
   * two-letter code, or returns `null` if unsupported.
   */
  normalizeLocale(raw: string): string | null {
    const lower = raw.trim().toLowerCase();
    // Exact match (e.g., "fr")
    if ((SUPPORTED_LOCALES as readonly string[]).includes(lower)) {
      return lower;
    }
    // Region-subtag match (e.g., "fr-FR" → "fr")
    const base = lower.split(/[-_]/)[0];
    if (base && (SUPPORTED_LOCALES as readonly string[]).includes(base)) {
      return base;
    }
    return null;
  }

  /**
   * Parses an `Accept-Language` header value into an ordered list of locale
   * tags, sorted by quality value (q-factor), highest first.
   *
   * E.g., "fr-FR,fr;q=0.9,en;q=0.8" → ["fr-FR", "fr", "en"]
   */
  parseAcceptLanguage(header: string): string[] {
    return header
      .split(',')
      .map((part) => {
        const [tag, q] = part.trim().split(';');
        const quality = q ? parseFloat(q.split('=')[1] ?? '1') : 1;
        return { tag: (tag ?? '').trim(), quality };
      })
      .filter(({ tag }) => tag.length > 0)
      .sort((a, b) => b.quality - a.quality)
      .map(({ tag }) => tag);
  }
}
