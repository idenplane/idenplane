import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiSecurity,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';
import { ThemeService } from './theme.service.js';
import { ThemePreviewService } from './theme-preview.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateThemeDto } from './dto/create-theme.dto.js';
import { UpdateThemeDto } from './dto/update-theme.dto.js';
import { UploadThemeAssetDto } from './dto/upload-theme-asset.dto.js';
import { RenderThemePreviewDto } from './dto/render-theme-preview.dto.js';
import { ThemeUploadService } from './theme-upload.service.js';
import { AdminApiKeyGuard } from '../common/guards/admin-api-key.guard.js';
import { AdminRolesGuard } from '../common/guards/admin-roles.guard.js';
import { RequireAdminRoles } from '../common/decorators/require-admin-roles.decorator.js';

@ApiTags('Themes')
@Controller('admin/realms/:realmName/themes')
@ApiSecurity('admin-api-key')
@UseGuards(AdminApiKeyGuard, AdminRolesGuard)
export class ThemeController {
  constructor(
    private readonly themeService: ThemeService,
    private readonly previewService: ThemePreviewService,
    private readonly prisma: PrismaService,
    private readonly uploadService: ThemeUploadService,
  ) {}

  private async getRealmId(realmName: string): Promise<string> {
    const realm = await this.prisma.realm.findUnique({
      where: { name: realmName },
    });
    if (!realm) {
      throw new NotFoundException(`Realm '${realmName}' not found`);
    }
    return realm.id;
  }

  @Post()
  @RequireAdminRoles(['super-admin', 'admin'])
  @ApiOperation({ summary: 'Create a new theme' })
  @ApiResponse({ status: 201, description: 'Theme created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiParam({ name: 'realmName', description: 'Realm name' })
  async create(
    @Param('realmName') realmName: string,
    @Body() dto: CreateThemeDto,
  ) {
    const realmId = await this.getRealmId(realmName);
    return this.themeService.createTheme(realmId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all themes for a realm' })
  @ApiResponse({ status: 200, description: 'List of themes' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiParam({ name: 'realmName', description: 'Realm name' })
  async findAll(@Param('realmName') realmName: string) {
    const realmId = await this.getRealmId(realmName);
    return this.themeService.findAllByRealm(realmId);
  }

  @Get('built-in')
  @ApiOperation({ summary: 'List available built-in themes' })
  @ApiResponse({ status: 200, description: 'List of built-in themes' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiParam({ name: 'realmName', description: 'Realm name' })
  getBuiltInThemes() {
    return this.themeService.getAvailableThemes();
  }

  @Get(':themeId')
  @ApiOperation({ summary: 'Get a theme by ID' })
  @ApiResponse({ status: 200, description: 'Theme details' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Theme not found' })
  @ApiParam({ name: 'realmName', description: 'Realm name' })
  @ApiParam({ name: 'themeId', description: 'Theme ID' })
  async findOne(
    @Param('realmName') realmName: string,
    @Param('themeId') themeId: string,
  ) {
    await this.getRealmId(realmName); // Verify realm exists
    const theme = await this.themeService.findById(themeId);
    if (!theme) {
      return { error: 'Theme not found' };
    }
    return theme;
  }

  @Put(':themeId')
  @RequireAdminRoles(['super-admin', 'admin'])
  @ApiOperation({ summary: 'Update a theme' })
  @ApiResponse({ status: 200, description: 'Theme updated successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Theme not found' })
  @ApiParam({ name: 'realmName', description: 'Realm name' })
  @ApiParam({ name: 'themeId', description: 'Theme ID' })
  async update(
    @Param('realmName') realmName: string,
    @Param('themeId') themeId: string,
    @Body() dto: UpdateThemeDto,
  ) {
    await this.getRealmId(realmName); // Verify realm exists
    return this.themeService.updateTheme(themeId, dto);
  }

  @Delete(':themeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireAdminRoles(['super-admin'])
  @ApiOperation({ summary: 'Delete a theme' })
  @ApiResponse({ status: 204, description: 'Theme deleted successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - requires super-admin role',
  })
  @ApiResponse({ status: 404, description: 'Theme not found' })
  @ApiParam({ name: 'realmName', description: 'Realm name' })
  @ApiParam({ name: 'themeId', description: 'Theme ID' })
  async remove(
    @Param('realmName') realmName: string,
    @Param('themeId') themeId: string,
  ) {
    await this.getRealmId(realmName); // Verify realm exists
    await this.themeService.deleteTheme(themeId);
  }

  @Post(':themeId/publish')
  @HttpCode(HttpStatus.OK)
  @RequireAdminRoles(['super-admin', 'admin'])
  @ApiOperation({ summary: 'Publish a theme' })
  @ApiResponse({ status: 200, description: 'Theme published successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Theme not found' })
  @ApiParam({ name: 'realmName', description: 'Realm name' })
  @ApiParam({ name: 'themeId', description: 'Theme ID' })
  async publish(
    @Param('realmName') realmName: string,
    @Param('themeId') themeId: string,
  ) {
    await this.getRealmId(realmName); // Verify realm exists
    return this.themeService.publishTheme(themeId);
  }

  @Get(':themeId/versions')
  @ApiOperation({ summary: 'Get version history for a theme' })
  @ApiResponse({ status: 200, description: 'List of theme versions' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Theme not found' })
  @ApiParam({ name: 'realmName', description: 'Realm name' })
  @ApiParam({ name: 'themeId', description: 'Theme ID' })
  async getVersions(
    @Param('realmName') realmName: string,
    @Param('themeId') themeId: string,
  ) {
    await this.getRealmId(realmName); // Verify realm exists
    return this.themeService.getVersionHistory(themeId);
  }

  @Post(':themeId/restore/:version')
  @HttpCode(HttpStatus.OK)
  @RequireAdminRoles(['super-admin', 'admin'])
  @ApiOperation({ summary: 'Restore a theme to a specific version' })
  @ApiResponse({ status: 200, description: 'Theme restored successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Theme or version not found' })
  @ApiParam({ name: 'realmName', description: 'Realm name' })
  @ApiParam({ name: 'themeId', description: 'Theme ID' })
  @ApiParam({ name: 'version', description: 'Version number to restore' })
  async restore(
    @Param('realmName') realmName: string,
    @Param('themeId') themeId: string,
    @Param('version') version: number,
  ) {
    await this.getRealmId(realmName); // Verify realm exists
    return this.themeService.restoreVersion(themeId, version);
  }

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Render theme preview HTML (for live preview in Theme Builder)',
  })
  @ApiResponse({ status: 200, description: 'Rendered preview HTML' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiParam({ name: 'realmName', description: 'Realm name' })
  async renderPreview(
    @Param('realmName') realmName: string,
    @Body() dto: RenderThemePreviewDto,
  ) {
    await this.getRealmId(realmName); // Verify realm exists
    const html = this.previewService.renderPreview({
      styles: dto.styles || {},
      components: dto.components,
      assets: dto.assets,
      settings: dto.settings,
    });
    return { html };
  }

  @Post('assets/upload')
  @HttpCode(HttpStatus.CREATED)
  @RequireAdminRoles(['super-admin', 'admin'])
  @ApiOperation({ summary: 'Upload theme assets (logos, favicons, etc.)' })
  @ApiResponse({ status: 201, description: 'Asset(s) uploaded successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiParam({ name: 'realmName', description: 'Realm name' })
  async uploadAssets(
    @Param('realmName') realmName: string,
    @Body() dto: UploadThemeAssetDto,
  ) {
    await this.getRealmId(realmName); // Verify realm exists
    return this.uploadService.uploadMultipleAssets(
      realmName,
      dto.files,
      dto.themeId,
    );
  }
}
