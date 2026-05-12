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
import { RolesService } from './roles.service.js';
import { CreateRoleDto } from './dto/create-role.dto.js';
import { UpdateRoleDto } from './dto/update-role.dto.js';
import { AssignRolesDto } from './dto/assign-role.dto.js';
import { RealmGuard } from '../common/guards/realm.guard.js';
import { CurrentRealm } from '../common/decorators/current-realm.decorator.js';

@ApiTags('Roles')
@Controller('admin/realms/:realmName')
@UseGuards(RealmGuard)
@ApiSecurity('admin-api-key')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  // ─── Realm Roles ────────────────────────────────────────

  @Post('roles')
  @ApiOperation({ summary: 'Create a realm role' })
  @ApiResponse({ status: 201, description: 'Realm role created' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  createRealmRole(@CurrentRealm() realm: Realm, @Body() dto: CreateRoleDto) {
    return this.rolesService.createRealmRole(realm, dto.name, dto.description);
  }

  @Get('roles')
  @ApiOperation({ summary: 'List realm roles' })
  @ApiResponse({ status: 200, description: 'List of realm roles' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  findRealmRoles(@CurrentRealm() realm: Realm) {
    return this.rolesService.findRealmRoles(realm);
  }

  @Get('roles/:roleName')
  @ApiOperation({ summary: 'Get a realm role by name' })
  @ApiResponse({ status: 200, description: 'Realm role details' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  findRealmRole(
    @CurrentRealm() realm: Realm,
    @Param('roleName') roleName: string,
  ) {
    return this.rolesService.findByName(realm, roleName);
  }

  @Put('roles/:roleName')
  @ApiOperation({ summary: 'Update a realm role (full replace)' })
  @ApiResponse({ status: 200, description: 'Realm role updated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  @ApiResponse({ status: 409, description: 'Role name conflict' })
  updateRealmRole(
    @CurrentRealm() realm: Realm,
    @Param('roleName') roleName: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.rolesService.updateRealmRole(realm, roleName, dto);
  }

  @Patch('roles/:roleName')
  @ApiOperation({ summary: 'Partially update a realm role' })
  @ApiResponse({ status: 200, description: 'Realm role updated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  @ApiResponse({ status: 409, description: 'Role name conflict' })
  patchRealmRole(
    @CurrentRealm() realm: Realm,
    @Param('roleName') roleName: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.rolesService.updateRealmRole(realm, roleName, dto);
  }

  @Delete('roles/:roleName')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a realm role' })
  @ApiResponse({ status: 204, description: 'Realm role deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  deleteRealmRole(
    @CurrentRealm() realm: Realm,
    @Param('roleName') roleName: string,
  ) {
    return this.rolesService.deleteRealmRole(realm, roleName);
  }

  // ─── Client Roles ──────────────────────────────────────

  @Post('clients/:clientId/roles')
  @ApiOperation({ summary: 'Create a client role' })
  @ApiResponse({ status: 201, description: 'Client role created' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Client not found' })
  createClientRole(
    @CurrentRealm() realm: Realm,
    @Param('clientId') clientId: string,
    @Body() dto: CreateRoleDto,
  ) {
    return this.rolesService.createClientRole(
      realm,
      clientId,
      dto.name,
      dto.description,
    );
  }

  @Get('clients/:clientId/roles')
  @ApiOperation({ summary: 'List client roles' })
  @ApiResponse({ status: 200, description: 'List of client roles' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Client not found' })
  findClientRoles(
    @CurrentRealm() realm: Realm,
    @Param('clientId') clientId: string,
  ) {
    return this.rolesService.findClientRoles(realm, clientId);
  }

  // ─── User Realm Role Assignment ─────────────────────────

  @Post('users/:userId/role-mappings/realm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Assign realm roles to a user' })
  @ApiResponse({ status: 200, description: 'Realm roles assigned' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'User or role not found' })
  assignRealmRoles(
    @CurrentRealm() realm: Realm,
    @Param('userId') userId: string,
    @Body() dto: AssignRolesDto,
  ) {
    return this.rolesService.assignRealmRoles(realm, userId, dto.roleNames);
  }

  @Get('users/:userId/role-mappings/realm')
  @ApiOperation({ summary: "List a user's realm roles" })
  @ApiResponse({ status: 200, description: "List of user's realm roles" })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'User not found' })
  getUserRealmRoles(
    @CurrentRealm() realm: Realm,
    @Param('userId') userId: string,
  ) {
    return this.rolesService.getUserRealmRoles(realm, userId);
  }

  @Delete('users/:userId/role-mappings/realm')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove realm roles from a user' })
  @ApiResponse({ status: 204, description: 'Realm roles removed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'User or role not found' })
  removeUserRealmRoles(
    @CurrentRealm() realm: Realm,
    @Param('userId') userId: string,
    @Body() dto: AssignRolesDto,
  ) {
    return this.rolesService.removeUserRealmRoles(realm, userId, dto.roleNames);
  }

  // ─── User Client Role Assignment ────────────────────────

  @Post('users/:userId/role-mappings/clients/:clientId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Assign client roles to a user' })
  @ApiResponse({ status: 200, description: 'Client roles assigned' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'User, client, or role not found' })
  assignClientRoles(
    @CurrentRealm() realm: Realm,
    @Param('userId') userId: string,
    @Param('clientId') clientId: string,
    @Body() dto: AssignRolesDto,
  ) {
    return this.rolesService.assignClientRoles(
      realm,
      userId,
      clientId,
      dto.roleNames,
    );
  }

  @Get('users/:userId/role-mappings/clients/:clientId')
  @ApiOperation({ summary: "List a user's client roles" })
  @ApiResponse({ status: 200, description: "List of user's client roles" })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'User or client not found' })
  getUserClientRoles(
    @CurrentRealm() realm: Realm,
    @Param('userId') userId: string,
    @Param('clientId') clientId: string,
  ) {
    return this.rolesService.getUserClientRoles(realm, userId, clientId);
  }

  @Delete('users/:userId/role-mappings/clients/:clientId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove client roles from a user' })
  @ApiResponse({ status: 204, description: 'Client roles removed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'User, client, or role not found' })
  removeUserClientRoles(
    @CurrentRealm() realm: Realm,
    @Param('userId') userId: string,
    @Param('clientId') clientId: string,
    @Body() dto: AssignRolesDto,
  ) {
    return this.rolesService.removeUserClientRoles(
      realm,
      userId,
      clientId,
      dto.roleNames,
    );
  }
}
