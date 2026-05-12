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
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiSecurity,
  ApiResponse,
} from '@nestjs/swagger';
import type { Realm } from '@prisma/client';
import { RealmGuard } from '../common/guards/realm.guard.js';
import { CurrentRealm } from '../common/decorators/current-realm.decorator.js';
import { SamlIdpService } from './saml-idp.service.js';
import { CreateSamlSpDto } from './dto/create-saml-sp.dto.js';
import { UpdateSamlSpDto } from './dto/update-saml-sp.dto.js';

@ApiTags('SAML Service Providers')
@Controller('admin/realms/:realmName/saml-service-providers')
@UseGuards(RealmGuard)
@ApiSecurity('admin-api-key')
export class SamlSpAdminController {
  constructor(private readonly samlIdpService: SamlIdpService) {}

  @Post()
  @ApiOperation({ summary: 'Register a SAML service provider' })
  @ApiResponse({
    status: 201,
    description: 'SAML service provider registered successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request — invalid DTO or duplicate entityId',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid admin API key',
  })
  create(@CurrentRealm() realm: Realm, @Body() dto: CreateSamlSpDto) {
    return this.samlIdpService.createSp(realm, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List SAML service providers' })
  @ApiResponse({
    status: 200,
    description: 'Array of SAML service providers in the realm',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid admin API key',
  })
  findAll(@CurrentRealm() realm: Realm) {
    return this.samlIdpService.findAllSps(realm);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a SAML service provider by ID' })
  @ApiResponse({ status: 200, description: 'SAML service provider details' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid admin API key',
  })
  @ApiResponse({ status: 404, description: 'SAML service provider not found' })
  async findOne(@CurrentRealm() realm: Realm, @Param('id') id: string) {
    const sp = await this.samlIdpService.findSpById(realm, id);
    if (!sp) {
      throw new NotFoundException('SAML service provider not found');
    }
    return sp;
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a SAML service provider' })
  @ApiResponse({
    status: 200,
    description: 'SAML service provider updated successfully',
  })
  @ApiResponse({ status: 400, description: 'Bad request — invalid DTO' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid admin API key',
  })
  @ApiResponse({ status: 404, description: 'SAML service provider not found' })
  update(
    @CurrentRealm() realm: Realm,
    @Param('id') id: string,
    @Body() dto: UpdateSamlSpDto,
  ) {
    return this.samlIdpService.updateSp(realm, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a SAML service provider' })
  @ApiResponse({ status: 204, description: 'SAML service provider deleted' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid admin API key',
  })
  @ApiResponse({ status: 404, description: 'SAML service provider not found' })
  remove(@CurrentRealm() realm: Realm, @Param('id') id: string) {
    return this.samlIdpService.deleteSp(realm, id);
  }
}
