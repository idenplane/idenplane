import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
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
  ApiSecurity,
  ApiResponse,
} from '@nestjs/swagger';
import type { Realm } from '@prisma/client';
import { ClientsService } from './clients.service.js';
import { CreateClientDto } from './dto/create-client.dto.js';
import { UpdateClientDto } from './dto/update-client.dto.js';
import { RealmGuard } from '../common/guards/realm.guard.js';
import { AdminApiKeyGuard } from '../common/guards/admin-api-key.guard.js';
import { CurrentRealm } from '../common/decorators/current-realm.decorator.js';
import {
  RateLimitGuard,
  RateLimitByIp,
} from '../rate-limit/rate-limit.guard.js';

@ApiTags('Clients')
@Controller('admin/realms/:realmName/clients')
@UseGuards(RealmGuard, AdminApiKeyGuard, RateLimitGuard)
@RateLimitByIp()
@ApiSecurity('admin-api-key')
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a client in a realm' })
  @ApiResponse({ status: 201, description: 'Client created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  create(@CurrentRealm() realm: Realm, @Body() dto: CreateClientDto) {
    return this.clientsService.create(realm, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List clients in a realm' })
  @ApiResponse({ status: 200, description: 'List of clients' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  findAll(@CurrentRealm() realm: Realm) {
    return this.clientsService.findAll(realm);
  }

  @Get(':clientId')
  @ApiOperation({ summary: 'Get a client by ID' })
  @ApiResponse({ status: 200, description: 'Client details' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Client not found' })
  findOne(@CurrentRealm() realm: Realm, @Param('clientId') clientId: string) {
    return this.clientsService.findByClientId(realm, clientId);
  }

  @Put(':clientId')
  @ApiOperation({ summary: 'Update a client' })
  @ApiResponse({ status: 200, description: 'Client updated successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Client not found' })
  update(
    @CurrentRealm() realm: Realm,
    @Param('clientId') clientId: string,
    @Body() dto: UpdateClientDto,
  ) {
    return this.clientsService.update(realm, clientId, dto);
  }

  @Patch(':clientId')
  @ApiOperation({ summary: 'Partially update a client' })
  @ApiResponse({ status: 200, description: 'Client updated successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Client not found' })
  partialUpdate(
    @CurrentRealm() realm: Realm,
    @Param('clientId') clientId: string,
    @Body() dto: UpdateClientDto,
  ) {
    return this.clientsService.update(realm, clientId, dto);
  }

  @Delete(':clientId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a client' })
  @ApiResponse({ status: 204, description: 'Client deleted successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Client not found' })
  remove(@CurrentRealm() realm: Realm, @Param('clientId') clientId: string) {
    return this.clientsService.remove(realm, clientId);
  }

  @Post(':clientId/regenerate-secret')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Regenerate client secret' })
  @ApiResponse({ status: 200, description: 'Client secret regenerated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Client not found' })
  regenerateSecret(
    @CurrentRealm() realm: Realm,
    @Param('clientId') clientId: string,
  ) {
    return this.clientsService.regenerateSecret(realm, clientId);
  }

  @Get(':clientId/service-account-user')
  @ApiOperation({ summary: 'Get service account user for a client' })
  @ApiResponse({ status: 200, description: 'Service account user details' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 404,
    description: 'Client or service account not found',
  })
  getServiceAccount(
    @CurrentRealm() realm: Realm,
    @Param('clientId') clientId: string,
  ) {
    return this.clientsService.getServiceAccount(realm, clientId);
  }
}
