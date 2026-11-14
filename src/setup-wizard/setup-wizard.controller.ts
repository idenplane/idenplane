import {
  Controller,
  Get,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { SetupWizardService } from './setup-wizard.service.js';
import {
  IsString,
  IsEmail,
  IsArray,
  IsOptional,
  IsBoolean,
  IsInt,
  MinLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { wizardSecrets } from './wizard-secrets.js';
import { AdminApiKeyGuard } from '../common/guards/admin-api-key.guard.js';
import { AdminRolesGuard } from '../common/guards/admin-roles.guard.js';
import { RequireAdminAuth } from '../common/decorators/require-admin-auth.decorator.js';
import { RequireAdminRoles } from '../common/decorators/require-admin-roles.decorator.js';
import { AdminScope } from '../common/decorators/admin-access.decorator.js';

class SaveAdminAccountDto {
  @ApiProperty({ example: 'admin' })
  @IsString()
  @MinLength(3)
  username!: string;

  @ApiProperty({ example: 'admin@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Password123!' })
  @IsString()
  @MinLength(8)
  password!: string;
}

class SaveRealmSettingsDto {
  @ApiProperty({ example: 'my-company' })
  @IsString()
  @MinLength(2)
  name!: string;

  @ApiPropertyOptional({ example: 'My Company' })
  @IsOptional()
  @IsString()
  displayName?: string;
}

class SaveSmtpConfigDto {
  @ApiProperty({ example: 'smtp.example.com' })
  @IsString()
  host!: string;

  @ApiProperty({ example: 587 })
  @IsInt()
  @Min(1)
  port!: number;

  @ApiPropertyOptional({ example: 'user@example.com' })
  @IsOptional()
  @IsString()
  user?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  password?: string;

  @ApiProperty({ example: 'noreply@example.com' })
  @IsString()
  from!: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  secure?: boolean;
}

class SaveClientDto {
  @ApiProperty({ example: 'my-app' })
  @IsString()
  @MinLength(3)
  clientId!: string;

  @ApiProperty({ example: ['http://localhost:3000/callback'] })
  @IsArray()
  @IsString({ each: true })
  redirectUris!: string[];
}

class SmtpTestDto {
  @ApiProperty({ example: 'test@example.com' })
  @IsEmail()
  to!: string;
}

/** Every wizard endpoint, without exception, is for a super-admin only. */
const SUPER_ADMIN = ['super-admin'];

/**
 * The first-run setup wizard.
 *
 * Not under `/admin`, so @RequireAdminAuth() makes AdminApiKeyGuard demand
 * the same credentials as the admin API (an admin JWT or the static admin
 * API key), and every handler requires the super-admin role. The master
 * realm and its admin are seeded on first start, so there is always someone
 * who can sign in to run the wizard. Writes answer 409 once setup is
 * completed or skipped (see SetupWizardService).
 */
@ApiTags('Setup Wizard')
@Controller('setup-wizard')
@AdminScope('global')
@RequireAdminAuth()
@UseGuards(AdminApiKeyGuard, AdminRolesGuard)
@ApiSecurity('admin-api-key')
@ApiBearerAuth()
@ApiResponse({
  status: 401,
  description: 'Missing or invalid admin credentials',
})
@ApiResponse({ status: 403, description: 'The super-admin role is required' })
export class SetupWizardController {
  constructor(private readonly wizardService: SetupWizardService) {}

  @Get('status')
  @RequireAdminRoles(SUPER_ADMIN)
  @ApiOperation({ summary: 'Get wizard status and step information' })
  @ApiResponse({ status: 200, description: 'Wizard status' })
  getStatus() {
    return this.wizardService.getWizardStatus();
  }

  @Get('state')
  @RequireAdminRoles(SUPER_ADMIN)
  @ApiOperation({
    summary: 'Get current wizard state',
    description: 'Never includes a password hash or a client secret.',
  })
  @ApiResponse({ status: 200, description: 'Wizard state' })
  async getState() {
    return wizardSecrets.publicState(await this.wizardService.getWizardState());
  }

  @Post('admin-account')
  @RequireAdminRoles(SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Save admin account (Step 1)' })
  @ApiResponse({ status: 200, description: 'Admin account saved' })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  @ApiResponse({ status: 409, description: 'Setup is already complete' })
  async saveAdminAccount(@Body() dto: SaveAdminAccountDto) {
    return wizardSecrets.publicState(
      await this.wizardService.saveAdminAccount(dto),
    );
  }

  @Post('realm-settings')
  @RequireAdminRoles(SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Save realm settings (Step 2)' })
  @ApiResponse({ status: 200, description: 'Realm settings saved' })
  @ApiResponse({
    status: 400,
    description: 'Invalid request or realm already exists',
  })
  @ApiResponse({ status: 409, description: 'Setup is already complete' })
  async saveRealmSettings(@Body() dto: SaveRealmSettingsDto) {
    return wizardSecrets.publicState(
      await this.wizardService.saveRealmSettings(dto),
    );
  }

  @Post('smtp-config')
  @RequireAdminRoles(SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Save SMTP configuration (Step 3)' })
  @ApiResponse({ status: 200, description: 'SMTP config saved' })
  @ApiResponse({ status: 400, description: 'Invalid SMTP configuration' })
  @ApiResponse({ status: 409, description: 'Setup is already complete' })
  async saveSmtpConfig(@Body() dto: SaveSmtpConfigDto) {
    return wizardSecrets.publicState(
      await this.wizardService.saveSmtpConfig(dto),
    );
  }

  @Post('smtp/test')
  @RequireAdminRoles(SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Check the saved SMTP configuration',
    description:
      'Only while setup is open, and only with the settings saved in the ' +
      'wizard. After setup, use the realm SMTP test in the admin API.',
  })
  @ApiResponse({ status: 200, description: 'SMTP configuration looks valid' })
  @ApiResponse({ status: 400, description: 'SMTP not configured' })
  @ApiResponse({ status: 409, description: 'Setup is already complete' })
  testSmtp(@Body() _dto: SmtpTestDto) {
    return this.wizardService.testSmtp();
  }

  @Post('client')
  @RequireAdminRoles(SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Save client application (Step 4)',
    description:
      'The response carries the generated client secret, once. It is never ' +
      'stored in plaintext or returned again.',
  })
  @ApiResponse({ status: 200, description: 'Client created and saved' })
  @ApiResponse({
    status: 400,
    description: 'Invalid client configuration or realm not found',
  })
  @ApiResponse({ status: 409, description: 'Setup is already complete' })
  async saveClient(@Body() dto: SaveClientDto) {
    const saved = await this.wizardService.saveClient(dto);
    return {
      ...wizardSecrets.publicState(saved),
      clientSecret: saved.clientSecret,
    };
  }

  @Post('sdk-generated')
  @RequireAdminRoles(SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark SDK step as completed (Step 5)' })
  @ApiResponse({ status: 200, description: 'SDK step marked as completed' })
  @ApiResponse({ status: 409, description: 'Setup is already complete' })
  async markSdkGenerated() {
    return wizardSecrets.publicState(
      await this.wizardService.markSdkGenerated(),
    );
  }

  @Post('complete')
  @RequireAdminRoles(SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete the wizard and finalize setup' })
  @ApiResponse({ status: 200, description: 'Wizard completed successfully' })
  @ApiResponse({
    status: 400,
    description: 'Cannot complete wizard - required steps incomplete',
  })
  @ApiResponse({
    status: 409,
    description: 'Setup is already complete, or the realm already exists',
  })
  completeWizard() {
    return this.wizardService.completeWizard();
  }

  @Post('skip')
  @RequireAdminRoles(SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Skip the wizard (for advanced users)' })
  @ApiResponse({ status: 200, description: 'Wizard skipped' })
  @ApiResponse({ status: 409, description: 'Setup is already complete' })
  async skipWizard() {
    return wizardSecrets.publicState(await this.wizardService.skipWizard());
  }

  @Post('reset')
  @RequireAdminRoles(SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Clear the answers of a wizard in progress',
    description:
      'Only clears the wizard state; never touches realms, users or ' +
      'clients. Refused once setup is completed or skipped.',
  })
  @ApiResponse({ status: 200, description: 'Wizard answers cleared' })
  @ApiResponse({ status: 409, description: 'Setup is already complete' })
  async resetWizard() {
    return wizardSecrets.publicState(await this.wizardService.resetWizard());
  }
}
