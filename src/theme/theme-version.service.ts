import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import type { Theme, ThemeVersion } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Service for managing theme version history.
 * Handles creating version snapshots, comparing versions, and restoring from history.
 */
@Injectable()
export class ThemeVersionService {
  private readonly logger = new Logger(ThemeVersionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Calculate checksum for theme data for integrity verification.
   */
  private calculateChecksum(
    styles: object,
    components: object[],
    assets: object,
    settings: object,
  ): string {
    const data = JSON.stringify({ styles, components, assets, settings });
    return createHash('sha256').update(data).digest('hex').substring(0, 16);
  }

  /**
   * Create a version snapshot of a theme.
   */
  async createVersion(
    themeId: string,
    userId?: string,
    changes?: string,
  ): Promise<ThemeVersion> {
    const theme = await this.prisma.theme.findUnique({
      where: { id: themeId },
    });

    if (!theme) {
      throw new NotFoundException(`Theme with ID '${themeId}' not found`);
    }

    const checksum = this.calculateChecksum(
      theme.styles as object,
      theme.components as object[],
      theme.assets as object,
      theme.settings as object,
    );

    return this.prisma.themeVersion.create({
      data: {
        themeId,
        version: theme.version,
        changes,
        checksum,
        styles: theme.styles as object,
        components: theme.components as object[],
        assets: theme.assets as object,
        settings: theme.settings as object,
        createdBy: userId,
      },
    });
  }

  /**
   * Get version history for a theme.
   */
  async getVersionHistory(themeId: string): Promise<ThemeVersion[]> {
    return this.prisma.themeVersion.findMany({
      where: { themeId },
      orderBy: { version: 'desc' },
    });
  }

  /**
   * Get a specific version of a theme.
   */
  async getVersion(
    themeId: string,
    version: number,
  ): Promise<ThemeVersion | null> {
    return this.prisma.themeVersion.findUnique({
      where: { themeId_version: { themeId, version } },
    });
  }

  /**
   * Restore a theme to a specific version.
   */
  async restoreVersion(
    themeId: string,
    version: number,
    userId?: string,
  ): Promise<Theme> {
    const themeVersion = await this.prisma.themeVersion.findUnique({
      where: { themeId_version: { themeId, version } },
    });

    if (!themeVersion) {
      throw new NotFoundException(
        `Version ${version} not found for theme '${themeId}'`,
      );
    }

    // Increment the theme's version when restoring
    const currentTheme = await this.prisma.theme.findUnique({
      where: { id: themeId },
    });

    if (!currentTheme) {
      throw new NotFoundException(`Theme with ID '${themeId}' not found`);
    }

    return this.prisma.theme.update({
      where: { id: themeId },
      data: {
        styles: themeVersion.styles as object,
        components: themeVersion.components as object[],
        assets: themeVersion.assets as object,
        settings: themeVersion.settings as object,
        version: currentTheme.version + 1,
        updatedBy: userId,
      },
    });
  }

  /**
   * Compare two versions of a theme and return their differences.
   */
  async compareVersions(
    themeId: string,
    version1: number,
    version2: number,
  ): Promise<{
    version1: ThemeVersion;
    version2: ThemeVersion;
    stylesChanged: boolean;
    componentsChanged: boolean;
    assetsChanged: boolean;
    settingsChanged: boolean;
  }> {
    const [v1, v2] = await Promise.all([
      this.prisma.themeVersion.findUnique({
        where: { themeId_version: { themeId, version: version1 } },
      }),
      this.prisma.themeVersion.findUnique({
        where: { themeId_version: { themeId, version: version2 } },
      }),
    ]);

    if (!v1) {
      throw new NotFoundException(
        `Version ${version1} not found for theme '${themeId}'`,
      );
    }
    if (!v2) {
      throw new NotFoundException(
        `Version ${version2} not found for theme '${themeId}'`,
      );
    }

    return {
      version1: v1,
      version2: v2,
      stylesChanged: JSON.stringify(v1.styles) !== JSON.stringify(v2.styles),
      componentsChanged:
        JSON.stringify(v1.components) !== JSON.stringify(v2.components),
      assetsChanged: JSON.stringify(v1.assets) !== JSON.stringify(v2.assets),
      settingsChanged:
        JSON.stringify(v1.settings) !== JSON.stringify(v2.settings),
    };
  }

  /**
   * Delete versions older than a specified count, keeping the most recent ones.
   */
  async pruneOldVersions(themeId: string, keepCount: number): Promise<number> {
    const versions = await this.prisma.themeVersion.findMany({
      where: { themeId },
      orderBy: { version: 'desc' },
      skip: keepCount,
    });

    if (versions.length === 0) {
      return 0;
    }

    const idsToDelete = versions.map((v) => v.id);
    await this.prisma.themeVersion.deleteMany({
      where: { id: { in: idsToDelete } },
    });

    this.logger.log(
      `Pruned ${idsToDelete.length} old versions for theme '${themeId}'`,
    );
    return idsToDelete.length;
  }

  /**
   * Validate theme data integrity against stored checksum.
   */
  async validateIntegrity(themeId: string, version: number): Promise<boolean> {
    const themeVersion = await this.prisma.themeVersion.findUnique({
      where: { themeId_version: { themeId, version } },
    });

    if (!themeVersion) {
      throw new NotFoundException(
        `Version ${version} not found for theme '${themeId}'`,
      );
    }

    const expectedChecksum = this.calculateChecksum(
      themeVersion.styles as object,
      themeVersion.components as object[],
      themeVersion.assets as object,
      themeVersion.settings as object,
    );

    return themeVersion.checksum === expectedChecksum;
  }
}
