import {
    Injectable,
    Logger,
    NotFoundException,
    type OnModuleInit,
} from '@nestjs/common';
import type { Prisma, Realm } from '@prisma/client';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
    ResolvedTheme,
    ThemeColors,
    ThemeDefinition,
    ThemeInfo,
    ThemeType,
} from './theme.types.js';

function darkenHex(hex: string, percent: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.max(
    0,
    ((num >> 16) & 0xff) - Math.round((255 * percent) / 100),
  );
  const g = Math.max(
    0,
    ((num >> 8) & 0xff) - Math.round((255 * percent) / 100),
  );
  const b = Math.max(0, (num & 0xff) - Math.round((255 * percent) / 100));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

@Injectable()
export class ThemeService implements OnModuleInit {
  private readonly logger = new Logger(ThemeService.name);
  private themes = new Map<string, ThemeDefinition>();
  private readonly themesDir = join(process.cwd(), 'themes');

  constructor(private readonly prisma: PrismaService) {}

  private readonly defaultColors: ThemeColors = {
    primaryColor: '#2563eb',
    backgroundColor: '#f0f2f5',
    cardColor: '#ffffff',
    textColor: '#1a1a2e',
    labelColor: '#374151',
    inputBorderColor: '#d1d5db',
    inputBgColor: '#ffffff',
    mutedColor: '#6b7280',
  };

  async onModuleInit() {
    await this.loadThemes();
  }

  getThemesDir(): string {
    return this.themesDir;
  }

  private async loadThemes(): Promise<void> {
    try {
      const entries = await readdir(this.themesDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const themeJsonPath = join(this.themesDir, entry.name, 'theme.json');
        try {
          const raw = await readFile(themeJsonPath, 'utf-8');
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          // Normalize: ensure parent and types exist
          if (!parsed['parent']) {
            parsed['parent'] = null;
          }
          if (!parsed['types']) {
            parsed['types'] = {};
          }
          const theme = parsed as unknown as ThemeDefinition;
          this.themes.set(theme.name, theme);
          this.logger.log(`Loaded theme: ${theme.name} (${theme.displayName})`);
        } catch {
          this.logger.warn(`Failed to load theme from ${themeJsonPath}`);
        }
      }

      this.logger.log(`Loaded ${this.themes.size} theme(s)`);
    } catch {
      this.logger.warn(
        `Themes directory not found at ${this.themesDir}, using defaults`,
      );
    }
  }

  getTheme(name: string): ThemeDefinition | undefined {
    return this.themes.get(name);
  }

  getAvailableThemes(): ThemeInfo[] {
    return Array.from(this.themes.values()).map(
      ({ name, displayName, description, colors }) => ({
        name,
        displayName,
        description,
        colors,
      }),
    );
  }

  /**
   * Returns the theme inheritance chain from child to root.
   * E.g., for "dark" with parent "idenplane": ["dark", "idenplane"]
   */
  getInheritanceChain(themeName: string): string[] {
    const chain: string[] = [];
    const visited = new Set<string>();
    let current: string | null = themeName;

    while (current && !visited.has(current)) {
      visited.add(current);
      chain.push(current);
      const theme = this.themes.get(current);
      current = theme?.parent ?? null;
    }

    return chain;
  }

  /**
   * Resolves CSS file URLs for a given theme and type.
   * Walks the inheritance chain base-to-child so base CSS loads first.
   */
  resolveCss(themeName: string, themeType: ThemeType): string[] {
    const chain = this.getInheritanceChain(themeName);
    const cssFiles: string[] = [];

    // Walk base-to-child so base CSS loads first, child overrides last
    for (const theme of [...chain].reverse()) {
      const typeConfig = this.themes.get(theme)?.types?.[themeType];
      if (typeConfig?.css) {
        for (const cssFile of typeConfig.css) {
          cssFiles.push(`/themes/${theme}/${themeType}/resources/${cssFile}`);
        }
      }
    }

    return cssFiles;
  }

  /**
   * Resolves colors for a given theme with per-realm overrides.
   */
  resolveColors(themeName: string, realm: Realm): ResolvedTheme {
    const baseTheme = this.themes.get(themeName);
    const baseColors = baseTheme?.colors ?? this.defaultColors;

    // Per-realm overrides from the theme JSON field
    const realmTheme = (realm.theme ?? {}) as Record<string, unknown>;

    const getString = (key: string, fallback: string): string => {
      const realmVal = realmTheme[key];
      if (typeof realmVal === 'string' && realmVal) return realmVal;
      return fallback;
    };

    const primaryColor = getString('primaryColor', baseColors.primaryColor);

    return {
      primaryColor,
      primaryHoverColor: getString(
        'primaryHoverColor',
        darkenHex(primaryColor, 15),
      ),
      backgroundColor: getString('backgroundColor', baseColors.backgroundColor),
      cardColor: getString('cardColor', baseColors.cardColor),
      textColor: getString('textColor', baseColors.textColor),
      labelColor: getString('labelColor', baseColors.labelColor),
      inputBorderColor: getString(
        'inputBorderColor',
        baseColors.inputBorderColor,
      ),
      inputBgColor: getString('inputBgColor', baseColors.inputBgColor),
      mutedColor: getString('mutedColor', baseColors.mutedColor),
      logoUrl: getString('logoUrl', ''),
      faviconUrl: getString('faviconUrl', ''),
      appTitle: getString('appTitle', 'Idenplane'),
      customCss: getString('customCss', ''),
      themeCssFiles: [], // Will be set by ThemeRenderService
    };
  }

  /**
   * Backward-compatible method: resolves theme using the realm's themeName field.
   * Used during migration before per-type fields are added.
   */
  resolveTheme(realm: Realm): ResolvedTheme {
    const themeName = realm.loginTheme ?? realm.themeName ?? 'idenplane';
    const resolved = this.resolveColors(themeName, realm);
    resolved.themeCssFiles = this.resolveCss(themeName, 'login');
    return resolved;
  }

  /**
   * Get the realm's theme name for a given type.
   */
  getRealmThemeName(realm: Realm, themeType: ThemeType): string {
    switch (themeType) {
      case 'login':
        return realm.loginTheme ?? realm.themeName ?? 'idenplane';
      case 'account':
        return realm.accountTheme ?? realm.themeName ?? 'idenplane';
      case 'email':
        return realm.emailTheme ?? realm.themeName ?? 'idenplane';
      default:
        return realm.themeName ?? 'idenplane';
    }
  }

  // ── DB-backed theme CRUD ───────────────────────────────────────────────────

  async createTheme(
    realmId: string,
    dto: {
      name: string;
      displayName?: string;
      description?: string;
      themeType?: string;
      styles?: Record<string, unknown>;
      components?: unknown[];
      assets?: Record<string, unknown>;
      settings?: Record<string, unknown>;
    },
  ) {
    return this.prisma.theme.create({
      data: {
        realmId,
        name: dto.name,
        displayName: dto.displayName,
        description: dto.description,
        themeType: dto.themeType ?? 'login',
        styles: (dto.styles ?? {}) as Prisma.InputJsonValue,
        components: (dto.components ?? []) as unknown as Prisma.InputJsonValue,
        assets: (dto.assets ?? {}) as Prisma.InputJsonValue,
        settings: (dto.settings ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  async findAllByRealm(
    realmId: string,
    filters?: {
      themeType?: string;
      status?: 'draft' | 'published' | 'archived';
      isActive?: boolean;
    },
  ) {
    const where: Prisma.ThemeWhereInput = { realmId };
    if (filters?.themeType && filters.themeType !== 'full') {
      where.themeType = filters.themeType;
    }
    if (filters?.status === 'published') {
      where.published = true;
    } else if (filters?.status === 'draft') {
      where.published = false;
    }
    return this.prisma.theme.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findById(themeId: string) {
    return this.prisma.theme.findUnique({ where: { id: themeId } });
  }

  async updateTheme(
    themeId: string,
    dto: {
      displayName?: string;
      description?: string;
      themeType?: string;
      styles?: Record<string, unknown>;
      components?: unknown[];
      assets?: Record<string, unknown>;
      settings?: Record<string, unknown>;
    },
  ) {
    const theme = await this.prisma.theme.findUnique({
      where: { id: themeId },
    });
    if (!theme) {
      throw new NotFoundException(`Theme with ID '${themeId}' not found`);
    }
    const data: Prisma.ThemeUpdateInput = {
      version: theme.version + 1,
    };
    if (dto.displayName !== undefined) data.displayName = dto.displayName;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.themeType !== undefined) data.themeType = dto.themeType;
    if (dto.styles !== undefined)
      data.styles = dto.styles as Prisma.InputJsonValue;
    if (dto.components !== undefined)
      data.components = dto.components as unknown as Prisma.InputJsonValue;
    if (dto.assets !== undefined)
      data.assets = dto.assets as Prisma.InputJsonValue;
    if (dto.settings !== undefined)
      data.settings = dto.settings as Prisma.InputJsonValue;
    return this.prisma.theme.update({ where: { id: themeId }, data });
  }

  async deleteTheme(themeId: string) {
    return this.prisma.theme.delete({ where: { id: themeId } });
  }

  async publishTheme(themeId: string) {
    return this.prisma.theme.update({
      where: { id: themeId },
      data: { published: true, publishedAt: new Date() },
    });
  }

  async getVersionHistory(themeId: string) {
    return this.prisma.themeVersion.findMany({
      where: { themeId },
      orderBy: { version: 'desc' },
    });
  }

  async restoreVersion(themeId: string, version: number) {
    const themeVersion = await this.prisma.themeVersion.findUnique({
      where: { themeId_version: { themeId, version } },
    });
    if (!themeVersion) {
      throw new NotFoundException(
        `Version ${version} not found for theme '${themeId}'`,
      );
    }
    const currentTheme = await this.prisma.theme.findUnique({
      where: { id: themeId },
    });
    if (!currentTheme) {
      throw new NotFoundException(`Theme with ID '${themeId}' not found`);
    }
    return this.prisma.theme.update({
      where: { id: themeId },
      data: {
        styles: themeVersion.styles as Prisma.InputJsonValue,
        components: themeVersion.components as unknown as Prisma.InputJsonValue,
        assets: themeVersion.assets as Prisma.InputJsonValue,
        settings: themeVersion.settings as Prisma.InputJsonValue,
        version: currentTheme.version + 1,
      },
    });
  }

  /**
   * Soft-archive a theme so it no longer appears in the default list but is
   * not deleted. Archived themes can be restored by updating `published`.
   */
  async archiveTheme(themeId: string) {
    const theme = await this.prisma.theme.findUnique({
      where: { id: themeId },
    });
    if (!theme) {
      throw new NotFoundException(`Theme with ID '${themeId}' not found`);
    }
    return this.prisma.theme.update({
      where: { id: themeId },
      data: { published: false },
    });
  }

  /**
   * Duplicate a theme (including styles/components/assets/settings) under a
   * new name within the same realm. The copy starts as a draft.
   */
  async duplicateTheme(themeId: string, newName: string) {
    const theme = await this.prisma.theme.findUnique({
      where: { id: themeId },
    });
    if (!theme) {
      throw new NotFoundException(`Theme with ID '${themeId}' not found`);
    }
    return this.prisma.theme.create({
      data: {
        realmId: theme.realmId,
        name: newName,
        displayName: newName,
        description: theme.description,
        themeType: theme.themeType,
        styles: theme.styles as Prisma.InputJsonValue,
        components: theme.components as unknown as Prisma.InputJsonValue,
        assets: theme.assets as Prisma.InputJsonValue,
        settings: theme.settings as Prisma.InputJsonValue,
        published: false,
        version: 1,
      },
    });
  }

  /**
   * Set a theme as the active theme for its type on its realm. This updates
   * the realm's loginTheme/accountTheme/emailTheme field so the rendering
   * pipeline picks it up. Only published themes can be activated.
   */
  async activateTheme(themeId: string) {
    const theme = await this.prisma.theme.findUnique({
      where: { id: themeId },
      include: { realm: true },
    });
    if (!theme) {
      throw new NotFoundException(`Theme with ID '${themeId}' not found`);
    }
    if (!theme.published) {
      throw new Error('Only published themes can be activated');
    }

    const themeType = theme.themeType as 'login' | 'account' | 'email' | 'full';
    const realmUpdate: Prisma.RealmUpdateInput = {};
    if (themeType === 'login' || themeType === 'full') {
      realmUpdate.loginTheme = theme.name;
    }
    if (themeType === 'account' || themeType === 'full') {
      realmUpdate.accountTheme = theme.name;
    }
    if (themeType === 'email' || themeType === 'full') {
      realmUpdate.emailTheme = theme.name;
    }
    realmUpdate.themeName = theme.name;

    await this.prisma.realm.update({
      where: { id: theme.realmId },
      data: realmUpdate,
    });

    return this.prisma.theme.update({
      where: { id: themeId },
      data: { published: true },
    });
  }

  /**
   * Export a theme's full configuration as a plain JSON object (suitable for
   * re-import via `importTheme`).
   */
  async exportTheme(themeId: string) {
    const theme = await this.prisma.theme.findUnique({
      where: { id: themeId },
    });
    if (!theme) {
      throw new NotFoundException(`Theme with ID '${themeId}' not found`);
    }
    return {
      version: '1.0',
      name: theme.name,
      displayName: theme.displayName,
      description: theme.description,
      themeType: theme.themeType,
      styles: theme.styles,
      components: theme.components,
      assets: theme.assets,
      settings: theme.settings,
      exportedAt: new Date().toISOString(),
    };
  }

  /**
   * Import a theme from an exported JSON object. When `overwrite` is true and a
   * theme with the same name exists in the realm, it is updated in place;
   * otherwise a new theme is created. When `activate` is true, the imported
   * theme is also activated on its realm.
   */
  async importTheme(
    realmId: string,
    payload: Record<string, unknown>,
    options: { overwrite?: boolean; activate?: boolean } = {},
  ) {
    const name = String(payload['name'] ?? '');
    if (!name) {
      throw new Error('Import payload is missing a "name" field');
    }

    const data: Prisma.ThemeCreateInput | Prisma.ThemeUpdateInput = {
      displayName: payload['displayName'] as string | null,
      description: payload['description'] as string | null,
      themeType: (payload['themeType'] as string) ?? 'login',
      styles: (payload['styles'] ?? {}) as Prisma.InputJsonValue,
      components: (payload['components'] ??
        []) as unknown as Prisma.InputJsonValue,
      assets: (payload['assets'] ?? {}) as Prisma.InputJsonValue,
      settings: (payload['settings'] ?? {}) as Prisma.InputJsonValue,
    };

    const existing = await this.prisma.theme.findUnique({
      where: { realmId_name: { realmId, name } },
    });

    let theme;
    if (existing && options.overwrite) {
      theme = await this.prisma.theme.update({
        where: { id: existing.id },
        data: data,
      });
    } else if (existing && !options.overwrite) {
      throw new Error(
        `A theme named '${name}' already exists in this realm. Use overwrite=true to replace it.`,
      );
    } else {
      theme = await this.prisma.theme.create({
        data: {
          realmId,
          name,
          displayName: payload['displayName'] as string | null,
          description: payload['description'] as string | null,
          themeType: (payload['themeType'] as string) ?? 'login',
          styles: payload['styles'] ?? {},
          components: payload['components'] ?? [],
          assets: payload['assets'] ?? {},
          settings: payload['settings'] ?? {},
        },
      });
    }

    if (options.activate) {
      await this.activateTheme(theme.id);
    }

    return theme;
  }

  /**
   * Return the built-in theme definitions as "templates" the builder can seed
   * from. Each template includes the theme's colors as a starting point.
   *
   * The backend `ThemeColors` type only carries the 8 core color fields used by
   * the rendering pipeline; the admin-ui `ThemeColors` extends that with
   * hover/active/secondary/surface/border/status colors. We map the core
   * fields and provide sensible defaults for the extended fields so the
   * returned template is shape-compatible with the frontend `ThemeStyles`.
   */
  getThemeTemplates() {
    return Array.from(this.themes.values()).map(
      ({ name, displayName, description, colors }) => ({
        id: name,
        name: displayName ?? name,
        description: description ?? '',
        previewImage: '',
        themeType: 'login' as const,
        styles: {
          colors: {
            primaryColor: colors?.primaryColor ?? '#2563eb',
            primaryHoverColor: '#1d4ed8',
            primaryActiveColor: '#1e40af',
            secondaryColor: '#64748b',
            backgroundColor: colors?.backgroundColor ?? '#f8fafc',
            cardColor: colors?.cardColor ?? '#ffffff',
            surfaceColor: '#f1f5f9',
            textColor: colors?.textColor ?? '#1e293b',
            textSecondaryColor: colors?.mutedColor ?? '#64748b',
            borderColor: colors?.inputBorderColor ?? '#e2e8f0',
            errorColor: '#dc2626',
            warningColor: '#f59e0b',
            successColor: '#16a34a',
            infoColor: '#0ea5e9',
          },
        },
        components: [],
        assets: {},
        settings: {},
      }),
    );
  }
}
