import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiSecurity,
  ApiResponse,
} from '@nestjs/swagger';
import { UserFederationService } from './user-federation.service.js';
import { CreateUserFederationDto } from './dto/create-user-federation.dto.js';
import { UpdateUserFederationDto } from './dto/update-user-federation.dto.js';
import {
  RateLimitGuard,
  RateLimitByUser,
} from '../rate-limit/rate-limit.guard.js';
import { RealmGuard } from '../common/guards/realm.guard.js';
import { AdminApiKeyGuard } from '../common/guards/admin-api-key.guard.js';

@ApiTags('User Federation')
@Controller('admin/realms/:realmName/user-federation')
@UseGuards(RateLimitGuard, RealmGuard, AdminApiKeyGuard)
@RateLimitByUser()
@ApiSecurity('admin-api-key')
export class UserFederationController {
  constructor(private readonly service: UserFederationService) {}

  @Post()
  @ApiOperation({ summary: 'Create a user federation provider' })
  @ApiResponse({ status: 201, description: 'User federation provider created' })
  @ApiResponse({ status: 400, description: 'Bad request — invalid DTO' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid admin API key',
  })
  create(
    @Param('realmName') realmName: string,
    @Body() dto: CreateUserFederationDto,
  ) {
    return this.service.create(realmName, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List user federation providers' })
  @ApiResponse({
    status: 200,
    description: 'Array of user federation providers in the realm',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid admin API key',
  })
  findAll(@Param('realmName') realmName: string) {
    return this.service.findAll(realmName);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a user federation provider' })
  @ApiResponse({ status: 200, description: 'User federation provider details' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid admin API key',
  })
  @ApiResponse({
    status: 404,
    description: 'User federation provider not found',
  })
  findOne(@Param('realmName') realmName: string, @Param('id') id: string) {
    return this.service.findById(realmName, id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a user federation provider' })
  @ApiResponse({ status: 200, description: 'User federation provider updated' })
  @ApiResponse({ status: 400, description: 'Bad request — invalid DTO' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid admin API key',
  })
  @ApiResponse({
    status: 404,
    description: 'User federation provider not found',
  })
  update(
    @Param('realmName') realmName: string,
    @Param('id') id: string,
    @Body() dto: UpdateUserFederationDto,
  ) {
    return this.service.update(realmName, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a user federation provider' })
  @ApiResponse({ status: 200, description: 'User federation provider deleted' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid admin API key',
  })
  @ApiResponse({
    status: 404,
    description: 'User federation provider not found',
  })
  remove(@Param('realmName') realmName: string, @Param('id') id: string) {
    return this.service.remove(realmName, id);
  }

  @Post(':id/test-connection')
  @ApiOperation({ summary: 'Test LDAP connection' })
  @ApiResponse({ status: 201, description: 'Connection test result' })
  @ApiResponse({
    status: 400,
    description: 'Connection failed — invalid config or unreachable host',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid admin API key',
  })
  @ApiResponse({
    status: 404,
    description: 'User federation provider not found',
  })
  testConnection(
    @Param('realmName') realmName: string,
    @Param('id') id: string,
  ) {
    return this.service.testConnection(realmName, id);
  }

  @Post(':id/sync')
  @ApiOperation({ summary: 'Trigger full LDAP sync' })
  @ApiResponse({
    status: 201,
    description: 'Sync triggered; returns sync result summary',
  })
  @ApiResponse({
    status: 400,
    description: 'Sync failed — LDAP error or misconfiguration',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized — missing or invalid admin API key',
  })
  @ApiResponse({
    status: 404,
    description: 'User federation provider not found',
  })
  sync(@Param('realmName') realmName: string, @Param('id') id: string) {
    return this.service.syncUsers(realmName, id);
  }
}
