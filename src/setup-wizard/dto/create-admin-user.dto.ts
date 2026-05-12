import {
  IsString,
  IsEmail,
  IsOptional,
  MinLength,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO for creating a new admin user
 */
export class CreateAdminUserDto {
  @ApiProperty({
    example: 'admin',
    description: 'Admin username (must be at least 3 characters)',
  })
  @IsString()
  @MinLength(3, { message: 'Username must be at least 3 characters' })
  username!: string;

  @ApiProperty({
    example: 'admin@example.com',
    description: 'Admin email address',
  })
  @IsEmail({}, { message: 'Valid email address is required' })
  email!: string;

  @ApiProperty({
    example: 'Password123!',
    description:
      'Admin password (must be at least 8 characters with uppercase, lowercase, and digit)',
  })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  password!: string;

  @ApiPropertyOptional({
    example: 'John Doe',
    description: 'Optional first name',
  })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiPropertyOptional({ example: 'Smith', description: 'Optional last name' })
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiPropertyOptional({
    example: true,
    description: 'Whether the admin user is enabled',
  })
  @IsOptional()
  isEnabled?: boolean;
}

/**
 * DTO for updating an admin user
 */
export class UpdateAdminUserDto {
  @ApiPropertyOptional({
    example: 'admin@example.com',
    description: 'Updated email address',
  })
  @IsOptional()
  @IsEmail({}, { message: 'Valid email address is required' })
  email?: string;

  @ApiPropertyOptional({
    example: 'NewPassword123!',
    description: 'Updated password',
  })
  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  password?: string;

  @ApiPropertyOptional({ example: 'John', description: 'Updated first name' })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiPropertyOptional({ example: 'Smith', description: 'Updated last name' })
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiPropertyOptional({
    example: true,
    description: 'Whether the admin user is enabled',
  })
  @IsOptional()
  isEnabled?: boolean;
}

/**
 * DTO for admin user response
 */
export class AdminUserResponseDto {
  @ApiProperty({ description: 'User ID' })
  @IsString()
  id!: string;

  @ApiProperty({ description: 'Username' })
  @IsString()
  username!: string;

  @ApiProperty({ description: 'Email address' })
  @IsEmail()
  email!: string;

  @ApiPropertyOptional({ description: 'First name' })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiPropertyOptional({ description: 'Last name' })
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiProperty({ description: 'Whether the user is enabled' })
  isEnabled!: boolean;

  @ApiProperty({ description: 'Creation timestamp' })
  createdAt!: string;

  @ApiProperty({ description: 'Last update timestamp' })
  updatedAt!: string;
}
