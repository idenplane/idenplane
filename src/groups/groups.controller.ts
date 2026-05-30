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
import { GroupsService } from './groups.service.js';
import { CreateGroupDto } from './dto/create-group.dto.js';
import { UpdateGroupDto } from './dto/update-group.dto.js';
import { AssignRolesDto } from '../roles/dto/assign-role.dto.js';
import { RealmGuard } from '../common/guards/realm.guard.js';
import { AdminApiKeyGuard } from '../common/guards/admin-api-key.guard.js';
import { CurrentRealm } from '../common/decorators/current-realm.decorator.js';
import {
  RateLimitGuard,
  RateLimitByIp,
} from '../rate-limit/rate-limit.guard.js';

@ApiTags('Groups')
@Controller('admin/realms/:realmName')
@UseGuards(RealmGuard, AdminApiKeyGuard, RateLimitGuard)
@RateLimitByIp()
@ApiSecurity('admin-api-key')
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  // ─── Group CRUD ──────────────────────────────

  @Post('groups')
  @ApiOperation({ summary: 'Create a group' })
  @ApiResponse({ status: 201, description: 'Group created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  create(@CurrentRealm() realm: Realm, @Body() dto: CreateGroupDto) {
    return this.groupsService.create(realm, dto);
  }

  @Get('groups')
  @ApiOperation({ summary: 'List all groups' })
  @ApiResponse({ status: 200, description: 'List of groups' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  findAll(@CurrentRealm() realm: Realm) {
    return this.groupsService.findAll(realm);
  }

  @Get('groups/:groupId')
  @ApiOperation({ summary: 'Get group by ID' })
  @ApiResponse({ status: 200, description: 'Group details' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Group not found' })
  findById(@CurrentRealm() realm: Realm, @Param('groupId') groupId: string) {
    return this.groupsService.findById(realm, groupId);
  }

  @Put('groups/:groupId')
  @ApiOperation({ summary: 'Update a group' })
  @ApiResponse({ status: 200, description: 'Group updated successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Group not found' })
  update(
    @CurrentRealm() realm: Realm,
    @Param('groupId') groupId: string,
    @Body() dto: UpdateGroupDto,
  ) {
    return this.groupsService.update(realm, groupId, dto);
  }

  @Delete('groups/:groupId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a group' })
  @ApiResponse({ status: 204, description: 'Group deleted successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Group not found' })
  delete(@CurrentRealm() realm: Realm, @Param('groupId') groupId: string) {
    return this.groupsService.delete(realm, groupId);
  }

  // ─── Group Members ───────────────────────────

  @Get('groups/:groupId/members')
  @ApiOperation({ summary: 'List group members' })
  @ApiResponse({ status: 200, description: 'List of group members' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Group not found' })
  getMembers(@CurrentRealm() realm: Realm, @Param('groupId') groupId: string) {
    return this.groupsService.getMembers(realm, groupId);
  }

  @Post('users/:userId/groups/:groupId')
  @ApiOperation({ summary: 'Add user to group (POST)' })
  @ApiResponse({ status: 200, description: 'User added to group' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'User or group not found' })
  addUserToGroupPost(
    @CurrentRealm() realm: Realm,
    @Param('userId') userId: string,
    @Param('groupId') groupId: string,
  ) {
    return this.groupsService.addUserToGroup(realm, userId, groupId);
  }

  @Put('users/:userId/groups/:groupId')
  @ApiOperation({ summary: 'Add user to group (PUT)' })
  @ApiResponse({ status: 200, description: 'User added to group' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'User or group not found' })
  addUserToGroupPut(
    @CurrentRealm() realm: Realm,
    @Param('userId') userId: string,
    @Param('groupId') groupId: string,
  ) {
    return this.groupsService.addUserToGroup(realm, userId, groupId);
  }

  @Delete('users/:userId/groups/:groupId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove user from group' })
  @ApiResponse({ status: 204, description: 'User removed from group' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'User or group not found' })
  removeUserFromGroup(
    @CurrentRealm() realm: Realm,
    @Param('userId') userId: string,
    @Param('groupId') groupId: string,
  ) {
    return this.groupsService.removeUserFromGroup(realm, userId, groupId);
  }

  @Get('users/:userId/groups')
  @ApiOperation({ summary: "List user's groups" })
  @ApiResponse({ status: 200, description: "List of user's groups" })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'User not found' })
  getUserGroups(@CurrentRealm() realm: Realm, @Param('userId') userId: string) {
    return this.groupsService.getUserGroups(realm, userId);
  }

  // ─── Group Role Mappings ─────────────────────

  @Get('groups/:groupId/role-mappings')
  @ApiOperation({ summary: 'Get group role mappings' })
  @ApiResponse({ status: 200, description: 'Group role mappings' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Group not found' })
  getGroupRoles(
    @CurrentRealm() realm: Realm,
    @Param('groupId') groupId: string,
  ) {
    return this.groupsService.getGroupRoles(realm, groupId);
  }

  @Post('groups/:groupId/role-mappings')
  @ApiOperation({ summary: 'Assign roles to group' })
  @ApiResponse({ status: 201, description: 'Roles assigned to group' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Group or role not found' })
  assignRoles(
    @CurrentRealm() realm: Realm,
    @Param('groupId') groupId: string,
    @Body() dto: AssignRolesDto,
  ) {
    return this.groupsService.assignRolesToGroup(realm, groupId, dto.roleNames);
  }

  @Delete('groups/:groupId/role-mappings')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove roles from group' })
  @ApiResponse({ status: 204, description: 'Roles removed from group' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Group or role not found' })
  removeRoles(
    @CurrentRealm() realm: Realm,
    @Param('groupId') groupId: string,
    @Body() dto: AssignRolesDto,
  ) {
    return this.groupsService.removeRolesFromGroup(
      realm,
      groupId,
      dto.roleNames,
    );
  }
}
