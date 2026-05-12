import {
  IsString,
  IsOptional,
  IsBoolean,
  IsArray,
  ValidateNested,
  IsIn,
  IsInt,
  IsObject,
  Min,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ─── Step Condition ────────────────────────────────────────

export class FlowStepConditionDto {
  @ApiProperty({
    example: 'user.group',
    description: 'Context field to evaluate',
  })
  @IsString()
  field!: string;

  @ApiProperty({
    example: 'in',
    enum: ['eq', 'neq', 'in', 'not_in', 'exists', 'not_exists'],
  })
  @IsString()
  @IsIn(['eq', 'neq', 'in', 'not_in', 'exists', 'not_exists'])
  operator!: string;

  @ApiPropertyOptional({
    description: 'Value to compare against (scalar or array)',
  })
  @IsOptional()
  value?: unknown;
}

// ─── Flow Step ─────────────────────────────────────────────

export class FlowStepDto {
  @ApiProperty({
    example: 'step-1',
    description: 'Unique step identifier within the flow',
  })
  @IsString()
  @MaxLength(100)
  id!: string;

  @ApiProperty({
    example: 'password',
    enum: [
      'password',
      'totp',
      'webauthn',
      'social',
      'ldap',
      'email_otp',
      'consent',
    ],
  })
  @IsString()
  @IsIn([
    'password',
    'totp',
    'webauthn',
    'social',
    'ldap',
    'email_otp',
    'consent',
  ])
  type!: string;

  @ApiProperty({ example: true, description: 'Whether this step is required' })
  @IsBoolean()
  required!: boolean;

  @ApiProperty({
    example: 1,
    description: 'Execution order (lower runs first)',
  })
  @IsInt()
  @Min(1)
  order!: number;

  @ApiPropertyOptional({
    type: FlowStepConditionDto,
    description: 'Optional condition to skip/apply this step',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => FlowStepConditionDto)
  condition?: FlowStepConditionDto | null;

  @ApiPropertyOptional({
    example: 'step-2',
    description: 'Step to redirect to on failure',
  })
  @IsOptional()
  @IsString()
  fallbackStepId?: string | null;

  @ApiPropertyOptional({ description: 'Step-type-specific configuration' })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

// ─── Create Flow ───────────────────────────────────────────

export class CreateAuthFlowDto {
  @ApiProperty({
    example: 'MFA Required',
    description: 'Unique name within the realm',
  })
  @IsString()
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ example: 'Password followed by TOTP' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({
    example: false,
    description: 'Mark as realm default flow',
  })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiProperty({
    type: [FlowStepDto],
    description: 'Ordered list of authentication steps',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FlowStepDto)
  steps!: FlowStepDto[];
}

// ─── Update Flow ───────────────────────────────────────────

export class UpdateAuthFlowDto {
  @ApiPropertyOptional({ example: 'MFA Required' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: 'Password followed by TOTP' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ type: [FlowStepDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FlowStepDto)
  steps?: FlowStepDto[];
}

// ─── Assign Flow to Client ─────────────────────────────────

export class AssignFlowToClientDto {
  @ApiPropertyOptional({
    description: 'Auth flow ID to assign. Null clears the assignment.',
  })
  @IsOptional()
  @IsString()
  authFlowId?: string | null;
}

// ─── Execute Step ──────────────────────────────────────────

export class ExecuteStepDto {
  @ApiProperty({ example: 'step-1', description: 'The step ID to execute' })
  @IsString()
  stepId!: string;

  @ApiProperty({
    description: 'Execution context (user data, credentials, etc.)',
  })
  @IsObject()
  context!: Record<string, unknown>;
}
