import { Injectable, type OnModuleInit, Logger } from '@nestjs/common';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { ThemeService } from './theme.service.js';
import type { ThemeType } from './theme.types.js';

@Injectable()
export class ThemeMessageService implements OnModuleInit {
  private readonly logger = new Logger(ThemeMessageService.name);
  // Cache: "themeName:themeType:locale" → messages
  private cache = new Map<string, Record<string, string>>();

  constructor(private readonly themeService: ThemeService) {}

  async onModuleInit() {
    // Pre-load messages for all known themes on startup
    const themes = this.themeService.getAvailableThemes();
    const types: ThemeType[] = ['login', 'account', 'email'];
    for (const theme of themes) {
      for (const type of types) {
        this.getMessages(theme.name, type, 'en');
      }
    }
    this.logger.log(`Pre-loaded messages for ${themes.length} theme(s)`);
  }

  /**
   * Gets merged messages for a given theme, type, and locale.
   * Walks the inheritance chain base-first so child messages override parent.
   */
  getMessages(
    themeName: string,
    themeType: ThemeType,
    locale: string,
  ): Record<string, string> {
    const cacheKey = `${themeName}:${themeType}:${locale}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const chain = this.themeService.getInheritanceChain(themeName);
    const themesDir = this.themeService.getThemesDir();
    const merged: Record<string, string> = {};

    // Walk chain in reverse (base first) so child overrides parent
    for (const theme of [...chain].reverse()) {
      const filePath = join(
        themesDir,
        theme,
        themeType,
        'messages',
        `messages_${locale}.properties`,
      );
      if (existsSync(filePath)) {
        const parsed = this.parseProperties(filePath);
        Object.assign(merged, parsed);
      }
    }

    // Fallback to English if requested locale has no messages
    if (locale !== 'en' && Object.keys(merged).length === 0) {
      const fallback = this.getMessages(themeName, themeType, 'en');
      this.cache.set(cacheKey, fallback);
      return fallback;
    }

    this.cache.set(cacheKey, merged);
    return merged;
  }

  /**
   * Parses a Java-style .properties file into a key-value map.
   */
  private parseProperties(filePath: string): Record<string, string> {
    const content = readFileSync(filePath, 'utf-8');
    const result: Record<string, string> = {};

    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!'))
        continue;

      const eqIndex = trimmed.indexOf('=');
      if (eqIndex > 0) {
        const key = trimmed.substring(0, eqIndex).trim();
        const value = trimmed.substring(eqIndex + 1).trim();
        result[key] = this.decodeEscapes(value);
      }
    }

    return result;
  }

  private decodeEscapes(s: string): string {
    return s.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, esc: string) => {
      if (esc[0] === 'u')
        return String.fromCharCode(parseInt(esc.slice(1), 16));
      switch (esc) {
        case 'n':
          return '\n';
        case 't':
          return '\t';
        case 'r':
          return '\r';
        case '\\':
          return '\\';
        default:
          return esc;
      }
    });
  }

  /**
   * Clears the message cache (useful for hot-reload in dev).
   */
  clearCache(): void {
    this.cache.clear();
  }
}
