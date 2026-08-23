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
  ApiSecurity,
  ApiResponse,
} from '@nestjs/swagger';
import type { Realm } from '@prisma/client';
import { RealmGuard } from '../common/guards/realm.guard.js';
import { AdminApiKeyGuard } from '../common/guards/admin-api-key.guard.js';
import { CurrentRealm } from '../common/decorators/current-realm.decorator.js';
import {
  RateLimitGuard,
  RateLimitByIp,
} from '../rate-limit/rate-limit.guard.js';
import { ProxyApplicationsService } from './proxy-applications.service.js';
import { CreateProxyApplicationDto } from './dto/create-proxy-application.dto.js';
import { UpdateProxyApplicationDto } from './dto/update-proxy-application.dto.js';

@ApiTags('Proxy Applications')
@Controller('admin/realms/:realmName/proxy-applications')
@UseGuards(RealmGuard, AdminApiKeyGuard, RateLimitGuard)
@RateLimitByIp()
@ApiSecurity('admin-api-key')
export class ProxyApplicationsController {
  constructor(private readonly service: ProxyApplicationsService) {}

  @Post()
  @ApiOperation({
    summary: 'Register an application to be protected at the reverse proxy',
    description:
      'Returns the callback URL to register on the OAuth client, and whether it already is.',
  })
  @ApiResponse({ status: 201, description: 'Proxy application created' })
  @ApiResponse({
    status: 400,
    description:
      'Invalid body, or cookieDomain does not cover an allowed redirect URI',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Client not found' })
  @ApiResponse({
    status: 409,
    description: 'Slug already in use in this realm',
  })
  create(@CurrentRealm() realm: Realm, @Body() dto: CreateProxyApplicationDto) {
    return this.service.create(realm, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List proxy applications in a realm' })
  @ApiResponse({ status: 200, description: 'List of proxy applications' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  findAll(@CurrentRealm() realm: Realm) {
    return this.service.findAll(realm);
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Get a proxy application by slug' })
  @ApiResponse({ status: 200, description: 'Proxy application details' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Proxy application not found' })
  findOne(@CurrentRealm() realm: Realm, @Param('slug') slug: string) {
    return this.service.findOne(realm, slug);
  }

  @Put(':slug')
  @ApiOperation({
    summary: 'Update a proxy application',
    description:
      'The slug is immutable — it is baked into the reverse proxy config, so renaming it here would silently break a working deployment. Delete and recreate instead.',
  })
  @ApiResponse({ status: 200, description: 'Proxy application updated' })
  @ApiResponse({ status: 400, description: 'Invalid body' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Proxy application not found' })
  update(
    @CurrentRealm() realm: Realm,
    @Param('slug') slug: string,
    @Body() dto: UpdateProxyApplicationDto,
  ) {
    return this.service.update(realm, slug, dto);
  }

  @Delete(':slug')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a proxy application',
    description: 'Its live proxy sessions are deleted with it.',
  })
  @ApiResponse({ status: 204, description: 'Proxy application deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Proxy application not found' })
  async remove(@CurrentRealm() realm: Realm, @Param('slug') slug: string) {
    await this.service.remove(realm, slug);
  }

  @Post(':slug/revoke-sessions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Revoke every live session for a proxy application',
    description:
      'Forces all users back through login on their next request, without deleting the application.',
  })
  @ApiResponse({ status: 200, description: 'Number of sessions revoked' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Proxy application not found' })
  revokeSessions(@CurrentRealm() realm: Realm, @Param('slug') slug: string) {
    return this.service.revokeSessions(realm, slug);
  }
}
