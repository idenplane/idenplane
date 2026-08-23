import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Min,
  Max,
} from 'class-validator';

/** One day. Longer than this and a revoked account keeps its proxy access for
 * an uncomfortably long time, since the proxy only re-checks on cookie expiry. */
const MAX_COOKIE_TTL_SECONDS = 86_400;

export class CreateProxyApplicationDto {
  @ApiProperty({
    description:
      'URL-safe identifier used in the proxy endpoints, e.g. /realms/<realm>/proxy/<slug>/verify',
    example: 'grafana',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9][a-z0-9-]*$/, {
    message:
      'slug must be lowercase alphanumeric with hyphens, and start with a letter or digit',
  })
  slug!: string;

  @ApiProperty({ description: 'Human-readable name', example: 'Grafana' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({
    description:
      'clientId of the OAuth client this application authenticates through. Its redirectUris must contain the callback URL returned by this endpoint.',
    example: 'grafana-proxy',
  })
  @IsString()
  @IsNotEmpty()
  clientId!: string;

  @ApiProperty({
    description:
      'Origins this application is served from. A forward-auth request is only redirected back to a URL matching one of these. Supports the same trailing /* wildcard as OAuth redirectUris.',
    example: ['https://grafana.example.com/*'],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  allowedRedirectUris!: string[];

  @ApiProperty({
    description:
      'Scope of the proxy session cookie. Must be a parent domain of every allowed redirect URI host, or the browser will never send the cookie to the proxied application.',
    example: '.example.com',
  })
  @IsString()
  @IsNotEmpty()
  cookieDomain!: string;

  @ApiPropertyOptional({
    description: 'Proxy session lifetime in seconds (default 8 hours)',
    default: 28_800,
    minimum: 60,
    maximum: MAX_COOKIE_TTL_SECONDS,
  })
  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(MAX_COOKIE_TTL_SECONDS)
  cookieTtl?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    description:
      'Header carrying the username. Traefik/oauth2-proxy stacks expect X-Forwarded-User; many nginx auth_request and Authentik setups expect X-Auth-Request-User.',
    default: 'X-Forwarded-User',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9-]+$/, {
    message: 'header names may only contain letters, digits and hyphens',
  })
  userHeader?: string;

  @ApiPropertyOptional({ default: 'X-Forwarded-Email' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9-]+$/, {
    message: 'header names may only contain letters, digits and hyphens',
  })
  emailHeader?: string;

  @ApiPropertyOptional({ default: 'X-Forwarded-Preferred-Username' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9-]+$/, {
    message: 'header names may only contain letters, digits and hyphens',
  })
  nameHeader?: string;

  @ApiPropertyOptional({ default: 'X-Forwarded-Groups' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9-]+$/, {
    message: 'header names may only contain letters, digits and hyphens',
  })
  groupsHeader?: string;
}
