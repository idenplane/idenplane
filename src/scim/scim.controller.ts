/**
 * SCIM Controller
 * Implements RFC 7644 - SCIM Protocol Endpoints
 *
 * Base path: /scim/v2/{realmName}
 */

import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Headers,
  Req,
  HttpCode,
  HttpStatus,
  UseGuards,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiSecurity, ApiResponse, ApiExcludeEndpoint } from '@nestjs/swagger';
import type { Request } from 'express';
import { ScimAuthGuard } from './guards/scim-auth.guard.js';
import { ScimServiceProviderConfigService } from './service-provider-config.service.js';
import { ScimUsersService } from './scim-users.service.js';
import { ScimGroupsService } from './scim-groups.service.js';
import { ScimBulkService } from './scim-bulk.service.js';
import type {
  ScimServiceProviderConfig,
  ScimUser,
  ScimGroup,
  ScimListResponse,
  ScimSearchRequest,
  ScimPatchRequest,
  ScimBulkRequest,
  ScimBulkResponse,
} from './types/scim.types.js';
import { ALL_SCHEMAS, ALL_RESOURCE_TYPES } from './schemas/scim.schemas.js';

interface ScimRequest extends Request {
  scimRealm?: { id: string; scimUserAutocreate?: boolean; scimGroupSyncEnabled?: boolean };
}

@ApiTags('SCIM 2.0')
@Controller('scim/v2')
export class ScimController {
  private readonly logger = new Logger(ScimController.name);

  constructor(
    private readonly configService: ScimServiceProviderConfigService,
    private readonly usersService: ScimUsersService,
    private readonly groupsService: ScimGroupsService,
    private readonly bulkService: ScimBulkService,
  ) {}

  // ══════════════════════════════════════════════════════════════
  // Service Provider Configuration Endpoints
  // RFC 7644 Section 4
  // ══════════════════════════════════════════════════════════════

  @Get('ServiceProviderConfig')
  @ApiOperation({ summary: 'Get SCIM Service Provider Configuration' })
  @ApiResponse({ status: 200, description: 'Service provider configuration' })
  getServiceProviderConfig(): ScimServiceProviderConfig {
    return this.configService.getConfig();
  }

  // ══════════════════════════════════════════════════════════════
  // Schema Endpoints
  // RFC 7644 Section 4
  // ══════════════════════════════════════════════════════════════

  @Get('Schemas')
  @ApiOperation({ summary: 'Get all SCIM schemas' })
  @ApiResponse({ status: 200, description: 'List of all schemas' })
  getSchemas() {
    return ALL_SCHEMAS;
  }

  @Get('Schemas/:schemaId')
  @ApiOperation({ summary: 'Get a specific schema' })
  @ApiResponse({ status: 200, description: 'Schema details' })
  getSchemaById(@Param('schemaId') schemaId: string) {
    const schema = this.configService.getSchemaById(schemaId);
    if (!schema) {
      throw new BadRequestException(`Schema '${schemaId}' not found`);
    }
    return schema;
  }

  @Get('ResourceTypes')
  @ApiOperation({ summary: 'Get all SCIM resource types' })
  @ApiResponse({ status: 200, description: 'List of all resource types' })
  getResourceTypes() {
    return ALL_RESOURCE_TYPES;
  }

  @Get('ResourceTypes/:resourceTypeId')
  @ApiOperation({ summary: 'Get a specific resource type' })
  @ApiResponse({ status: 200, description: 'Resource type details' })
  getResourceTypeById(@Param('resourceTypeId') resourceTypeId: string) {
    const rt = this.configService.getResourceTypeByName(resourceTypeId);
    if (!rt) {
      throw new BadRequestException(`Resource type '${resourceTypeId}' not found`);
    }
    return rt;
  }

  // ══════════════════════════════════════════════════════════════
  // User Endpoints
  // RFC 7644 Section 3.2
  // ══════════════════════════════════════════════════════════════

  @Get(':realmName/Users')
  @UseGuards(ScimAuthGuard)
  @ApiOperation({ summary: 'Get all users (with filtering and pagination)' })
  @ApiSecurity('bearer')
  async getUsers(
    @Param('realmName') realmName: string,
    @Query('startIndex') startIndex?: string,
    @Query('count') count?: string,
    @Query('filter') filter?: string,
    @Query('attributes') attributes?: string,
    @Req() req?: ScimRequest,
  ): Promise<ScimListResponse<ScimUser>> {
    const realmId = req?.scimRealm?.id || realmName;
    return this.usersService.findAll(realmId, {
      startIndex: startIndex ? parseInt(startIndex, 10) : undefined,
      count: count ? parseInt(count, 10) : undefined,
      filter,
      attributes: attributes?.split(','),
    });
  }

  @Post(':realmName/Users')
  @UseGuards(ScimAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new user' })
  @ApiSecurity('bearer')
  async createUser(
    @Param('realmName') realmName: string,
    @Body() scimUser: ScimUser,
    @Req() req?: ScimRequest,
  ): Promise<ScimUser> {
    const realmId = req?.scimRealm?.id || realmName;
    return this.usersService.create(realmId, scimUser);
  }

  @Get(':realmName/Users/:id')
  @UseGuards(ScimAuthGuard)
  @ApiOperation({ summary: 'Get a user by ID' })
  @ApiSecurity('bearer')
  async getUserById(
    @Param('realmName') realmName: string,
    @Param('id') id: string,
    @Query('attributes') attributes?: string,
    @Req() req?: ScimRequest,
  ): Promise<ScimUser> {
    const realmId = req?.scimRealm?.id || realmName;
    return this.usersService.findById(realmId, id, attributes?.split(','));
  }

  @Put(':realmName/Users/:id')
  @UseGuards(ScimAuthGuard)
  @ApiOperation({ summary: 'Update a user (full replacement)' })
  @ApiSecurity('bearer')
  async updateUser(
    @Param('realmName') realmName: string,
    @Param('id') id: string,
    @Body() scimUser: ScimUser,
    @Req() req?: ScimRequest,
  ): Promise<ScimUser> {
    const realmId = req?.scimRealm?.id || realmName;
    return this.usersService.update(realmId, id, scimUser);
  }

  @Patch(':realmName/Users/:id')
  @UseGuards(ScimAuthGuard)
  @ApiOperation({ summary: 'Patch a user (partial update)' })
  @ApiSecurity('bearer')
  async patchUser(
    @Param('realmName') realmName: string,
    @Param('id') id: string,
    @Body() patchRequest: ScimPatchRequest,
    @Req() req?: ScimRequest,
  ): Promise<ScimUser> {
    const realmId = req?.scimRealm?.id || realmName;
    return this.usersService.patch(realmId, id, patchRequest.operations);
  }

  @Delete(':realmName/Users/:id')
  @UseGuards(ScimAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a user (deprovision)' })
  @ApiSecurity('bearer')
  async deleteUser(
    @Param('realmName') realmName: string,
    @Param('id') id: string,
    @Req() req?: ScimRequest,
  ): Promise<void> {
    const realmId = req?.scimRealm?.id || realmName;
    return this.usersService.delete(realmId, id);
  }

  @Post(':realmName/Users/.search')
  @UseGuards(ScimAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Search users using POST' })
  @ApiSecurity('bearer')
  async searchUsers(
    @Param('realmName') realmName: string,
    @Body() searchRequest: ScimSearchRequest,
    @Req() req?: ScimRequest,
  ): Promise<ScimListResponse<ScimUser>> {
    const realmId = req?.scimRealm?.id || realmName;
    return this.usersService.search(realmId, {
      filter: searchRequest.filter,
      attributes: searchRequest.attributes,
      excludedAttributes: searchRequest.excludedAttributes,
      startIndex: searchRequest.startIndex,
      count: searchRequest.count,
    });
  }

  // ══════════════════════════════════════════════════════════════
  // Group Endpoints
  // RFC 7644 Section 3.3
  // ══════════════════════════════════════════════════════════════

  @Get(':realmName/Groups')
  @UseGuards(ScimAuthGuard)
  @ApiOperation({ summary: 'Get all groups (with filtering and pagination)' })
  @ApiSecurity('bearer')
  async getGroups(
    @Param('realmName') realmName: string,
    @Query('startIndex') startIndex?: string,
    @Query('count') count?: string,
    @Query('filter') filter?: string,
    @Query('attributes') attributes?: string,
    @Req() req?: ScimRequest,
  ): Promise<ScimListResponse<ScimGroup>> {
    const realmId = req?.scimRealm?.id || realmName;
    return this.groupsService.findAll(realmId, {
      startIndex: startIndex ? parseInt(startIndex, 10) : undefined,
      count: count ? parseInt(count, 10) : undefined,
      filter,
      attributes: attributes?.split(','),
    });
  }

  @Post(':realmName/Groups')
  @UseGuards(ScimAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new group' })
  @ApiSecurity('bearer')
  async createGroup(
    @Param('realmName') realmName: string,
    @Body() scimGroup: ScimGroup,
    @Req() req?: ScimRequest,
  ): Promise<ScimGroup> {
    const realmId = req?.scimRealm?.id || realmName;
    return this.groupsService.create(realmId, scimGroup);
  }

  @Get(':realmName/Groups/:id')
  @UseGuards(ScimAuthGuard)
  @ApiOperation({ summary: 'Get a group by ID' })
  @ApiSecurity('bearer')
  async getGroupById(
    @Param('realmName') realmName: string,
    @Param('id') id: string,
    @Req() req?: ScimRequest,
  ): Promise<ScimGroup> {
    const realmId = req?.scimRealm?.id || realmName;
    return this.groupsService.findById(realmId, id);
  }

  @Put(':realmName/Groups/:id')
  @UseGuards(ScimAuthGuard)
  @ApiOperation({ summary: 'Update a group (full replacement)' })
  @ApiSecurity('bearer')
  async updateGroup(
    @Param('realmName') realmName: string,
    @Param('id') id: string,
    @Body() scimGroup: ScimGroup,
    @Req() req?: ScimRequest,
  ): Promise<ScimGroup> {
    const realmId = req?.scimRealm?.id || realmName;
    return this.groupsService.update(realmId, id, scimGroup);
  }

  @Patch(':realmName/Groups/:id')
  @UseGuards(ScimAuthGuard)
  @ApiOperation({ summary: 'Patch a group (partial update)' })
  @ApiSecurity('bearer')
  async patchGroup(
    @Param('realmName') realmName: string,
    @Param('id') id: string,
    @Body() patchRequest: ScimPatchRequest,
    @Req() req?: ScimRequest,
  ): Promise<ScimGroup> {
    const realmId = req?.scimRealm?.id || realmName;
    return this.groupsService.patch(realmId, id, patchRequest.operations);
  }

  @Delete(':realmName/Groups/:id')
  @UseGuards(ScimAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a group' })
  @ApiSecurity('bearer')
  async deleteGroup(
    @Param('realmName') realmName: string,
    @Param('id') id: string,
    @Req() req?: ScimRequest,
  ): Promise<void> {
    const realmId = req?.scimRealm?.id || realmName;
    return this.groupsService.delete(realmId, id);
  }

  @Post(':realmName/Groups/.search')
  @UseGuards(ScimAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Search groups using POST' })
  @ApiSecurity('bearer')
  async searchGroups(
    @Param('realmName') realmName: string,
    @Body() searchRequest: ScimSearchRequest,
    @Req() req?: ScimRequest,
  ): Promise<ScimListResponse<ScimGroup>> {
    const realmId = req?.scimRealm?.id || realmName;
    return this.groupsService.search(realmId, {
      filter: searchRequest.filter,
      attributes: searchRequest.attributes,
      excludedAttributes: searchRequest.excludedAttributes,
      startIndex: searchRequest.startIndex,
      count: searchRequest.count,
    });
  }

  // ══════════════════════════════════════════════════════════════
  // Bulk Operations Endpoint
  // RFC 7644 Section 3.7
  // ══════════════════════════════════════════════════════════════

  @Post(':realmName/Bulk')
  @UseGuards(ScimAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Execute bulk operations' })
  @ApiSecurity('bearer')
  async bulkOperations(
    @Param('realmName') realmName: string,
    @Body() bulkRequest: ScimBulkRequest,
    @Req() req?: ScimRequest,
  ): Promise<ScimBulkResponse> {
    const realmId = req?.scimRealm?.id || realmName;
    return this.bulkService.processBulk(realmId, bulkRequest);
  }
}