import {
  IsString,
  IsOptional,
  IsBoolean,
  IsObject,
  IsArray,
  MinLength,
  IsIn,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterAiAgentDto {
  @ApiProperty({
    example: 'data-analysis-agent',
    description: 'Unique name for the AI agent',
  })
  @IsString()
  @MinLength(2)
  name!: string;

  @ApiPropertyOptional({
    example: 'AI agent for automated data analysis and reporting',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Purpose/category of the AI agent',
    example: 'data-analysis',
  })
  @IsOptional()
  @IsString()
  agentPurpose?: string;

  @ApiPropertyOptional({
    enum: ['ACTIVE', 'PROVISIONING'],
    default: 'PROVISIONING',
  })
  @IsOptional()
  @IsIn(['ACTIVE', 'PROVISIONING'])
  lifecycleStatus?: 'ACTIVE' | 'PROVISIONING';

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    type: [String],
    description: 'Permission scopes granted to the AI agent',
    example: ['read:data', 'write:reports', 'analyze:metrics'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissionScopes?: string[];

  @ApiPropertyOptional({ example: { model: 'gpt-4', provider: 'openai' } })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
