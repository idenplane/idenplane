import { Controller, Post, Body, HttpCode, UseGuards } from '@nestjs/common';
import {
  ApiSecurity,
  ApiTags,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { IsBoolean, IsObject, IsOptional, IsString } from 'class-validator';
import { KeycloakImporterService } from './keycloak-importer.service.js';
import { Auth0ImporterService } from './auth0-importer.service.js';
import { ZitadelImporterService } from './zitadel-importer.service.js';
import type { MigrationReport } from './migration-report.js';
import type { KeycloakRealmExport } from './keycloak-types.js';
import { AdminApiKeyGuard } from '../common/guards/admin-api-key.guard.js';

class KeycloakImportDto {
  @IsObject()
  data!: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @IsOptional()
  @IsString()
  targetRealm?: string;
}

class Auth0ImportDto {
  @IsObject()
  data!: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @IsString()
  targetRealm!: string;
}

class ZitadelImportDto {
  @IsObject()
  data!: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @IsString()
  targetRealm!: string;
}

// Issue #461 — API limitation notes:
//
// 1. Both import endpoints process the entire payload synchronously in a single
//    HTTP request.  Very large exports (tens of thousands of users) may hit the
//    default request-body size limit (10 MB) or the gateway timeout.  Until
//    chunked / streaming import is implemented, callers should split large
//    exports into batches of ≤5 000 users before calling these endpoints.
//
// 2. Passwords imported from Keycloak are kept in their original hashed form
//    only when the hashing algorithm is recognised (bcrypt, pbkdf2-sha256/512,
//    argon2).  Users whose passwords used an unsupported algorithm are imported
//    without a password hash; they will need to complete a password-reset flow
//    on first login.
//
// 3. Auth0 social-identity links (FederatedIdentity rows) are imported as
//    stubs; the actual OAuth tokens are not available in the Management API
//    export and are therefore not migrated.  Users will need to re-link their
//    social accounts after migration.
//
// 4. Zitadel has no built-in "export realm" endpoint, so the input to
//    POST /admin/migration/zitadel is expected to be hand-assembled from the
//    Management API's ListUsers/ListProjects/ListProjectRoles/ListApps/ListIDPs
//    responses (see zitadel-types.ts). Only bcrypt password hashes, OIDC apps,
//    and generic OIDC IdPs are imported; machine (service-account) users,
//    SAML apps, and non-OIDC IdPs are skipped with a warning per entity.

@ApiTags('Migration')
@ApiSecurity('admin-api-key')
@UseGuards(AdminApiKeyGuard)
@Controller('admin/migration')
export class MigrationController {
  constructor(
    private readonly keycloakImporter: KeycloakImporterService,
    private readonly auth0Importer: Auth0ImporterService,
    private readonly zitadelImporter: ZitadelImporterService,
  ) {}

  @Post('keycloak')
  @HttpCode(200)
  @ApiOperation({ summary: 'Import from Keycloak realm export JSON' })
  @ApiResponse({
    status: 200,
    description: 'Migration report with counts of imported/skipped entities',
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request — invalid payload or missing targetRealm',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid admin API key',
  })
  async importKeycloak(
    @Body() dto: KeycloakImportDto,
  ): Promise<MigrationReport> {
    return this.keycloakImporter.importRealm(
      dto.data as unknown as KeycloakRealmExport,
      {
        dryRun: dto.dryRun ?? false,
        targetRealm: dto.targetRealm,
      },
    );
  }

  @Post('auth0')
  @HttpCode(200)
  @ApiOperation({ summary: 'Import from Auth0 Management API export' })
  @ApiResponse({
    status: 200,
    description: 'Migration report with counts of imported/skipped entities',
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request — invalid payload or missing targetRealm',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid admin API key',
  })
  async importAuth0(@Body() dto: Auth0ImportDto): Promise<MigrationReport> {
    return this.auth0Importer.importData(dto.data, {
      dryRun: dto.dryRun ?? false,
      targetRealm: dto.targetRealm,
    });
  }

  @Post('zitadel')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Import from a hand-assembled Zitadel Management API export',
  })
  @ApiResponse({
    status: 200,
    description: 'Migration report with counts of imported/skipped entities',
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request — invalid payload or missing targetRealm',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid admin API key',
  })
  async importZitadel(@Body() dto: ZitadelImportDto): Promise<MigrationReport> {
    return this.zitadelImporter.importData(dto.data, {
      dryRun: dto.dryRun ?? false,
      targetRealm: dto.targetRealm,
    });
  }
}
