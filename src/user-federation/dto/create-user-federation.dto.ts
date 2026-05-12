import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  Min,
  IsIn,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateUserFederationDto {
  @ApiProperty()
  @IsString()
  name!: string;

  @ApiPropertyOptional({ default: 'ldap' })
  @IsOptional()
  @IsString()
  providerType?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;

  @ApiProperty({ example: 'ldap://localhost:389' })
  @IsString()
  connectionUrl!: string;

  @ApiProperty({ example: 'cn=admin,dc=example,dc=com' })
  @IsString()
  bindDn!: string;

  @ApiProperty()
  @IsString()
  bindCredential!: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  startTls?: boolean;

  @ApiPropertyOptional({ default: 5000 })
  @IsOptional()
  @IsInt()
  @Min(1000)
  connectionTimeout?: number;

  @ApiProperty({ example: 'ou=users,dc=example,dc=com' })
  @IsString()
  usersDn!: string;

  @ApiPropertyOptional({ default: 'inetOrgPerson' })
  @IsOptional()
  @IsString()
  userObjectClass?: string;

  @ApiPropertyOptional({ default: 'uid' })
  @IsOptional()
  @IsString()
  usernameLdapAttr?: string;

  @ApiPropertyOptional({ default: 'uid' })
  @IsOptional()
  @IsString()
  rdnLdapAttr?: string;

  @ApiPropertyOptional({ default: 'entryUUID' })
  @IsOptional()
  @IsString()
  uuidLdapAttr?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  searchFilter?: string;

  @ApiPropertyOptional({ default: 'on_demand' })
  @IsOptional()
  @IsString()
  @IsIn(['on_demand', 'full', 'changed'])
  syncMode?: string;

  @ApiPropertyOptional({ default: 3600 })
  @IsOptional()
  @IsInt()
  @Min(60)
  syncPeriod?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  importEnabled?: boolean;

  @ApiPropertyOptional({ default: 'READ_ONLY' })
  @IsOptional()
  @IsString()
  @IsIn(['READ_ONLY', 'WRITABLE'])
  editMode?: string;
}
