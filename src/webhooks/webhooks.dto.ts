import {
  IsString,
  IsOptional,
  IsBoolean,
  IsArray,
  IsUrl,
  MinLength,
  ArrayNotEmpty,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateWebhookDto {
  @ApiProperty({ example: 'https://example.com/webhook' })
  @IsUrl(
    { require_tld: false, require_protocol: true },
    { message: 'url must be a valid URL' },
  )
  url!: string;

  @ApiProperty({ example: 'my-signing-secret', minLength: 8 })
  @IsString()
  @MinLength(8)
  secret!: string;

  @ApiProperty({
    example: ['user.login', 'user.created'],
    description: 'List of event types to subscribe to',
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  eventTypes!: string[];

  /**
   * Alias for `eventTypes` for API compatibility with clients that send `events`.
   * When `eventTypes` is not provided, `events` is used as a fallback.
   */
  @ApiPropertyOptional({
    example: ['user.login', 'user.created'],
    description: 'Alias for eventTypes. Used when eventTypes is not provided.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  events?: string[];

  @ApiPropertyOptional({ example: 'My webhook for user events' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: true, default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateWebhookDto {
  @ApiPropertyOptional({ example: 'https://example.com/webhook' })
  @IsOptional()
  @IsUrl(
    { require_tld: false, require_protocol: true },
    { message: 'url must be a valid URL' },
  )
  url?: string;

  @ApiPropertyOptional({ example: 'new-signing-secret', minLength: 8 })
  @IsOptional()
  @IsString()
  @MinLength(8)
  secret?: string;

  @ApiPropertyOptional({ example: ['user.login', 'user.created'] })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  eventTypes?: string[];

  @ApiPropertyOptional({ example: 'Updated description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
