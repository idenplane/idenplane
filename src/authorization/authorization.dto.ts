import {
  IsString,
  IsOptional,
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsArray,
  MinLength,
  Min,
  ValidateNested,
  Validate,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
  type ValidationArguments,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CONDITION_OPERATORS,
  conditionProblem,
  type PolicySubject,
  type PolicyResource,
  type PolicyEnvironment,
} from './policy-engine.js';

/**
 * Every condition of a policy must be one the engine can evaluate: a known
 * operator with the kind of value it needs (see `conditionProblem`). A
 * typo would otherwise be stored, and a DENY with it would never match.
 */
@ValidatorConstraint({ name: 'policyConditions' })
class PolicyConditionsConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return (
      Array.isArray(value) && value.every((c) => conditionProblem(c) === null)
    );
  }

  defaultMessage(args: ValidationArguments): string {
    const value: unknown = args.value;
    if (!Array.isArray(value)) return `${args.property} must be an array`;
    return value
      .map((c, i) => {
        const problem = conditionProblem(c);
        return problem ? `${args.property}[${i}]: ${problem}` : null;
      })
      .filter((m): m is string => m !== null)
      .join('; ');
  }
}

const CONDITIONS_HELP =
  ' Each entry: { field, operator, value }. Operators: ' +
  CONDITION_OPERATORS.join(', ') +
  '. An unknown operator, or a value the operator cannot use, is refused with a 400.';

// ─── CRUD DTOs ────────────────────────────────────────────

export class CreatePolicyDto {
  @ApiProperty({ example: 'allow-admins-to-read-reports' })
  @IsString()
  @MinLength(2)
  name!: string;

  @ApiPropertyOptional({
    example: 'Allows admin-role users to read report resources',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    enum: ['ALLOW', 'DENY'],
    default: 'ALLOW',
    description: 'Whether this policy grants or denies access',
  })
  @IsOptional()
  @IsEnum(['ALLOW', 'DENY'])
  effect?: 'ALLOW' | 'DENY';

  @ApiPropertyOptional({
    default: 0,
    description: 'Higher priority policies are evaluated first',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;

  @ApiPropertyOptional({
    description:
      'Conditions on the subject (user). Each entry: { field, operator, value }. ' +
      'field uses dot-notation within the subject context, e.g. "subject.roles".' +
      CONDITIONS_HELP,
    example: [{ field: 'subject.roles', operator: 'contains', value: 'admin' }],
  })
  @IsOptional()
  @IsArray()
  @Validate(PolicyConditionsConstraint)
  subjectConditions?: object[];

  @ApiPropertyOptional({
    description: 'Conditions on the resource.' + CONDITIONS_HELP,
    example: [{ field: 'resource.type', operator: 'equals', value: 'report' }],
  })
  @IsOptional()
  @IsArray()
  @Validate(PolicyConditionsConstraint)
  resourceConditions?: object[];

  @ApiPropertyOptional({
    description: 'Conditions on the action.' + CONDITIONS_HELP,
    example: [{ field: 'action', operator: 'in', value: ['read', 'list'] }],
  })
  @IsOptional()
  @IsArray()
  @Validate(PolicyConditionsConstraint)
  actionConditions?: object[];

  @ApiPropertyOptional({
    description:
      'Conditions on the environment (IP, time, etc.). ipInRange takes an IPv4 or IPv6 address or CIDR block.' +
      CONDITIONS_HELP,
    example: [
      { field: 'environment.ip', operator: 'ipInRange', value: '10.0.0.0/8' },
    ],
  })
  @IsOptional()
  @IsArray()
  @Validate(PolicyConditionsConstraint)
  environmentConditions?: object[];

  @ApiPropertyOptional({
    enum: ['AND', 'OR'],
    default: 'AND',
    description:
      'How conditions within each category are combined. ' +
      'Category groups themselves are always ANDed together.',
  })
  @IsOptional()
  @IsEnum(['AND', 'OR'])
  logic?: 'AND' | 'OR';

  @ApiPropertyOptional({
    description:
      'Scope this policy to a specific client ID (clientId string, not DB id). ' +
      'A scoped policy applies only to evaluations that pass the same clientId; ' +
      'an evaluation without clientId gets the unscoped (global) policies only.',
  })
  @IsOptional()
  @IsString()
  clientId?: string;
}

export class UpdatePolicyDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ enum: ['ALLOW', 'DENY'] })
  @IsOptional()
  @IsEnum(['ALLOW', 'DENY'])
  effect?: 'ALLOW' | 'DENY';

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @Validate(PolicyConditionsConstraint)
  subjectConditions?: object[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @Validate(PolicyConditionsConstraint)
  resourceConditions?: object[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @Validate(PolicyConditionsConstraint)
  actionConditions?: object[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @Validate(PolicyConditionsConstraint)
  environmentConditions?: object[];

  @ApiPropertyOptional({ enum: ['AND', 'OR'] })
  @IsOptional()
  @IsEnum(['AND', 'OR'])
  logic?: 'AND' | 'OR';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  clientId?: string;
}

// ─── Evaluation DTOs ─────────────────────────────────────

export class EvaluationSubjectDto implements PolicySubject {
  @ApiPropertyOptional({ example: 'user-uuid-1234' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({ example: ['admin', 'viewer'], type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  roles?: string[];

  @ApiPropertyOptional({ example: ['engineering'], type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  groups?: string[];

  @ApiPropertyOptional({ example: { department: 'engineering' } })
  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;
}

export class EvaluationResourceDto implements PolicyResource {
  @ApiPropertyOptional({ example: 'report' })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({ example: 'report-uuid-5678' })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiPropertyOptional({ example: 'user-uuid-1234' })
  @IsOptional()
  @IsString()
  ownerId?: string;

  @ApiPropertyOptional({ example: { classification: 'confidential' } })
  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;
}

export class EvaluationEnvironmentDto implements PolicyEnvironment {
  @ApiPropertyOptional({ example: '192.168.1.1' })
  @IsOptional()
  @IsString()
  ip?: string;

  @ApiPropertyOptional({ example: '2026-03-24T10:00:00Z' })
  @IsOptional()
  time?: string;
}

export class EvaluatePolicyDto {
  @ApiProperty()
  @ValidateNested()
  @Type(() => EvaluationSubjectDto)
  subject!: EvaluationSubjectDto;

  @ApiProperty()
  @ValidateNested()
  @Type(() => EvaluationResourceDto)
  resource!: EvaluationResourceDto;

  @ApiProperty({ example: 'read' })
  @IsString()
  action!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => EvaluationEnvironmentDto)
  environment?: EvaluationEnvironmentDto;

  @ApiPropertyOptional({
    example: 'my-frontend',
    description:
      'The client the request is for. Policies scoped to this client apply ' +
      'in addition to the global ones; without clientId only the global ' +
      '(unscoped) policies apply.',
  })
  @IsOptional()
  @IsString()
  clientId?: string;
}

export class TestPolicyDto {
  @ApiProperty()
  @ValidateNested()
  @Type(() => EvaluationSubjectDto)
  subject!: EvaluationSubjectDto;

  @ApiProperty()
  @ValidateNested()
  @Type(() => EvaluationResourceDto)
  resource!: EvaluationResourceDto;

  @ApiProperty({ example: 'read' })
  @IsString()
  action!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => EvaluationEnvironmentDto)
  environment?: EvaluationEnvironmentDto;
}
