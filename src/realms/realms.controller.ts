import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  BadRequestException,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiSecurity,
  ApiResponse,
} from '@nestjs/swagger';
import { RealmsService } from './realms.service.js';
import { RealmExportService } from './realm-export.service.js';
import { RealmImportService } from './realm-import.service.js';
import { EmailService } from '../email/email.service.js';
import { ThemeService } from '../theme/theme.service.js';
import { ThemeEmailService } from '../theme/theme-email.service.js';
import { CreateRealmDto } from './dto/create-realm.dto.js';
import { UpdateRealmDto } from './dto/update-realm.dto.js';
import { IsEmail } from 'class-validator';
import { AdminApiKeyGuard } from '../common/guards/admin-api-key.guard.js';
import { AdminRolesGuard } from '../common/guards/admin-roles.guard.js';
import { RequireAdminRoles } from '../common/decorators/require-admin-roles.decorator.js';

@ApiTags('Realms')
@Controller('admin/realms')
@ApiSecurity('admin-api-key')
@UseGuards(AdminApiKeyGuard, AdminRolesGuard)
export class RealmsController {
  constructor(
    private readonly realmsService: RealmsService,
    private readonly exportService: RealmExportService,
    private readonly importService: RealmImportService,
    private readonly emailService: EmailService,
    private readonly themeService: ThemeService,
    private readonly themeEmail: ThemeEmailService,
  ) {}

  @Post()
  @RequireAdminRoles(['super-admin'])
  @ApiOperation({ summary: 'Create a new realm' })
  @ApiResponse({ status: 201, description: 'Realm created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - requires super-admin role',
  })
  create(@Body() dto: CreateRealmDto) {
    return this.realmsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all realms' })
  @ApiResponse({ status: 200, description: 'List of realms' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  findAll() {
    return this.realmsService.findAll();
  }

  @Get('themes')
  @ApiOperation({ summary: 'List available themes' })
  @ApiResponse({ status: 200, description: 'List of available themes' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  getThemes() {
    return this.themeService.getAvailableThemes();
  }

  @Get(':realmName')
  @ApiOperation({ summary: 'Get a realm by name' })
  @ApiResponse({ status: 200, description: 'Realm details' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Realm not found' })
  findOne(@Param('realmName') realmName: string) {
    return this.realmsService.findByName(realmName);
  }

  @Put(':realmName')
  @RequireAdminRoles(['super-admin'])
  @ApiOperation({ summary: 'Update a realm' })
  @ApiResponse({ status: 200, description: 'Realm updated successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - requires super-admin role',
  })
  @ApiResponse({ status: 404, description: 'Realm not found' })
  update(@Param('realmName') realmName: string, @Body() dto: UpdateRealmDto) {
    return this.realmsService.update(realmName, dto);
  }

  @Patch(':realmName')
  @RequireAdminRoles(['super-admin'])
  @ApiOperation({ summary: 'Partially update a realm' })
  @ApiResponse({ status: 200, description: 'Realm updated successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - requires super-admin role',
  })
  @ApiResponse({ status: 404, description: 'Realm not found' })
  partialUpdate(
    @Param('realmName') realmName: string,
    @Body() dto: UpdateRealmDto,
  ) {
    return this.realmsService.update(realmName, dto);
  }

  @Delete(':realmName')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireAdminRoles(['super-admin'])
  @ApiOperation({ summary: 'Delete a realm' })
  @ApiResponse({ status: 204, description: 'Realm deleted successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - requires super-admin role',
  })
  @ApiResponse({ status: 404, description: 'Realm not found' })
  remove(@Param('realmName') realmName: string) {
    return this.realmsService.remove(realmName);
  }

  @Get(':realmName/export')
  @ApiOperation({ summary: 'Export a realm to JSON' })
  @ApiResponse({ status: 200, description: 'Realm export data' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Realm not found' })
  exportRealm(
    @Param('realmName') realmName: string,
    @Query('includeUsers') includeUsers?: string,
    @Query('includeSecrets') includeSecrets?: string,
  ) {
    return this.exportService.exportRealm(realmName, {
      includeUsers: includeUsers === 'true',
      includeSecrets: includeSecrets === 'true',
    });
  }

  @Post('import')
  @RequireAdminRoles(['super-admin'])
  @ApiOperation({ summary: 'Import a realm from JSON' })
  @ApiResponse({ status: 201, description: 'Realm imported successfully' })
  @ApiResponse({ status: 400, description: 'Invalid import data' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - requires super-admin role',
  })
  importRealm(
    @Body() body: Record<string, unknown>,
    @Query('overwrite') overwrite?: string,
  ) {
    return this.importService.importRealm(body, {
      overwrite: overwrite === 'true',
    });
  }

  @Post(':realmName/smtp/test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Test SMTP configuration' })
  @ApiResponse({ status: 200, description: 'SMTP test result' })
  @ApiResponse({ status: 400, description: 'SMTP not configured' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Realm not found' })
  async testSmtp(@Param('realmName') realmName: string) {
    return this.emailService.sendTestEmail(realmName);
  }

  @Post(':realmName/email/test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a test email' })
  @ApiResponse({ status: 200, description: 'Test email sent successfully' })
  @ApiResponse({
    status: 400,
    description: 'Missing recipient or SMTP not configured',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Realm not found' })
  async sendTestEmail(
    @Param('realmName') realmName: string,
    @Body('to') to: string,
  ) {
    if (!to) {
      throw new BadRequestException('Missing "to" email address');
    }
    const configured = await this.emailService.isConfigured(realmName);
    if (!configured) {
      throw new BadRequestException('SMTP is not configured for this realm');
    }
    const realm = await this.realmsService.findByName(realmName);
    const subject = this.themeEmail.getSubject(realm, 'testEmailSubject');
    const html = this.themeEmail.renderEmail(realm, 'test-email', {});
    await this.emailService.sendEmail(realmName, to, subject, html);
    return { message: 'Test email sent successfully' };
  }
}
