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
import { CustomAttributesService } from './custom-attributes.service.js';
import { CreateCustomAttributeDto } from './dto/create-custom-attribute.dto.js';
import { UpdateCustomAttributeDto } from './dto/update-custom-attribute.dto.js';
import { SetUserAttributesDto } from './dto/set-user-attributes.dto.js';
import { AdminApiKeyGuard } from '../common/guards/admin-api-key.guard.js';
import { RealmGuard } from '../common/guards/realm.guard.js';
import { CurrentRealm } from '../common/decorators/current-realm.decorator.js';

@ApiTags('Custom Attributes')
@Controller('admin/realms/:realmName/custom-attributes')
@UseGuards(RealmGuard, AdminApiKeyGuard)
@ApiSecurity('admin-api-key')
export class CustomAttributesController {
  constructor(private readonly service: CustomAttributesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a custom attribute definition for a realm' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  create(@CurrentRealm() realm: Realm, @Body() dto: CreateCustomAttributeDto) {
    return this.service.createAttribute(realm, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List all custom attribute definitions for a realm',
  })
  @ApiResponse({
    status: 200,
    description: 'List of custom attribute definitions',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  findAll(@CurrentRealm() realm: Realm) {
    return this.service.findAllAttributes(realm);
  }

  @Get(':attributeId')
  @ApiOperation({ summary: 'Get a custom attribute definition by ID' })
  @ApiResponse({ status: 200, description: 'Custom attribute definition' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  findOne(
    @CurrentRealm() realm: Realm,
    @Param('attributeId') attributeId: string,
  ) {
    return this.service.findAttributeById(realm, attributeId);
  }

  @Put(':attributeId')
  @ApiOperation({ summary: 'Update a custom attribute definition' })
  @ApiResponse({ status: 200, description: 'Updated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  update(
    @CurrentRealm() realm: Realm,
    @Param('attributeId') attributeId: string,
    @Body() dto: UpdateCustomAttributeDto,
  ) {
    return this.service.updateAttribute(realm, attributeId, dto);
  }

  @Delete(':attributeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a custom attribute definition' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  remove(
    @CurrentRealm() realm: Realm,
    @Param('attributeId') attributeId: string,
  ) {
    return this.service.removeAttribute(realm, attributeId);
  }
}

@ApiTags('Custom Attributes')
@Controller('admin/realms/:realmName/users/:userId/attributes')
@UseGuards(RealmGuard, AdminApiKeyGuard)
@ApiSecurity('admin-api-key')
export class UserAttributesController {
  constructor(private readonly service: CustomAttributesService) {}

  @Get()
  @ApiOperation({ summary: 'Get attribute values for a user' })
  @ApiResponse({ status: 200, description: 'User attribute values' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  getAttributes(@CurrentRealm() realm: Realm, @Param('userId') userId: string) {
    return this.service.getUserAttributes(realm, userId);
  }

  @Put()
  @ApiOperation({ summary: 'Set attribute values for a user' })
  @ApiResponse({ status: 200, description: 'Updated' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Not found' })
  setAttributes(
    @CurrentRealm() realm: Realm,
    @Param('userId') userId: string,
    @Body() dto: SetUserAttributesDto,
  ) {
    return this.service.setUserAttributes(realm, userId, dto.attributes);
  }
}
