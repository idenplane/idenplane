import { IsString, IsOptional, IsBoolean, IsInt, IsArray, IsEmail, IsObject, MinLength, Min, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO for wizard state response
 */
export class WizardStateDto {
  @ApiProperty({ description: 'Wizard state ID' })
  @IsString()
  id!: string;

  @ApiProperty({ description: 'Whether wizard is completed' })
  @IsBoolean()
  completed!: boolean;

  @ApiProperty({ description: 'Whether wizard was skipped' })
  @IsBoolean()
  skipped!: boolean;

  @ApiProperty({ description: 'Current step (0-based)' })
  @IsInt()
  currentStep!: number;

  @ApiPropertyOptional({ description: 'Admin username' })
  @IsOptional()
  @IsString()
  adminUsername?: string;

  @ApiPropertyOptional({ description: 'Admin email' })
  @IsOptional()
  @IsEmail()
  adminEmail?: string;

  @ApiPropertyOptional({ description: 'Realm name' })
  @IsOptional()
  @IsString()
  realmName?: string;

  @ApiPropertyOptional({ description: 'Realm display name' })
  @IsOptional()
  @IsString()
  realmDisplayName?: string;

  @ApiPropertyOptional({ description: 'SMTP configuration' })
  @IsOptional()
  @IsObject()
  smtpConfig?: SmtpConfigDto;

  @ApiPropertyOptional({ description: 'Client ID' })
  @IsOptional()
  @IsString()
  clientId?: string;

  @ApiPropertyOptional({ description: 'Client secret (only available during wizard)' })
  @IsOptional()
  @IsString()
  clientSecret?: string;

  @ApiPropertyOptional({ description: 'Redirect URIs', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  redirectUris?: string[];

  @ApiProperty({ description: 'Whether SDK was generated' })
  @IsBoolean()
  sdkGenerated!: boolean;

  @ApiProperty({ description: 'Creation timestamp' })
  @IsString()
  createdAt!: string;

  @ApiProperty({ description: 'Last update timestamp' })
  @IsString()
  updatedAt!: string;
}

/**
 * SMTP configuration embedded in wizard state
 */
export class SmtpConfigDto {
  @ApiProperty({ example: 'smtp.example.com' })
  @IsString()
  host!: string;

  @ApiProperty({ example: 587 })
  @IsInt()
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

/**
 * Individual wizard step information
 */
export class WizardStepDto {
  @ApiProperty({ example: 0 })
  @IsInt()
  index!: number;

  @ApiProperty({ example: 'Admin Account' })
  @IsString()
  name!: string;

  @ApiProperty({ example: 'Create your admin account' })
  @IsString()
  description!: string;

  @ApiProperty({ description: 'Whether step is completed' })
  @IsBoolean()
  completed!: boolean;

  @ApiProperty({ description: 'Whether step is required' })
  @IsBoolean()
  required!: boolean;
}

/**
 * Wizard status response with step details
 */
export class WizardStatusDto {
  @ApiProperty({ description: 'Whether this is first run' })
  @IsBoolean()
  isFirstRun!: boolean;

  @ApiProperty({ description: 'Whether wizard is completed' })
  @IsBoolean()
  wizardCompleted!: boolean;

  @ApiProperty({ description: 'Whether wizard was skipped' })
  @IsBoolean()
  wizardSkipped!: boolean;

  @ApiProperty({ example: 0 })
  @IsInt()
  currentStep!: number;

  @ApiProperty({ example: 6 })
  @IsInt()
  totalSteps!: number;

  @ApiProperty({ description: 'Step information', type: [WizardStepDto] })
  @IsArray()
  steps!: WizardStepDto[];
}

/**
 * DTO for saving admin account (Step 1)
 */
export class SaveAdminAccountDto {
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

/**
 * DTO for saving realm settings (Step 2)
 */
export class SaveRealmSettingsDto {
  @ApiProperty({ example: 'master' })
  @IsString()
  @MinLength(2)
  @Matches(/^[a-z][a-z0-9-]*$/, {
    message: 'Realm name must start with a lowercase letter and contain only lowercase letters, numbers, and hyphens',
  })
  name!: string;

  @ApiPropertyOptional({ example: 'Master Realm' })
  @IsOptional()
  @IsString()
  displayName?: string;
}

/**
 * DTO for saving SMTP configuration (Step 3)
 */
export class SaveSmtpConfigDto {
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
  @IsEmail()
  from!: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  secure?: boolean;
}

/**
 * DTO for saving client application (Step 4)
 */
export class SaveClientDto {
  @ApiProperty({ example: 'my-app' })
  @IsString()
  @MinLength(3)
  clientId!: string;

  @ApiProperty({ example: ['http://localhost:3000/callback'] })
  @IsArray()
  @IsString({ each: true })
  redirectUris!: string[];
}

/**
 * DTO for SMTP test request
 */
export class SmtpTestDto {
  @ApiProperty({ example: 'test@example.com' })
  @IsEmail()
  to!: string;
}