import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
} from '@nestjs/swagger';
import type { Realm } from '@prisma/client';
import { AdminApiKeyGuard } from '../common/guards/admin-api-key.guard.js';
import { RealmGuard } from '../common/guards/realm.guard.js';
import { CurrentRealm } from '../common/decorators/current-realm.decorator.js';
import { IdentityProvidersService } from './identity-providers.service.js';
import { CreateIdentityProviderDto } from './dto/create-identity-provider.dto.js';
import { UpdateIdentityProviderDto } from './dto/update-identity-provider.dto.js';
import { ReadSamlMetadataDto } from './dto/read-saml-metadata.dto.js';
import { idpSecrets } from './idp-secrets.js';

@ApiTags('Identity Providers')
@ApiSecurity('admin-api-key')
@Controller('admin/realms/:realmName/identity-providers')
@UseGuards(RealmGuard, AdminApiKeyGuard)
export class IdentityProvidersController {
  constructor(private readonly idpService: IdentityProvidersService) {}

  @Post()
  @ApiOperation({ summary: 'Create an identity provider' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async create(
    @CurrentRealm() realm: Realm,
    @Body() dto: CreateIdentityProviderDto,
  ) {
    return this.idpService.withSpEndpoints(
      realm,
      idpSecrets.redact(await this.idpService.create(realm, dto)),
    );
  }

  @Post('saml-metadata')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Read SAML IdP metadata (pasted or from a URL) into samlConfig fields; stores nothing',
  })
  @ApiResponse({ status: 200, description: 'The fields the metadata fills' })
  @ApiResponse({ status: 400, description: 'Unusable metadata or URL' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  readSamlMetadata(@Body() dto: ReadSamlMetadataDto) {
    return this.idpService.readSamlMetadata(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List identity providers' })
  @ApiResponse({ status: 200, description: 'List of identity providers' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  findAll(@CurrentRealm() realm: Realm) {
    return this.idpService.findAll(realm);
  }

  @Get(':alias')
  @ApiOperation({ summary: 'Get identity provider by alias' })
  @ApiResponse({ status: 200, description: 'Identity provider details' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async findByAlias(
    @CurrentRealm() realm: Realm,
    @Param('alias') alias: string,
  ) {
    return this.idpService.withSpEndpoints(
      realm,
      idpSecrets.redact(await this.idpService.findByAlias(realm, alias)),
    );
  }

  @Put(':alias')
  @ApiOperation({ summary: 'Update identity provider' })
  @ApiResponse({ status: 200, description: 'Updated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async update(
    @CurrentRealm() realm: Realm,
    @Param('alias') alias: string,
    @Body() dto: UpdateIdentityProviderDto,
  ) {
    return this.idpService.withSpEndpoints(
      realm,
      idpSecrets.redact(await this.idpService.update(realm, alias, dto)),
    );
  }

  @Delete(':alias')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete identity provider' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async remove(@CurrentRealm() realm: Realm, @Param('alias') alias: string) {
    await this.idpService.remove(realm, alias);
  }
}
