import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  IsEnum,
  ValidateNested,
  IsObject,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

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
  @IsString()
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
  @IsString()
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
  @IsString()
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
  @IsString()
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
  @IsString()
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
