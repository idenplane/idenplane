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
  ArrayMaxSize,
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

  /**
   * @deprecated Never used for binding. Bind a flow explicitly with
   * `PUT …/auth-flows/bindings` (realm browser flow or per-client override).
   */
  @ApiPropertyOptional({
    example: false,
    deprecated: true,
    description:
      'Deprecated: informational only and never used for binding. Use PUT …/auth-flows/bindings.',
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

  /** @deprecated Never used for binding; see CreateAuthFlowDto.isDefault. */
  @ApiPropertyOptional({
    example: false,
    deprecated: true,
    description:
      'Deprecated: informational only and never used for binding. Use PUT …/auth-flows/bindings.',
  })
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
    description:
      'Optional. The flow is taken from the `:id` path parameter; when given, this must equal it (400 otherwise). To clear an assignment use DELETE on the same path.',
  })
  @IsOptional()
  @IsString()
  authFlowId?: string | null;
}

// ─── Bindings ──────────────────────────────────────────────

export class ClientFlowBindingDto {
  @ApiProperty({
    example: 'my-web-app',
    description: 'OAuth client_id of a client in this realm',
  })
  @IsString()
  @MaxLength(255)
  clientId!: string;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'Flow to bind to this client (overrides the realm browser flow). Null removes the override.',
  })
  @IsOptional()
  @IsString()
  authFlowId!: string | null;
}

/**
 * Partial update of a realm's flow bindings. Omitted fields are left as they
 * are; `clients` patches only the clients it lists.
 */
export class UpdateFlowBindingsDto {
  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'Realm browser flow. Null unbinds it.',
  })
  @IsOptional()
  @IsString()
  browserFlowId?: string | null;

  @ApiPropertyOptional({
    description:
      'Per-realm switch. Has no effect at login until the server runs with AUTH_FLOW_RUNTIME_ENABLED.',
  })
  @IsOptional()
  @IsBoolean()
  authFlowsEnabled?: boolean;

  @ApiPropertyOptional({ type: [ClientFlowBindingDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ClientFlowBindingDto)
  clients?: ClientFlowBindingDto[];
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
