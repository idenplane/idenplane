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
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiSecurity,
  ApiResponse,
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';
import {
  REALM_EXPORT_V2_SCHEMA,
  REALM_IMPORT_RESULT_SCHEMA,
} from './export/realm-export.openapi.js';
import { RealmsService } from './realms.service.js';
import { RealmExportService } from './realm-export.service.js';
import { RealmImportService } from './realm-import.service.js';
import { EmailService } from '../email/email.service.js';
import { ThemeService } from '../theme/theme.service.js';
import { ThemeEmailService } from '../theme/theme-email.service.js';
import { CreateRealmDto } from './dto/create-realm.dto.js';
import { UpdateRealmDto } from './dto/update-realm.dto.js';
import { AdminApiKeyGuard } from '../common/guards/admin-api-key.guard.js';
import { AdminRolesGuard } from '../common/guards/admin-roles.guard.js';
import { RequireAdminRoles } from '../common/decorators/require-admin-roles.decorator.js';
import {
  AdminScope,
  AdminSensitiveRead,
} from '../common/decorators/admin-access.decorator.js';
import {
  canReadRealm,
  type AdminPrincipal,
} from '../admin-rbac/admin-access-policy.js';

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
  @AdminScope('global')
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

  /**
   * Every admin may list realms; the list holds only the realms the caller
   * may read (a realm-admin sees its own realms).
   */
  @Get()
  @AdminScope('self')
  @ApiOperation({ summary: 'List the realms the caller may read' })
  @ApiResponse({ status: 200, description: 'List of realms' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async findAll(@Req() req: Request & { adminPrincipal?: AdminPrincipal }) {
    const principal = req.adminPrincipal;
    if (!principal) return [];
    const realms = await this.realmsService.findAll();
    return realms.filter(
      (realm) =>
        realm !== null &&
        typeof realm['id'] === 'string' &&
        typeof realm['name'] === 'string' &&
        canReadRealm(principal, { id: realm['id'], name: realm['name'] }),
    );
  }

  @Get('themes')
  @AdminScope('self')
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
  @AdminScope('global')
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
  @AdminScope('global')
  @AdminSensitiveRead()
  @ApiOperation({
    summary: 'Export a realm to JSON',
    description:
      'Exports the realm configuration in format version 2: every realm and client setting, flows and their bindings, scopes, roles, groups and their role mappings, identity providers, federation, certificate trust, organizations, webhooks and the other configuration tables. Never exported: signing keys, user credentials, sessions, tokens and event logs.',
  })
  @ApiQuery({
    name: 'includeUsers',
    required: false,
    type: Boolean,
    description: 'Include users (no password hashes or MFA factors)',
  })
  @ApiQuery({
    name: 'includeSecrets',
    required: false,
    type: Boolean,
    description:
      'Include secrets: client secret hashes, and decrypted SMTP, CAPTCHA, SMS/email provider, identity provider, LDAP, webhook and audit stream credentials',
  })
  @ApiResponse({
    status: 200,
    description: 'Realm export data',
    schema: REALM_EXPORT_V2_SCHEMA,
  })
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
  @AdminScope('global')
  @RequireAdminRoles(['super-admin'])
  @ApiOperation({
    summary: 'Import a realm from JSON',
    description:
      'Imports a realm export (format version 2, or version 1 as before). The whole file is validated first; a 400 lists every problem with its path. The import runs in one transaction: on any failure nothing is created, and with overwrite=true the existing realm is kept.',
  })
  @ApiQuery({
    name: 'overwrite',
    required: false,
    type: Boolean,
    description: 'Replace an existing realm of the same name',
  })
  @ApiBody({ schema: REALM_EXPORT_V2_SCHEMA })
  @ApiResponse({
    status: 201,
    description: 'Realm imported successfully',
    schema: REALM_IMPORT_RESULT_SCHEMA,
  })
  @ApiResponse({
    status: 400,
    description:
      'Invalid import data: `errors` lists `{ path, message }` for every problem',
  })
  @ApiResponse({
    status: 409,
    description: 'The realm exists and overwrite is not set',
  })
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
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Realm not found' })
  async testSmtp(@Param('realmName') realmName: string) {
    return this.emailService.sendTestEmail(realmName);
  }

  @Post(':realmName/email/test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a test email' })
  @ApiResponse({ status: 200, description: 'Test email result' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Realm not found' })
  async sendTestEmail(
    @Param('realmName') realmName: string,
    @Body('to') to: string,
  ) {
    if (!to) {
      return { success: false, error: 'Missing "to" email address' };
    }
    const configured = await this.emailService.isConfigured(realmName);
    if (!configured) {
      return { success: false, error: 'SMTP is not configured for this realm' };
    }
    const realm = await this.realmsService.findByName(realmName);
    const subject = this.themeEmail.getSubject(realm, 'testEmailSubject');
    const html = this.themeEmail.renderEmail(realm, 'test-email', {});
    await this.emailService.sendEmail(realmName, to, subject, html);
    return { success: true, message: 'Test email sent successfully' };
  }
}
