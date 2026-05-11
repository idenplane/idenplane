/**
 * SCIM Provisioning Admin Controller
 * Admin API endpoints for managing SCIM tokens and configuration
 */

import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiSecurity, ApiResponse } from '@nestjs/swagger';
import type { Realm } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { ScimTokensService } from './scim-tokens.service.js';
import type { CreateScimTokenDto } from './dto/scim.dto.js';
import { RealmGuard } from '../common/guards/realm.guard.js';
import { CurrentRealm } from '../common/decorators/current-realm.decorator.js';

@ApiTags('SCIM Provisioning (Admin)')
@Controller('admin/realms/:realmName/scim')
@UseGuards(RealmGuard)
@ApiSecurity('admin-api-key')
export class ScimProvisioningController {
  private readonly logger = new Logger(ScimProvisioningController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scimTokensService: ScimTokensService,
  ) {}

  // ══════════════════════════════════════════════════════════════
  // SCIM Token Management
  // ══════════════════════════════════════════════════════════════

  @Post('tokens')
  @ApiOperation({ summary: 'Create a new SCIM provisioning token' })
  @ApiResponse({ status: 201, description: 'Token created (plain token shown once)' })
  @ApiResponse({ status: 409, description: 'Token name already exists' })
  async createToken(
    @CurrentRealm() realm: Realm,
    @Body() dto: CreateScimTokenDto,
  ) {
    const result = await this.scimTokensService.createToken(realm.id, dto);
    this.logger.log(`Created SCIM token '${dto.name}' for realm ${realm.name}`);
    return result;
  }

  @Get('tokens')
  @ApiOperation({ summary: 'Get all SCIM tokens for the realm' })
  @ApiResponse({ status: 200, description: 'List of SCIM tokens' })
  async getTokens(@CurrentRealm() realm: Realm) {
    return this.scimTokensService.getTokens(realm.id);
  }

  @Get('tokens/:tokenId')
  @ApiOperation({ summary: 'Get a specific SCIM token' })
  @ApiResponse({ status: 200, description: 'Token details' })
  @ApiResponse({ status: 404, description: 'Token not found' })
  async getToken(@CurrentRealm() realm: Realm, @Param('tokenId') tokenId: string) {
    return this.scimTokensService.getTokenById(realm.id, tokenId);
  }

  @Delete('tokens/:tokenId')
  @ApiOperation({ summary: 'Delete a SCIM token' })
  @ApiResponse({ status: 204, description: 'Token deleted' })
  @ApiResponse({ status: 404, description: 'Token not found' })
  async deleteToken(@CurrentRealm() realm: Realm, @Param('tokenId') tokenId: string) {
    await this.scimTokensService.deleteToken(realm.id, tokenId);
    this.logger.log(`Deleted SCIM token ${tokenId} from realm ${realm.name}`);
  }

  @Put('tokens/:tokenId/revoke')
  @ApiOperation({ summary: 'Revoke a SCIM token' })
  @ApiResponse({ status: 200, description: 'Token revoked' })
  @ApiResponse({ status: 404, description: 'Token not found' })
  async revokeToken(@CurrentRealm() realm: Realm, @Param('tokenId') tokenId: string) {
    await this.scimTokensService.revokeToken(realm.id, tokenId);
    this.logger.log(`Revoked SCIM token ${tokenId} in realm ${realm.name}`);
  }

  @Put('tokens/:tokenId/enable')
  @ApiOperation({ summary: 'Enable a SCIM token' })
  @ApiResponse({ status: 200, description: 'Token enabled' })
  @ApiResponse({ status: 404, description: 'Token not found' })
  async enableToken(@CurrentRealm() realm: Realm, @Param('tokenId') tokenId: string) {
    await this.scimTokensService.setTokenEnabled(realm.id, tokenId, true);
  }

  @Put('tokens/:tokenId/disable')
  @ApiOperation({ summary: 'Disable a SCIM token' })
  @ApiResponse({ status: 200, description: 'Token disabled' })
  @ApiResponse({ status: 404, description: 'Token not found' })
  async disableToken(@CurrentRealm() realm: Realm, @Param('tokenId') tokenId: string) {
    await this.scimTokensService.setTokenEnabled(realm.id, tokenId, false);
  }

  // ══════════════════════════════════════════════════════════════
  // SCIM Attribute Mappings
  // ══════════════════════════════════════════════════════════════

  @Get('attribute-mappings')
  @ApiOperation({ summary: 'Get SCIM attribute mappings for the realm' })
  @ApiResponse({ status: 200, description: 'List of attribute mappings' })
  async getAttributeMappings(@CurrentRealm() realm: Realm) {
    return this.prisma.scimAttributeMapping.findMany({
      where: { realmId: realm.id },
      orderBy: { resourceType: 'asc' },
    });
  }

  @Post('attribute-mappings')
  @ApiOperation({ summary: 'Create a SCIM attribute mapping' })
  @ApiResponse({ status: 201, description: 'Mapping created' })
  async createAttributeMapping(
    @CurrentRealm() realm: Realm,
    @Body() dto: { resourceType: string; scimAttribute: string; authmeAttribute: string; direction?: string },
  ) {
    return this.prisma.scimAttributeMapping.create({
      data: {
        realmId: realm.id,
        resourceType: dto.resourceType,
        scimAttribute: dto.scimAttribute,
        authmeAttribute: dto.authmeAttribute,
        direction: dto.direction || 'inbound',
      },
    });
  }

  @Delete('attribute-mappings/:mappingId')
  @ApiOperation({ summary: 'Delete a SCIM attribute mapping' })
  @ApiResponse({ status: 204, description: 'Mapping deleted' })
  async deleteAttributeMapping(@CurrentRealm() realm: Realm, @Param('mappingId') mappingId: string) {
    await this.prisma.scimAttributeMapping.delete({
      where: { id: mappingId },
    });
  }

  // ══════════════════════════════════════════════════════════════
  // SCIM Status
  // ══════════════════════════════════════════════════════════════

  @Get('status')
  @ApiOperation({ summary: 'Get SCIM provisioning status for the realm' })
  @ApiResponse({ status: 200, description: 'SCIM configuration status' })
  async getStatus(@CurrentRealm() realm: Realm) {
    const [tokenCount, userCount, groupCount] = await Promise.all([
      this.prisma.scimProvisioningToken.count({ where: { realmId: realm.id, revoked: false } }),
      this.prisma.user.count({ where: { realmId: realm.id } }),
      this.prisma.group.count({ where: { realmId: realm.id } }),
    ]);

    return {
      enabled: realm.scimEnabled,
      userAutocreate: realm.scimUserAutocreate,
      groupSyncEnabled: realm.scimGroupSyncEnabled,
      activeTokens: tokenCount,
      totalUsers: userCount,
      totalGroups: groupCount,
    };
  }
}