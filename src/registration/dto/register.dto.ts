import { IsString, IsOptional, IsBoolean, IsEmail, MinLength, Matches, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({ example: 'johndoe', description: 'Username for the new account' })
  @IsString()
  @MinLength(3)
  @Matches(/^[a-zA-Z0-9_-]+$/, { message: 'Username may only contain letters, digits, underscores, and hyphens' })
  username!: string;

  @ApiProperty({ example: 'john@example.com', description: 'Email address for the new account' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'SecurePassword123!', description: 'Password for the new account' })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiPropertyOptional({ example: 'John' })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiPropertyOptional({ example: 'Doe' })
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiPropertyOptional({ description: 'CAPTCHA response token from reCAPTCHA or hCaptcha' })
  @IsOptional()
  @IsString()
  captchaToken?: string;

  @ApiPropertyOptional({ description: 'Consent to terms of service', default: false })
  @IsOptional()
  @IsBoolean()
  acceptTerms?: boolean;

  @ApiPropertyOptional({ description: 'Custom registration field values as key-value pairs' })
  @IsOptional()
  @IsObject()
  attributes?: Record<string, string>;
}

export class VerifyEmailDto {
  @ApiProperty({ description: 'Email verification token' })
  @IsString()
  token!: string;
}

export class ResendVerificationDto {
  @ApiProperty({ example: 'john@example.com' })
  @IsEmail()
  email!: string;
}

export class ApproveRegistrationDto {
  @ApiPropertyOptional({ description: 'Optional note for the approval' })
  @IsOptional()
  @IsString()
  note?: string;
}

export class RejectRegistrationDto {
  @ApiPropertyOptional({ description: 'Reason for rejecting the registration' })
  @IsOptional()
  @IsString()
  reason?: string;
}