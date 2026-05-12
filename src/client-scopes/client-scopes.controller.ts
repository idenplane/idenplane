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
import { ClientScopesService } from './client-scopes.service.js';
import { CreateClientScopeDto } from './dto/create-client-scope.dto.js';
import { UpdateClientScopeDto } from './dto/update-client-scope.dto.js';
import { AssignScopeDto } from './dto/assign-scope.dto.js';
import { RealmGuard } from '../common/guards/realm.guard.js';
import { CurrentRealm } from '../common/decorators/current-realm.decorator.js';

@ApiTags('Client Scopes')
@Controller('admin/realms/:realmName')
@UseGuards(RealmGuard)
@ApiSecurity('admin-api-key')
export class ClientScopesController {
  constructor(private readonly service: ClientScopesService) {}

  // ── Scope CRUD ─────────────────────────────────

  @Get('client-scopes')
  @ApiOperation({ summary: 'List client scopes in a realm' })
  @ApiResponse({ status: 200, description: 'List of client scopes' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  findAll(@CurrentRealm() realm: Realm) {
    return this.service.findAll(realm);
  }

  @Get('client-scopes/:scopeId')
  @ApiOperation({ summary: 'Get a client scope' })
  @ApiResponse({ status: 200, description: 'Client scope' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  findOne(@CurrentRealm() realm: Realm, @Param('scopeId') scopeId: string) {
    return this.service.findById(realm, scopeId);
  }

  @Post('client-scopes')
  @ApiOperation({ summary: 'Create a client scope' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  create(@CurrentRealm() realm: Realm, @Body() dto: CreateClientScopeDto) {
    return this.service.create(realm, dto);
  }

  @Put('client-scopes/:scopeId')
  @ApiOperation({ summary: 'Update a client scope' })
  @ApiResponse({ status: 200, description: 'Updated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  update(
    @CurrentRealm() realm: Realm,
    @Param('scopeId') scopeId: string,
    @Body() dto: UpdateClientScopeDto,
  ) {
    return this.service.update(realm, scopeId, dto);
  }

  @Delete('client-scopes/:scopeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a client scope' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  remove(@CurrentRealm() realm: Realm, @Param('scopeId') scopeId: string) {
    return this.service.remove(realm, scopeId);
  }

  // ── Protocol Mappers ────────────────────────────

  @Get('client-scopes/:scopeId/protocol-mappers')
  @ApiOperation({ summary: 'List protocol mappers for a client scope' })
  @ApiResponse({ status: 200, description: 'List of protocol mappers' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  getMappers(@CurrentRealm() realm: Realm, @Param('scopeId') scopeId: string) {
    return this.service.getMappers(realm, scopeId);
  }

  @Post('client-scopes/:scopeId/protocol-mappers')
  @ApiOperation({ summary: 'Add a protocol mapper to a scope' })
  @ApiResponse({ status: 201, description: 'Protocol mapper added' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  addMapper(
    @CurrentRealm() realm: Realm,
    @Param('scopeId') scopeId: string,
    @Body()
    body: {
      name: string;
      mapperType?: string;
      protocolMapper?: string;
      protocol?: string;
      config?: Record<string, unknown>;
    },
  ) {
    return this.service.addMapper(realm, scopeId, body);
  }

  @Put('client-scopes/:scopeId/protocol-mappers/:mapperId')
  @ApiOperation({ summary: 'Update a protocol mapper' })
  @ApiResponse({ status: 200, description: 'Updated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  updateMapper(
    @CurrentRealm() realm: Realm,
    @Param('scopeId') scopeId: string,
    @Param('mapperId') mapperId: string,
    @Body() body: { name?: string; config?: Record<string, unknown> },
  ) {
    return this.service.updateMapper(realm, scopeId, mapperId, body);
  }

  @Delete('client-scopes/:scopeId/protocol-mappers/:mapperId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a protocol mapper' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  removeMapper(
    @CurrentRealm() realm: Realm,
    @Param('scopeId') scopeId: string,
    @Param('mapperId') mapperId: string,
  ) {
    return this.service.removeMapper(realm, scopeId, mapperId);
  }

  // ── Client scope assignments ────────────────────

  @Get('clients/:clientId/default-client-scopes')
  @ApiOperation({ summary: 'Get default scopes assigned to a client' })
  @ApiResponse({ status: 200, description: 'List of default client scopes' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  getDefaultScopes(
    @CurrentRealm() realm: Realm,
    @Param('clientId') clientId: string,
  ) {
    return this.service.getDefaultScopes(realm, clientId);
  }

  @Post('clients/:clientId/default-client-scopes')
  @ApiOperation({ summary: 'Assign a default scope to a client' })
  @ApiResponse({ status: 201, description: 'Default scope assigned' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  assignDefaultScope(
    @CurrentRealm() realm: Realm,
    @Param('clientId') clientId: string,
    @Body() dto: AssignScopeDto,
  ) {
    return this.service.assignDefaultScope(realm, clientId, dto.clientScopeId);
  }

  @Delete('clients/:clientId/default-client-scopes/:scopeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a default scope from a client' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  removeDefaultScope(
    @CurrentRealm() realm: Realm,
    @Param('clientId') clientId: string,
    @Param('scopeId') scopeId: string,
  ) {
    return this.service.removeDefaultScope(realm, clientId, scopeId);
  }

  @Get('clients/:clientId/optional-client-scopes')
  @ApiOperation({ summary: 'Get optional scopes assigned to a client' })
  @ApiResponse({ status: 200, description: 'List of optional client scopes' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  getOptionalScopes(
    @CurrentRealm() realm: Realm,
    @Param('clientId') clientId: string,
  ) {
    return this.service.getOptionalScopes(realm, clientId);
  }

  @Post('clients/:clientId/optional-client-scopes')
  @ApiOperation({ summary: 'Assign an optional scope to a client' })
  @ApiResponse({ status: 201, description: 'Optional scope assigned' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  assignOptionalScope(
    @CurrentRealm() realm: Realm,
    @Param('clientId') clientId: string,
    @Body() dto: AssignScopeDto,
  ) {
    return this.service.assignOptionalScope(realm, clientId, dto.clientScopeId);
  }

  @Delete('clients/:clientId/optional-client-scopes/:scopeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove an optional scope from a client' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  removeOptionalScope(
    @CurrentRealm() realm: Realm,
    @Param('clientId') clientId: string,
    @Param('scopeId') scopeId: string,
  ) {
    return this.service.removeOptionalScope(realm, clientId, scopeId);
  }
}
