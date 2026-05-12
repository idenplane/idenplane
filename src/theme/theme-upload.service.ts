import { Injectable, Logger } from '@nestjs/common';
import { join } from 'path';
import { mkdir, writeFile, unlink, access } from 'fs/promises';

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';

export interface UploadedAsset {
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  url: string;
}

export interface ThemeAssetUploadResult {
  success: boolean;
  assets: UploadedAsset[];
  themeId?: string;
}

const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/svg+xml',
  'image/webp',
]);

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

@Injectable()
export class ThemeUploadService {
  private readonly logger = new Logger(ThemeUploadService.name);
  private readonly uploadsDir = join(process.cwd(), 'uploads', 'themes');

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Ensures the upload directory exists for a realm.
   */
  private async ensureUploadDir(realmId: string): Promise<string> {
    const dir = join(this.uploadsDir, realmId);
    if (!(await pathExists(dir))) {
      await mkdir(dir, { recursive: true });
    }
    return dir;
  }

  /**
   * Validates a file's MIME type.
   */
  private isValidMimeType(mimeType: string): boolean {
    return ALLOWED_MIME_TYPES.has(mimeType);
  }

  /**
   * Sanitizes a filename to prevent path traversal attacks.
   */
  private sanitizeFilename(filename: string): string {
    // Remove any path components and keep only the base filename
    const basename = filename.split('/').pop() ?? filename;
    const cleanName = basename.replace(/[^a-zA-Z0-9._-]/g, '_');
    // Limit filename length
    return cleanName.substring(0, 100);
  }

  /**
   * Uploads a theme asset (logo, favicon, etc.) and optionally associates it with a theme.
   *
   * @param realmName - The realm name (used for lookup)
   * @param fileData - Base64-encoded file data or file metadata
   * @param themeId - Optional theme ID to associate the asset with
   * @returns The result containing the uploaded asset information
   */
  async uploadAsset(
    realmName: string,
    fileData: {
      data: string;
      filename: string;
      mimeType: string;
      size?: number;
    },
    themeId?: string,
  ): Promise<UploadedAsset> {
    const realm = await this.prisma.realm.findUnique({
      where: { name: realmName },
      select: { id: true, name: true },
    });

    if (!realm) {
      throw new Error(`Realm '${realmName}' not found`);
    }

    // Validate MIME type
    if (!this.isValidMimeType(fileData.mimeType)) {
      throw new Error(
        `Invalid file type: ${fileData.mimeType}. Allowed types: PNG, JPEG, GIF, SVG, WebP`,
      );
    }

    // Validate file size
    if (fileData.size && fileData.size > MAX_FILE_SIZE) {
      throw new Error(`File too large. Maximum size is 5MB`);
    }

    // Generate a unique filename to avoid collisions
    const timestamp = Date.now();
    const randomSuffix = randomBytes(4).toString('hex');
    const sanitizedName = this.sanitizeFilename(fileData.filename);
    const ext = this.getExtension(fileData.mimeType);
    const uniqueFilename = `${timestamp}-${randomSuffix}-${sanitizedName}${ext}`;

    const uploadDir = await this.ensureUploadDir(realm.id);
    const filePath = join(uploadDir, uniqueFilename);

    // Decode base64 data and write file
    const buffer = Buffer.from(fileData.data, 'base64');
    await writeFile(filePath, buffer);

    this.logger.log(
      `Asset uploaded: ${uniqueFilename} for realm ${realm.name} (theme: ${themeId ?? 'unassigned'})`,
    );

    return {
      filename: uniqueFilename,
      originalName: fileData.filename,
      mimeType: fileData.mimeType,
      size: buffer.length,
      url: `/themes/assets/${realm.name}/${uniqueFilename}`,
    };
  }

  /**
   * Uploads multiple assets for a realm.
   *
   * @param realmName - The realm name
   * @param files - Array of file data objects
   * @param themeId - Optional theme ID to associate assets with
   * @returns Result containing all uploaded assets
   */
  async uploadMultipleAssets(
    realmName: string,
    files: Array<{
      data: string;
      filename: string;
      mimeType: string;
      size?: number;
    }>,
    themeId?: string,
  ): Promise<ThemeAssetUploadResult> {
    const assets: UploadedAsset[] = [];
    const errors: string[] = [];

    for (const file of files) {
      try {
        const asset = await this.uploadAsset(realmName, file, themeId);
        assets.push(asset);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${file.filename}: ${message}`);
        this.logger.warn(`Failed to upload asset ${file.filename}: ${message}`);
      }
    }

    return {
      success: errors.length === 0,
      assets,
      themeId,
    };
  }

  /**
   * Deletes an asset file.
   */
  async deleteAsset(realmName: string, filename: string): Promise<boolean> {
    const realm = await this.prisma.realm.findUnique({
      where: { name: realmName },
      select: { id: true },
    });

    if (!realm) {
      return false;
    }

    const filePath = join(this.uploadsDir, realm.id, filename);

    try {
      if (await pathExists(filePath)) {
        await unlink(filePath);
        this.logger.log(`Asset deleted: ${filename} for realm ${realmName}`);
        return true;
      }
    } catch (error) {
      this.logger.error(`Failed to delete asset ${filename}:`, error);
    }

    return false;
  }

  /**
   * Gets the MIME type's file extension.
   */
  private getExtension(mimeType: string): string {
    const extensions: Record<string, string> = {
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
      'image/gif': '.gif',
      'image/svg+xml': '.svg',
      'image/webp': '.webp',
    };
    return extensions[mimeType] ?? '';
  }

  /**
   * Checks if an asset exists for a realm.
   */
  async assetExists(realmName: string, filename: string): Promise<boolean> {
    const realm = await this.prisma.realm.findUnique({
      where: { name: realmName },
      select: { id: true },
    });

    if (!realm) {
      return false;
    }

    const filePath = join(this.uploadsDir, realm.id, filename);
    return pathExists(filePath);
  }
}
