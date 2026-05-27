import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
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
import { ConsentCategoryService } from './consent-category.service.js';
import { ConsentStatisticsService } from './consent-stats.service.js';
import { CreateConsentCategoryDto } from './dto/create-consent-category.dto.js';
import { UpdateConsentCategoryDto } from './dto/update-consent-category.dto.js';
import { AdminApiKeyGuard } from '../common/guards/admin-api-key.guard.js';
import { RealmGuard } from '../common/guards/realm.guard.js';
import { CurrentRealm } from '../common/decorators/current-realm.decorator.js';

@ApiTags('Consent Categories')
@Controller('admin/realms/:realmName')
@UseGuards(RealmGuard, AdminApiKeyGuard)
@ApiSecurity('admin-api-key')
export class ConsentCategoriesController {
  constructor(
    private readonly service: ConsentCategoryService,
    private readonly statsService: ConsentStatisticsService,
  ) {}

  @Get('consent-categories')
  @ApiOperation({ summary: 'List consent categories in a realm' })
  @ApiResponse({ status: 200, description: 'List of consent categories' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  findAll(
    @CurrentRealm() realm: Realm,
    @Query('includeDisabled') includeDisabled?: string,
  ) {
    return this.service.findAll(realm, includeDisabled === 'true');
  }

  @Get('consent-categories/:categoryId')
  @ApiOperation({ summary: 'Get a consent category by ID' })
  @ApiResponse({ status: 200, description: 'Consent category' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  findOne(
    @CurrentRealm() realm: Realm,
    @Param('categoryId') categoryId: string,
  ) {
    return this.service.findById(realm, categoryId);
  }

  @Get('consent-categories/:categoryId/stats')
  @ApiOperation({ summary: 'Get usage statistics for a consent category' })
  @ApiResponse({ status: 200, description: 'Consent category statistics' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  stats(
    @CurrentRealm() realm: Realm,
    @Param('categoryId') categoryId: string,
  ) {
    return this.statsService.getCategoryStats(realm, categoryId);
  }

  @Post('consent-categories')
  @ApiOperation({ summary: 'Create a consent category' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 409,
    description: 'Conflict - category already exists',
  })
  create(@CurrentRealm() realm: Realm, @Body() dto: CreateConsentCategoryDto) {
    return this.service.create(realm, dto);
  }

  @Put('consent-categories/:categoryId')
  @ApiOperation({ summary: 'Update a consent category' })
  @ApiResponse({ status: 200, description: 'Updated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  update(
    @CurrentRealm() realm: Realm,
    @Param('categoryId') categoryId: string,
    @Body() dto: UpdateConsentCategoryDto,
  ) {
    return this.service.update(realm, categoryId, dto);
  }

  @Delete('consent-categories/:categoryId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a consent category' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  remove(
    @CurrentRealm() realm: Realm,
    @Param('categoryId') categoryId: string,
  ) {
    return this.service.delete(realm, categoryId);
  }

  @Get('consent-categories/portal/active')
  @ApiOperation({ summary: 'Get categories shown in the account portal' })
  @ApiResponse({ status: 200, description: 'List of portal categories' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  getPortalCategories(@CurrentRealm() realm: Realm) {
    return this.service.getPortalCategories(realm);
  }
}
