import { Injectable, Logger } from '@nestjs/common';
import { join } from 'path';
import { existsSync } from 'fs';
import { ThemeService } from './theme.service.js';
import type { ThemeType } from './theme.types.js';

@Injectable()
export class ThemeTemplateService {
  private readonly logger = new Logger(ThemeTemplateService.name);

  constructor(private readonly themeService: ThemeService) {}

  /**
   * Resolves the absolute path to a template file by walking the theme
   * inheritance chain. Returns the first matching file found.
   *
   * @param themeName - The theme to start resolution from (e.g., "dark")
   * @param themeType - The theme type (login, account, email)
   * @param templateName - The template name without extension (e.g., "login", "layouts/main")
   * @returns Absolute path to the .hbs file
   * @throws Error if template not found in any theme in the chain
   */
  resolve(
    themeName: string,
    themeType: ThemeType,
    templateName: string,
  ): string {
    const chain = this.themeService.getInheritanceChain(themeName);
    const themesDir = this.themeService.getThemesDir();

    for (const theme of chain) {
      const candidatePath = join(
        themesDir,
        theme,
        themeType,
        'templates',
        templateName + '.hbs',
      );
      if (existsSync(candidatePath)) {
        return candidatePath;
      }
    }

    // Fallback to the default 'authme' theme to prevent 500 errors
    if (themeName !== 'authme') {
      this.logger.warn(
        `Template "${templateName}" not found for theme "${themeName}/${themeType}", falling back to "authme"`,
      );
      return this.resolve('authme', themeType, templateName);
    }

    throw new Error(
      `Template not found: ${templateName} for theme ${themeName}/${themeType}. ` +
        `Searched chain: [${chain.join(' → ')}]`,
    );
  }

  /**
   * Checks whether a template exists in the inheritance chain.
   */
  exists(
    themeName: string,
    themeType: ThemeType,
    templateName: string,
  ): boolean {
    try {
      this.resolve(themeName, themeType, templateName);
      return true;
    } catch {
      return false;
    }
  }
}
