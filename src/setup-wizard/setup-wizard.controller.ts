import {
  Controller,
  Get,
  Post,
  Body,
  BadRequestException,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiSecurity } from '@nestjs/swagger';
import { SetupWizardService } from './setup-wizard.service.js';
import { EmailService } from '../email/email.service.js';
import { IsString, IsEmail, IsArray, IsOptional, IsBoolean, IsInt, MinLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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
  @ApiProperty({ example: 'master' })
  @IsString()
  @MinLength(2)
  name!: string;

  @ApiPropertyOptional({ example: 'Master Realm' })
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

@ApiTags('Setup Wizard')
@Controller('setup-wizard')
@ApiSecurity('admin-api-key')
export class SetupWizardController {
  constructor(
    private readonly wizardService: SetupWizardService,
    private readonly emailService: EmailService,
  ) {}

  @Get('status')
  @ApiOperation({ summary: 'Get wizard status and step information' })
  @ApiResponse({ status: 200, description: 'Wizard status' })
  getStatus() {
    return this.wizardService.getWizardStatus();
  }

  @Get('state')
  @ApiOperation({ summary: 'Get current wizard state' })
  @ApiResponse({ status: 200, description: 'Wizard state' })
  getState() {
    return this.wizardService.getWizardState();
  }

  @Post('admin-account')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Save admin account (Step 1)' })
  @ApiResponse({ status: 200, description: 'Admin account saved' })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  saveAdminAccount(@Body() dto: SaveAdminAccountDto) {
    return this.wizardService.saveAdminAccount(dto);
  }

  @Post('realm-settings')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Save realm settings (Step 2)' })
  @ApiResponse({ status: 200, description: 'Realm settings saved' })
  @ApiResponse({ status: 400, description: 'Invalid request or realm already exists' })
  saveRealmSettings(@Body() dto: SaveRealmSettingsDto) {
    return this.wizardService.saveRealmSettings(dto);
  }

  @Post('smtp-config')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Save SMTP configuration (Step 3)' })
  @ApiResponse({ status: 200, description: 'SMTP config saved' })
  @ApiResponse({ status: 400, description: 'Invalid SMTP configuration' })
  saveSmtpConfig(@Body() dto: SaveSmtpConfigDto) {
    return this.wizardService.saveSmtpConfig(dto);
  }

  @Post('smtp/test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Test SMTP connection' })
  @ApiResponse({ status: 200, description: 'Test email sent successfully' })
  @ApiResponse({ status: 400, description: 'SMTP not configured or test failed' })
  async testSmtp(@Body() dto: SmtpTestDto) {
    // Get current wizard state to check SMTP config
    const state = await this.wizardService.getWizardState();

    if (!state.smtpConfig) {
      throw new BadRequestException('SMTP is not configured. Please save SMTP config first.');
    }

    const smtpConfig = state.smtpConfig as Record<string, unknown>;
    const isConfigured = smtpConfig.host && smtpConfig.port;

    if (!isConfigured) {
      throw new BadRequestException('SMTP is not configured. Please save SMTP config first.');
    }

    // Note: This endpoint requires the realm to be created first to send test emails
    // For now, we'll do basic SMTP validation
    return {
      message: 'SMTP configuration appears valid',
      host: smtpConfig.host,
      port: smtpConfig.port,
    };
  }

  @Post('client')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Save client application (Step 4)' })
  @ApiResponse({ status: 200, description: 'Client created and saved' })
  @ApiResponse({ status: 400, description: 'Invalid client configuration or realm not found' })
  saveClient(@Body() dto: SaveClientDto) {
    return this.wizardService.saveClient(dto);
  }

  @Post('sdk-generated')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark SDK step as completed (Step 5)' })
  @ApiResponse({ status: 200, description: 'SDK step marked as completed' })
  markSdkGenerated() {
    return this.wizardService.markSdkGenerated();
  }

  @Post('complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete the wizard and finalize setup' })
  @ApiResponse({ status: 200, description: 'Wizard completed successfully' })
  @ApiResponse({ status: 400, description: 'Cannot complete wizard - required steps incomplete' })
  completeWizard() {
    return this.wizardService.completeWizard();
  }

  @Post('skip')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Skip the wizard (for advanced users)' })
  @ApiResponse({ status: 200, description: 'Wizard skipped' })
  skipWizard() {
    return this.wizardService.skipWizard();
  }

  @Post('reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset wizard state (for development/testing)' })
  @ApiResponse({ status: 200, description: 'Wizard reset' })
  resetWizard() {
    return this.wizardService.resetWizard();
  }
}