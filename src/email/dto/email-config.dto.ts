import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  IsEnum,
  ValidateNested,
  IsObject,
  NotContains,
  ValidateIf,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  PLACEHOLDER_TYPED_OVER,
  SECRET_PLACEHOLDER,
} from '../../realms/secret-placeholder.js';

/**
 * A stored secret comes back from the API as SECRET_PLACEHOLDER; sending that
 * back unchanged keeps it. Anything else must be a real value.
 */
const keepsStoredSecret = (value: unknown) => value !== SECRET_PLACEHOLDER;

export enum EmailProviderType {
  NONE = 'none',
  SMTP = 'smtp',
  RESEND = 'resend',
  SENDGRID = 'sendgrid',
  MAILGUN = 'mailgun',
  POSTMARK = 'postmark',
}

export class SmtpEmailConfigDto {
  @ApiPropertyOptional({ description: 'SMTP hostname' })
  @IsOptional()
  @IsString()
  host?: string;

  @ApiPropertyOptional({ description: 'SMTP port', default: 587 })
  @IsOptional()
  @IsInt()
  port?: number;

  @ApiPropertyOptional({ description: 'SMTP username' })
  @IsOptional()
  @IsString()
  user?: string;

  @ApiPropertyOptional({ description: 'SMTP password' })
  @IsOptional()
  @ValidateIf((o: Record<string, unknown>) => keepsStoredSecret(o['password']))
  @IsString()
  @NotContains(SECRET_PLACEHOLDER, { message: PLACEHOLDER_TYPED_OVER })
  password?: string;

  @ApiPropertyOptional({ description: 'From address' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ description: 'Use TLS', default: false })
  @IsOptional()
  @IsBoolean()
  secure?: boolean;
}

export class ResendEmailConfigDto {
  @ApiPropertyOptional({ description: 'Resend API key (re_...)' })
  @IsOptional()
  @ValidateIf((o: Record<string, unknown>) => keepsStoredSecret(o['apiKey']))
  @IsString()
  @NotContains(SECRET_PLACEHOLDER, { message: PLACEHOLDER_TYPED_OVER })
  apiKey?: string;

  @ApiPropertyOptional({
    description: 'From address (must be verified in Resend)',
  })
  @IsOptional()
  @IsString()
  from?: string;
}

export class SendGridEmailConfigDto {
  @ApiPropertyOptional({ description: 'SendGrid API key (SG....)' })
  @IsOptional()
  @ValidateIf((o: Record<string, unknown>) => keepsStoredSecret(o['apiKey']))
  @IsString()
  @NotContains(SECRET_PLACEHOLDER, { message: PLACEHOLDER_TYPED_OVER })
  apiKey?: string;

  @ApiPropertyOptional({
    description: 'From address (must be verified in SendGrid)',
  })
  @IsOptional()
  @IsString()
  from?: string;
}

export class MailgunEmailConfigDto {
  @ApiPropertyOptional({ description: 'Mailgun API key' })
  @IsOptional()
  @ValidateIf((o: Record<string, unknown>) => keepsStoredSecret(o['apiKey']))
  @IsString()
  @NotContains(SECRET_PLACEHOLDER, { message: PLACEHOLDER_TYPED_OVER })
  apiKey?: string;

  @ApiPropertyOptional({ description: 'Mailgun sending domain' })
  @IsOptional()
  @IsString()
  domain?: string;

  @ApiPropertyOptional({
    description: 'Mailgun region',
    enum: ['us', 'eu'],
    default: 'us',
  })
  @IsOptional()
  @IsString()
  region?: string;

  @ApiPropertyOptional({ description: 'From address' })
  @IsOptional()
  @IsString()
  from?: string;
}

export class PostmarkEmailConfigDto {
  @ApiPropertyOptional({ description: 'Postmark Server Token' })
  @IsOptional()
  @ValidateIf((o: Record<string, unknown>) =>
    keepsStoredSecret(o['serverToken']),
  )
  @IsString()
  @NotContains(SECRET_PLACEHOLDER, { message: PLACEHOLDER_TYPED_OVER })
  serverToken?: string;

  @ApiPropertyOptional({
    description: 'From address (must be a verified Postmark sender signature)',
  })
  @IsOptional()
  @IsString()
  from?: string;
}

export class EmailProviderConfigDto {
  @ApiPropertyOptional({ type: SmtpEmailConfigDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => SmtpEmailConfigDto)
  smtp?: SmtpEmailConfigDto;

  @ApiPropertyOptional({ type: ResendEmailConfigDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ResendEmailConfigDto)
  resend?: ResendEmailConfigDto;

  @ApiPropertyOptional({ type: SendGridEmailConfigDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => SendGridEmailConfigDto)
  sendgrid?: SendGridEmailConfigDto;

  @ApiPropertyOptional({ type: MailgunEmailConfigDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => MailgunEmailConfigDto)
  mailgun?: MailgunEmailConfigDto;

  @ApiPropertyOptional({ type: PostmarkEmailConfigDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => PostmarkEmailConfigDto)
  postmark?: PostmarkEmailConfigDto;
}

export class EmailConfigDto {
  @ApiPropertyOptional({
    description: 'Email provider to use',
    enum: EmailProviderType,
    default: EmailProviderType.SMTP,
  })
  @IsOptional()
  @IsEnum(EmailProviderType)
  emailProvider?: EmailProviderType;

  @ApiPropertyOptional({
    description: 'Provider-specific configuration',
    type: EmailProviderConfigDto,
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => EmailProviderConfigDto)
  emailProviderConfig?: EmailProviderConfigDto;
}
