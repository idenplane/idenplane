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
  Req,
  Res,
  HttpCode,
  HttpStatus,
  UseGuards,
  UseFilters,
  UseInterceptors,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiSecurity,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ScimAuthGuard } from './guards/scim-auth.guard.js';
import { ScimServiceProviderConfigService } from './service-provider-config.service.js';
import { ScimUsersService } from './scim-users.service.js';
import { ScimGroupsService } from './scim-groups.service.js';
import { ScimBulkService } from './scim-bulk.service.js';
import {
  ScimContentTypeInterceptor,
  ScimExceptionFilter,
} from './scim-exception.filter.js';
import { getPatchOperations } from './patch-request.js';
import { scimBadRequest } from './scim-errors.js';
import { SCIM_SCHEMAS } from './types/scim.types.js';
import type {
  ScimServiceProviderConfig,
  ScimUser,
  ScimGroup,
  ScimListResponse,
  ScimSearchRequest,
  ScimPatchRequest,
  ScimBulkRequest,
  ScimBulkResponse,
  ScimRealmRef,
  ScimSchema,
  ScimResourceType,
} from './types/scim.types.js';

interface ScimRequest extends Request {
  scimRealm?: {
    id: string;
    name: string;
    scimUserAutocreate?: boolean;
    scimGroupSyncEnabled?: boolean;
  };
}

/** The realm the guard authenticated the request for. */
function scimRealm(req: ScimRequest | undefined): ScimRealmRef {
  const realm = req?.scimRealm;
  if (!realm) throw new UnauthorizedException('SCIM realm not resolved');
  return { id: realm.id, name: realm.name };
}

/**
 * A query parameter given once, as a string. Express turns `?filter=a&filter=b`
 * (or `filter[]=…`) into an array or an object; RFC 7644 defines each of
 * these parameters once, so anything but a single string is a 400, never a
 * value passed on to code that expects a string.
 */
function singleParam(
  name: string,
  value: unknown,
  scimType: 'invalidFilter' | 'invalidValue' = 'invalidValue',
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw scimBadRequest(scimType, `The ${name} parameter must be given once`);
  }
  return value;
}

function intParam(raw: unknown, name = 'startIndex'): number | undefined {
  const value = singleParam(name, raw);
  if (value === undefined || value === '') return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}

function listParam(raw: unknown, name = 'attributes'): string[] | undefined {
  const value = singleParam(name, raw);
  if (!value) return undefined;
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

/** `attributes` and `excludedAttributes` query parameters (RFC 7644 §3.9). */
function projectionOf(
  attributes: unknown,
  excludedAttributes: unknown,
): { attributes?: string[]; excludedAttributes?: string[] } {
  return {
    attributes: listParam(attributes),
    excludedAttributes: listParam(excludedAttributes, 'excludedAttributes'),
  };
}

/** RFC 7644 §4: `/Schemas` and `/ResourceTypes` answer with a ListResponse. */
function listOf<T>(items: T[]): ScimListResponse<T> {
  return {
    schemas: [SCIM_SCHEMAS.LIST_RESPONSE],
    totalResults: items.length,
    startIndex: 1,
    itemsPerPage: items.length,
    Resources: items,
  };
}

@ApiTags('SCIM 2.0')
@Controller('scim/v2')
@ApiParam({
  name: 'realmName',
  required: true,
  description: 'Realm name (on the realm-scoped routes)',
})
@UseFilters(ScimExceptionFilter)
@UseInterceptors(ScimContentTypeInterceptor)
export class ScimController {
  constructor(
    private readonly configService: ScimServiceProviderConfigService,
    private readonly usersService: ScimUsersService,
    private readonly groupsService: ScimGroupsService,
    private readonly bulkService: ScimBulkService,
  ) {}

  // ══════════════════════════════════════════════════════════════
  // Service Provider Configuration Endpoints
  // RFC 7644 Section 4. Served both at /scim/v2 and under each realm's
  // base URL (/scim/v2/{realm}), where SCIM clients look for them.
  // ══════════════════════════════════════════════════════════════

  @Get('ServiceProviderConfig')
  @ApiOperation({ summary: 'Get SCIM Service Provider Configuration' })
  @ApiResponse({ status: 200, description: 'Service provider configuration' })
  getServiceProviderConfig(): ScimServiceProviderConfig {
    return this.configService.getConfig();
  }

  @Get('Schemas')
  @ApiOperation({ summary: 'Get all SCIM schemas' })
  @ApiResponse({ status: 200, description: 'List of all schemas' })
  getSchemas(realmName?: string): ScimListResponse<ScimSchema> {
    return listOf(this.configService.getSchemas(realmName).map(withSchemaUrn));
  }

  @Get('Schemas/:schemaId')
  @ApiOperation({ summary: 'Get a specific schema' })
  @ApiResponse({ status: 200, description: 'Schema details' })
  getSchemaById(
    @Param('schemaId') schemaId: string,
    realmName?: string,
  ): ScimSchema {
    const schema = this.configService.getSchemaById(schemaId, realmName);
    if (!schema) {
      throw new NotFoundException(`Schema '${schemaId}' not found`);
    }
    return withSchemaUrn(schema);
  }

  @Get('ResourceTypes')
  @ApiOperation({ summary: 'Get all SCIM resource types' })
  @ApiResponse({ status: 200, description: 'List of all resource types' })
  getResourceTypes(realmName?: string): ScimListResponse<ScimResourceType> {
    return listOf(this.configService.getResourceTypes(realmName));
  }

  @Get('ResourceTypes/:resourceTypeId')
  @ApiOperation({ summary: 'Get a specific resource type' })
  @ApiResponse({ status: 200, description: 'Resource type details' })
  getResourceTypeById(
    @Param('resourceTypeId') resourceTypeId: string,
    realmName?: string,
  ): ScimResourceType {
    const rt = this.configService.getResourceTypeByName(
      resourceTypeId,
      realmName,
    );
    if (!rt) {
      throw new NotFoundException(
        `Resource type '${resourceTypeId}' not found`,
      );
    }
    return rt;
  }

  @Get(':realmName/ServiceProviderConfig')
  @ApiOperation({ summary: 'Service Provider Configuration (realm base URL)' })
  getRealmServiceProviderConfig(
    @Param('realmName') realmName: string,
  ): ScimServiceProviderConfig {
    return this.configService.getConfig(realmName);
  }

  @Get(':realmName/Schemas')
  @ApiOperation({ summary: 'All SCIM schemas (realm base URL)' })
  getRealmSchemas(
    @Param('realmName') realmName: string,
  ): ScimListResponse<ScimSchema> {
    return this.getSchemas(realmName);
  }

  @Get(':realmName/Schemas/:schemaId')
  @ApiOperation({ summary: 'A specific schema (realm base URL)' })
  getRealmSchemaById(
    @Param('realmName') realmName: string,
    @Param('schemaId') schemaId: string,
  ): ScimSchema {
    return this.getSchemaById(schemaId, realmName);
  }

  @Get(':realmName/ResourceTypes')
  @ApiOperation({ summary: 'All SCIM resource types (realm base URL)' })
  getRealmResourceTypes(
    @Param('realmName') realmName: string,
  ): ScimListResponse<ScimResourceType> {
    return this.getResourceTypes(realmName);
  }

  @Get(':realmName/ResourceTypes/:resourceTypeId')
  @ApiOperation({ summary: 'A specific resource type (realm base URL)' })
  getRealmResourceTypeById(
    @Param('realmName') realmName: string,
    @Param('resourceTypeId') resourceTypeId: string,
  ): ScimResourceType {
    return this.getResourceTypeById(resourceTypeId, realmName);
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
    @Query('startIndex') startIndex?: string,
    @Query('count') count?: string,
    @Query('filter') filter?: unknown,
    @Query('attributes') attributes?: string,
    @Query('excludedAttributes') excludedAttributes?: string,
    @Req() req?: ScimRequest,
  ): Promise<ScimListResponse<ScimUser>> {
    return this.usersService.findAll(scimRealm(req), {
      startIndex: intParam(startIndex),
      count: intParam(count, 'count'),
      filter: singleParam('filter', filter, 'invalidFilter'),
      attributes: listParam(attributes),
      excludedAttributes: listParam(excludedAttributes, 'excludedAttributes'),
    });
  }

  @Post(':realmName/Users')
  @UseGuards(ScimAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new user' })
  @ApiSecurity('bearer')
  async createUser(
    @Body() scimUser: ScimUser,
    @Req() req: ScimRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ScimUser> {
    const user = await this.usersService.create(scimRealm(req), scimUser);
    if (user.meta?.location) res.setHeader('Location', user.meta.location);
    return user;
  }

  @Get(':realmName/Users/:id')
  @UseGuards(ScimAuthGuard)
  @ApiOperation({ summary: 'Get a user by ID' })
  @ApiSecurity('bearer')
  async getUserById(
    @Param('id') id: string,
    @Query('attributes') attributes?: string,
    @Query('excludedAttributes') excludedAttributes?: string,
    @Req() req?: ScimRequest,
  ): Promise<ScimUser> {
    return this.usersService.findById(
      scimRealm(req),
      id,
      projectionOf(attributes, excludedAttributes),
    );
  }

  @Put(':realmName/Users/:id')
  @UseGuards(ScimAuthGuard)
  @ApiOperation({ summary: 'Update a user (full replacement)' })
  @ApiSecurity('bearer')
  async updateUser(
    @Param('id') id: string,
    @Body() scimUser: ScimUser,
    @Query('attributes') attributes?: string,
    @Query('excludedAttributes') excludedAttributes?: string,
    @Req() req?: ScimRequest,
  ): Promise<ScimUser> {
    return this.usersService.update(
      scimRealm(req),
      id,
      scimUser,
      projectionOf(attributes, excludedAttributes),
    );
  }

  @Patch(':realmName/Users/:id')
  @UseGuards(ScimAuthGuard)
  @ApiOperation({ summary: 'Patch a user (partial update)' })
  @ApiSecurity('bearer')
  async patchUser(
    @Param('id') id: string,
    @Body() patchRequest: ScimPatchRequest,
    @Query('attributes') attributes?: string,
    @Query('excludedAttributes') excludedAttributes?: string,
    @Req() req?: ScimRequest,
  ): Promise<ScimUser> {
    return this.usersService.patch(
      scimRealm(req),
      id,
      getPatchOperations(patchRequest),
      projectionOf(attributes, excludedAttributes),
    );
  }

  @Delete(':realmName/Users/:id')
  @UseGuards(ScimAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a user (deprovision)' })
  @ApiSecurity('bearer')
  async deleteUser(
    @Param('id') id: string,
    @Req() req?: ScimRequest,
  ): Promise<void> {
    return this.usersService.delete(scimRealm(req), id);
  }

  @Post(':realmName/Users/.search')
  @UseGuards(ScimAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Search users using POST' })
  @ApiSecurity('bearer')
  async searchUsers(
    @Body() searchRequest: ScimSearchRequest,
    @Req() req?: ScimRequest,
  ): Promise<ScimListResponse<ScimUser>> {
    return this.usersService.search(scimRealm(req), {
      filter: searchRequest?.filter,
      attributes: searchRequest?.attributes,
      excludedAttributes: searchRequest?.excludedAttributes,
      startIndex: searchRequest?.startIndex,
      count: searchRequest?.count,
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
    @Query('startIndex') startIndex?: string,
    @Query('count') count?: string,
    @Query('filter') filter?: unknown,
    @Query('attributes') attributes?: string,
    @Query('excludedAttributes') excludedAttributes?: string,
    @Req() req?: ScimRequest,
  ): Promise<ScimListResponse<ScimGroup>> {
    return this.groupsService.findAll(scimRealm(req), {
      startIndex: intParam(startIndex),
      count: intParam(count, 'count'),
      filter: singleParam('filter', filter, 'invalidFilter'),
      attributes: listParam(attributes),
      excludedAttributes: listParam(excludedAttributes, 'excludedAttributes'),
    });
  }

  @Post(':realmName/Groups')
  @UseGuards(ScimAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new group' })
  @ApiSecurity('bearer')
  async createGroup(
    @Body() scimGroup: ScimGroup,
    @Req() req: ScimRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ScimGroup> {
    const group = await this.groupsService.create(scimRealm(req), scimGroup);
    if (group.meta?.location) res.setHeader('Location', group.meta.location);
    return group;
  }

  @Get(':realmName/Groups/:id')
  @UseGuards(ScimAuthGuard)
  @ApiOperation({ summary: 'Get a group by ID' })
  @ApiSecurity('bearer')
  async getGroupById(
    @Param('id') id: string,
    @Query('attributes') attributes?: string,
    @Query('excludedAttributes') excludedAttributes?: string,
    @Req() req?: ScimRequest,
  ): Promise<ScimGroup> {
    return this.groupsService.findById(
      scimRealm(req),
      id,
      projectionOf(attributes, excludedAttributes),
    );
  }

  @Put(':realmName/Groups/:id')
  @UseGuards(ScimAuthGuard)
  @ApiOperation({ summary: 'Update a group (full replacement)' })
  @ApiSecurity('bearer')
  async updateGroup(
    @Param('id') id: string,
    @Body() scimGroup: ScimGroup,
    @Query('attributes') attributes?: string,
    @Query('excludedAttributes') excludedAttributes?: string,
    @Req() req?: ScimRequest,
  ): Promise<ScimGroup> {
    return this.groupsService.update(
      scimRealm(req),
      id,
      scimGroup,
      projectionOf(attributes, excludedAttributes),
    );
  }

  @Patch(':realmName/Groups/:id')
  @UseGuards(ScimAuthGuard)
  @ApiOperation({
    summary: 'Patch a group (partial update)',
    description:
      'Answers 204 No Content, or 200 with the group when the request has an "attributes" or "excludedAttributes" query parameter (RFC 7644 section 3.5.2).',
  })
  @ApiSecurity('bearer')
  async patchGroup(
    @Param('id') id: string,
    @Body() patchRequest: ScimPatchRequest,
    @Res({ passthrough: true }) res: Response,
    @Query('attributes') attributes?: string,
    @Query('excludedAttributes') excludedAttributes?: string,
    @Req() req?: ScimRequest,
  ): Promise<ScimGroup | undefined> {
    const projection =
      attributes !== undefined || excludedAttributes !== undefined
        ? projectionOf(attributes, excludedAttributes)
        : undefined;
    const group = await this.groupsService.patch(
      scimRealm(req),
      id,
      getPatchOperations(patchRequest),
      projection,
    );
    if (!group) {
      res.status(HttpStatus.NO_CONTENT);
      return undefined;
    }
    return group;
  }

  @Delete(':realmName/Groups/:id')
  @UseGuards(ScimAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a group' })
  @ApiSecurity('bearer')
  async deleteGroup(
    @Param('id') id: string,
    @Req() req?: ScimRequest,
  ): Promise<void> {
    return this.groupsService.delete(scimRealm(req), id);
  }

  @Post(':realmName/Groups/.search')
  @UseGuards(ScimAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Search groups using POST' })
  @ApiSecurity('bearer')
  async searchGroups(
    @Body() searchRequest: ScimSearchRequest,
    @Req() req?: ScimRequest,
  ): Promise<ScimListResponse<ScimGroup>> {
    return this.groupsService.search(scimRealm(req), {
      filter: searchRequest?.filter,
      attributes: searchRequest?.attributes,
      excludedAttributes: searchRequest?.excludedAttributes,
      startIndex: searchRequest?.startIndex,
      count: searchRequest?.count,
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
    @Body() bulkRequest: ScimBulkRequest,
    @Req() req?: ScimRequest,
  ): Promise<ScimBulkResponse> {
    return this.bulkService.processBulk(scimRealm(req), bulkRequest);
  }
}

/** A schema resource carries its own `schemas` (RFC 7643 §7). */
function withSchemaUrn(schema: ScimSchema): ScimSchema {
  return { schemas: [SCIM_SCHEMAS.SCHEMA], ...schema };
}
