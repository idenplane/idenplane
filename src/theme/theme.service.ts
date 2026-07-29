import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import type { Prisma, Realm } from '@prisma/client';
import { createHash } from 'crypto';
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

  private isThemeActive(
    theme: { name: string; themeType: string },
    realm: Pick<Realm, 'loginTheme' | 'accountTheme' | 'emailTheme'>,
  ): boolean {
    switch (theme.themeType) {
      case 'login':
        return realm.loginTheme === theme.name;
      case 'account':
        return realm.accountTheme === theme.name;
      case 'email':
        return realm.emailTheme === theme.name;
      case 'full':
        return (
          realm.loginTheme === theme.name ||
          realm.accountTheme === theme.name ||
          realm.emailTheme === theme.name
        );
      default:
        return false;
    }
  }

  private assertThemeIsNotActive(
    theme: {
      name: string;
      themeType: string;
      realm: Pick<Realm, 'loginTheme' | 'accountTheme' | 'emailTheme'>;
    },
    action: string,
  ): void {
    if (this.isThemeActive(theme, theme.realm)) {
      throw new BadRequestException(
        `Cannot ${action} active theme '${theme.name}'. Activate another theme first.`,
      );
    }
  }

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
   * Returns filesystem themes merged with the realm's published DB-backed
   * themes (theme builder). DB themes whose name collides with a filesystem
   * theme are skipped so built-ins always win. Used by the realm theme picker
   * and by realm update validation so DB themes are selectable and savable.
   */
  async getAvailableThemesForRealm(realmId: string): Promise<ThemeInfo[]> {
    const fsThemes = this.getAvailableThemes();
    const fsNames = new Set(fsThemes.map((t) => t.name));
    const dbThemes = await this.prisma.theme.findMany({
      where: { realmId, published: true },
      orderBy: { updatedAt: 'desc' },
    });
    const dbInfos: ThemeInfo[] = dbThemes
      .filter((t) => !fsNames.has(t.name))
      .map((t) => ({
        name: t.name,
        displayName: t.displayName ?? t.name,
        description: t.description ?? '',
        colors: this.dbThemeColors(t.styles),
      }));
    return [...fsThemes, ...dbInfos];
  }

  /**
   * Resolves the per-realm `theme` color override object for a selected theme
   * name. Returns `null` for filesystem themes (which carry their own colors),
   * or the override map for a DB-backed theme so its colors apply at render.
   */
  async getRealmThemeOverrides(
    realmId: string,
    themeName: string,
  ): Promise<Record<string, string> | null> {
    if (this.themes.has(themeName)) return null;
    const dbTheme = await this.prisma.theme.findFirst({
      where: { realmId, name: themeName },
    });
    if (!dbTheme) return null;
    return this.dbThemeRealmOverrides(dbTheme);
  }

  /**
   * Maps a DB-backed theme's `styles.colors` JSON onto the filesystem
   * ThemeColors shape, falling back to engine defaults for missing values.
   */
  private dbThemeColors(styles: unknown): ThemeColors {
    const s = (styles ?? {}) as Record<string, unknown>;
    const c = (s.colors ?? {}) as Record<string, unknown>;
    const pick = (value: unknown, fallback: string): string =>
      typeof value === 'string' && value ? value : fallback;
    return {
      primaryColor: pick(c.primaryColor, this.defaultColors.primaryColor),
      backgroundColor: pick(
        c.backgroundColor,
        this.defaultColors.backgroundColor,
      ),
      cardColor: pick(c.cardColor, this.defaultColors.cardColor),
      textColor: pick(c.textColor, this.defaultColors.textColor),
      labelColor: pick(c.textColor, this.defaultColors.labelColor),
      inputBorderColor: pick(
        c.borderColor,
        this.defaultColors.inputBorderColor,
      ),
      inputBgColor: pick(c.cardColor, this.defaultColors.inputBgColor),
      mutedColor: pick(c.textSecondaryColor, this.defaultColors.mutedColor),
    };
  }

  /**
   * Builds the per-realm `theme` override object consumed by `resolveColors`
   * from a DB-backed theme's styles and assets. Only string values that are
   * present are emitted so unset fields fall back to the base theme defaults.
   */
  private dbThemeRealmOverrides(theme: {
    styles: unknown;
    assets: unknown;
    settings?: unknown;
    components?: unknown;
  }): Record<string, string> {
    const styles = (theme.styles ?? {}) as Record<string, unknown>;
    const colors = (styles.colors ?? {}) as Record<string, unknown>;
    const assets = (theme.assets ?? {}) as Record<string, unknown>;
    const settings = (theme.settings ?? {}) as Record<string, unknown>;
    const overrides: Record<string, string> = {};
    const set = (key: string, value: unknown): void => {
      if (typeof value === 'string' && value) overrides[key] = value;
    };
    set('primaryColor', colors.primaryColor);
    set('primaryHoverColor', colors.primaryHoverColor);
    set('backgroundColor', colors.backgroundColor);
    set('cardColor', colors.cardColor);
    set('textColor', colors.textColor);
    set('labelColor', colors.textColor);
    set('inputBorderColor', colors.borderColor);
    set('inputBgColor', colors.cardColor);
    set('mutedColor', colors.textSecondaryColor);
    set('customCss', styles.customCss);
    set('logoUrl', assets.logoUrl ?? assets.logo);
    set('faviconUrl', assets.faviconUrl ?? assets.favicon);
    // The login/account layout renders {{appTitle}} as the page heading, so the
    // title configured in the theme builder must flow through to the real page.
    set('appTitle', settings.appTitle);
    set('loginSubtitle', settings.appDescription);
    set('loginFooterText', settings.customFooterText);
    // Optional blocks default to shown; emit a hide flag only when explicitly
    // disabled so existing themes keep their current behaviour.
    const hideWhenFalse = (key: string, value: unknown): void => {
      if (value === false) overrides[key] = '1';
    };
    hideWhenFalse('hideRememberMe', settings.showRememberMe);
    hideWhenFalse('hideForgotPassword', settings.showForgotPassword);
    hideWhenFalse('hideSocial', settings.showSocialProviders);
    hideWhenFalse('hideRegistration', settings.showRegistrationLink);
    // Surface the heading: prefer an explicit settings value, then fall back to
    // the first visible heading component authored on the builder canvas.
    const components = Array.isArray(theme.components) ? theme.components : [];
    const heading = components.find((c) => {
      const comp = (c ?? {}) as Record<string, unknown>;
      return comp.type === 'heading' && comp.visible !== false;
    }) as Record<string, unknown> | undefined;
    const headingFromComponent = heading
      ? ((heading.props ?? {}) as Record<string, unknown>).content
      : undefined;
    set('customHeading', settings.loginHeading ?? headingFromComponent);
    return overrides;
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

    // If the chain contains no known filesystem theme (e.g. the realm points at
    // a DB-backed theme that has no templates/messages/CSS on disk), fall back
    // to the default base theme so templates, messages, and CSS still resolve
    // instead of rendering raw message keys with no styling.
    const DEFAULT_BASE = 'idenplane';
    const hasFsTheme = chain.some((t) => this.themes.has(t));
    if (
      !hasFsTheme &&
      this.themes.has(DEFAULT_BASE) &&
      !chain.includes(DEFAULT_BASE)
    ) {
      chain.push(DEFAULT_BASE);
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
      customHeading: getString('customHeading', ''),
      loginSubtitle: getString('loginSubtitle', ''),
      loginFooterText: getString('loginFooterText', ''),
      hideRememberMe: getString('hideRememberMe', ''),
      hideForgotPassword: getString('hideForgotPassword', ''),
      hideSocial: getString('hideSocial', ''),
      hideRegistration: getString('hideRegistration', ''),
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
    const [realm, themes] = await Promise.all([
      this.prisma.realm.findUnique({
        where: { id: realmId },
        select: {
          loginTheme: true,
          accountTheme: true,
          emailTheme: true,
        },
      }),
      this.prisma.theme.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
      }),
    ]);
    if (!realm) {
      throw new NotFoundException(`Realm with ID '${realmId}' not found`);
    }

    const themesWithActiveState = themes.map((theme) => ({
      ...theme,
      isActive: this.isThemeActive(theme, realm),
    }));

    return filters?.isActive === undefined
      ? themesWithActiveState
      : themesWithActiveState.filter(
          (theme) => theme.isActive === filters.isActive,
        );
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
    // Snapshot the current state as a version before applying changes so the
    // publish-tab version history accumulates a restorable entry per save.
    await this.snapshotVersion(theme);
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
    const theme = await this.prisma.theme.findUnique({
      where: { id: themeId },
      include: { realm: true },
    });
    if (!theme) {
      throw new NotFoundException(`Theme with ID '${themeId}' not found`);
    }
    this.assertThemeIsNotActive(theme, 'delete');
    return this.prisma.theme.delete({ where: { id: themeId } });
  }

  /**
   * Persist a snapshot of the given theme's current state into version history.
   * Uses an upsert keyed on (themeId, version) so repeated calls for the same
   * version are idempotent rather than throwing on the unique constraint.
   */
  private async snapshotVersion(theme: {
    id: string;
    version: number;
    styles: unknown;
    components: unknown;
    assets: unknown;
    settings: unknown;
  }): Promise<void> {
    const checksum = createHash('sha256')
      .update(
        JSON.stringify({
          styles: theme.styles,
          components: theme.components,
          assets: theme.assets,
          settings: theme.settings,
        }),
      )
      .digest('hex')
      .substring(0, 16);
    await this.prisma.themeVersion.upsert({
      where: { themeId_version: { themeId: theme.id, version: theme.version } },
      create: {
        themeId: theme.id,
        version: theme.version,
        checksum,
        styles: theme.styles as Prisma.InputJsonValue,
        components: theme.components as Prisma.InputJsonValue,
        assets: theme.assets as Prisma.InputJsonValue,
        settings: theme.settings as Prisma.InputJsonValue,
      },
      update: {},
    });
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
    // Preserve the pre-restore state in history so a restore is itself reversible.
    await this.snapshotVersion(currentTheme);
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
      include: { realm: true },
    });
    if (!theme) {
      throw new NotFoundException(`Theme with ID '${themeId}' not found`);
    }
    this.assertThemeIsNotActive(theme, 'archive');
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

    // Map the DB theme's colors/customCss/assets onto the realm's `theme`
    // override field so the rendering pipeline (which inherits templates and
    // messages from the base filesystem theme) reflects the activated theme.
    realmUpdate.theme = this.dbThemeRealmOverrides(theme);

    await this.prisma.realm.update({
      where: { id: theme.realmId },
      data: realmUpdate,
    });

    const updatedTheme = await this.prisma.theme.update({
      where: { id: themeId },
      data: { published: true },
    });
    return { ...updatedTheme, isActive: true };
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
    const name =
      typeof payload['name'] === 'string' ? payload['name'].trim() : '';
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
