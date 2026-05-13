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
import { WebhooksService } from './webhooks.service.js';
import { CreateWebhookDto, UpdateWebhookDto } from './webhooks.dto.js';
import { RealmGuard } from '../common/guards/realm.guard.js';
import { AdminApiKeyGuard } from '../common/guards/admin-api-key.guard.js';
import { CurrentRealm } from '../common/decorators/current-realm.decorator.js';
import {
  RateLimitGuard,
  RateLimitByIp,
} from '../rate-limit/rate-limit.guard.js';

@ApiTags('Webhooks')
@Controller('admin/realms/:realmName/webhooks')
@UseGuards(RealmGuard, AdminApiKeyGuard, RateLimitGuard)
@RateLimitByIp()
@ApiSecurity('admin-api-key')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post()
  @ApiOperation({ summary: 'Create a webhook in a realm' })
  @ApiResponse({ status: 201, description: 'Webhook created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  create(@CurrentRealm() realm: Realm, @Body() dto: CreateWebhookDto) {
    return this.webhooksService.create(realm, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List webhooks in a realm' })
  @ApiResponse({ status: 200, description: 'List of webhooks' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  findAll(@CurrentRealm() realm: Realm) {
    return this.webhooksService.findAll(realm);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a webhook by ID' })
  @ApiResponse({ status: 200, description: 'Webhook details' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Webhook not found' })
  findOne(@CurrentRealm() realm: Realm, @Param('id') id: string) {
    return this.webhooksService.findOne(realm, id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a webhook' })
  @ApiResponse({ status: 200, description: 'Webhook updated successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Webhook not found' })
  update(
    @CurrentRealm() realm: Realm,
    @Param('id') id: string,
    @Body() dto: UpdateWebhookDto,
  ) {
    return this.webhooksService.update(realm, id, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Partially update a webhook' })
  @ApiResponse({ status: 200, description: 'Webhook updated successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Webhook not found' })
  partialUpdate(
    @CurrentRealm() realm: Realm,
    @Param('id') id: string,
    @Body() dto: UpdateWebhookDto,
  ) {
    return this.webhooksService.update(realm, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a webhook' })
  @ApiResponse({ status: 204, description: 'Webhook deleted successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Webhook not found' })
  remove(@CurrentRealm() realm: Realm, @Param('id') id: string) {
    return this.webhooksService.remove(realm, id);
  }

  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a test event to the webhook' })
  @ApiResponse({ status: 200, description: 'Test event dispatched' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Webhook not found' })
  test(@CurrentRealm() realm: Realm, @Param('id') id: string) {
    return this.webhooksService.testWebhook(realm, id);
  }

  @Get(':id/deliveries')
  @ApiOperation({ summary: 'List delivery logs for a webhook' })
  @ApiResponse({ status: 200, description: 'List of webhook delivery logs' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Webhook not found' })
  deliveries(@CurrentRealm() realm: Realm, @Param('id') id: string) {
    return this.webhooksService.findDeliveries(realm, id);
  }
}
