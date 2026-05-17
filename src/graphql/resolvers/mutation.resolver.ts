import { Resolver, Mutation, Args } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { User } from '../types/user.type.js';
import { Client } from '../types/client.type.js';
import { Role } from '../types/role.type.js';
import { Group } from '../types/group.type.js';
import { Organization } from '../types/organization.type.js';
import { UsersService } from '../../users/users.service.js';
import { ClientsService } from '../../clients/clients.service.js';
import { RolesService } from '../../roles/roles.service.js';
import { GroupsService } from '../../groups/groups.service.js';
import { OrganizationsService } from '../../organizations/organizations.service.js';
import { GraphQLAuthGuard } from '../guards/graphql-auth.guard.js';
import { CreateUserInput, UpdateUserInput } from '../inputs/user.input.js';
import {
  CreateClientInput,
  UpdateClientInput,
} from '../inputs/client.input.js';
import { CreateRoleInput, UpdateRoleInput } from '../inputs/role.input.js';
import { CreateGroupInput, UpdateGroupInput } from '../inputs/group.input.js';
import {
  CreateOrganizationInput,
  UpdateOrganizationInput,
} from '../inputs/organization.input.js';

@Resolver()
@UseGuards(GraphQLAuthGuard)
export class MutationResolver {
  constructor(
    private readonly usersService: UsersService,
    private readonly clientsService: ClientsService,
    private readonly rolesService: RolesService,
    private readonly groupsService: GroupsService,
    private readonly organizationsService: OrganizationsService,
  ) {}

  // ─── User Mutations ────────────────────────────────────────

  @Mutation(() => User)
  async createUser(@Args('input') input: CreateUserInput): Promise<User> {
    const realm = { id: input.realmId, name: '' } as any; // eslint-disable-line @typescript-eslint/no-unsafe-assignment
    const dto = {
      username: input.username,
      email: input.email,
      password: input.password,
      firstName: input.firstName,
      lastName: input.lastName,
      enabled: input.enabled,
    };
    return this.usersService.create(realm, dto);
  }

  @Mutation(() => User)
  async updateUser(
    @Args('realmId') realmId: string,
    @Args('userId') userId: string,
    @Args('input') input: UpdateUserInput,
  ): Promise<User> {
    const realm = { id: realmId, name: '' } as any; // eslint-disable-line @typescript-eslint/no-unsafe-assignment
    const dto = {
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      enabled: input.enabled,
      emailVerified: input.emailVerified,
    };
    return this.usersService.update(realm, userId, dto);
  }

  @Mutation(() => Boolean)
  async deleteUser(
    @Args('realmId') realmId: string,
    @Args('userId') userId: string,
  ): Promise<boolean> {
    const realm = { id: realmId, name: '' } as any; // eslint-disable-line @typescript-eslint/no-unsafe-assignment
    await this.usersService.remove(realm, userId);
    return true;
  }

  @Mutation(() => User)
  async setUserPassword(
    @Args('realmId') realmId: string,
    @Args('userId') userId: string,
    @Args('password') password: string,
  ): Promise<User> {
    const realm = { id: realmId, name: '' } as any; // eslint-disable-line @typescript-eslint/no-unsafe-assignment
    await this.usersService.setPassword(realm, userId, password);
    return this.usersService.findById(realm, userId);
  }

  // ─── Client Mutations ──────────────────────────────────────

  @Mutation(() => Client)
  async createClient(@Args('input') input: CreateClientInput): Promise<Client> {
    const realm = { id: input.realmId, name: '' } as any; // eslint-disable-line @typescript-eslint/no-unsafe-assignment
    const dto = {
      clientId: input.clientId,
      name: input.name,
      description: input.description,
      enabled: input.enabled,
      redirectUris: input.redirectUris,
      webOrigins: input.webOrigins,
      grantTypes: input.grantTypes,
      requireConsent: input.requireConsent,
      clientType: input.clientType,
      backchannelLogoutUri: input.backchannelLogoutUri,
      backchannelLogoutSessionRequired: input.backchannelLogoutSessionRequired,
    };
    return this.clientsService.create(realm, dto);
  }

  @Mutation(() => Client)
  async updateClient(
    @Args('realmId') realmId: string,
    @Args('clientId') clientId: string,
    @Args('input') input: UpdateClientInput,
  ): Promise<Client> {
    const realm = { id: realmId, name: '' } as any;
    const dto = {
      name: input.name,
      description: input.description,
      enabled: input.enabled,
      redirectUris: input.redirectUris,
      webOrigins: input.webOrigins,
      grantTypes: input.grantTypes,
      requireConsent: input.requireConsent,
      clientType: input.clientType,
      backchannelLogoutUri: input.backchannelLogoutUri,
      backchannelLogoutSessionRequired: input.backchannelLogoutSessionRequired,
    };
    return this.clientsService.update(realm, clientId, dto);
  }

  @Mutation(() => Boolean)
  async deleteClient(
    @Args('realmId') realmId: string,
    @Args('clientId') clientId: string,
  ): Promise<boolean> {
    const realm = { id: realmId, name: '' } as any; // eslint-disable-line @typescript-eslint/no-unsafe-assignment
    await this.clientsService.remove(realm, clientId);
    return true;
  }

  // ─── Role Mutations ────────────────────────────────────────

  @Mutation(() => Role)
  async createRole(@Args('input') input: CreateRoleInput): Promise<Role> {
    const realm = { id: input.realmId, name: '' } as any; // eslint-disable-line @typescript-eslint/no-unsafe-assignment
    return this.rolesService.createRealmRole(
      realm,
      input.name,
      input.description,
    );
  }

  @Mutation(() => Role)
  async updateRole(
    @Args('realmId') realmId: string,
    @Args('name') name: string,
    @Args('input') input: UpdateRoleInput,
  ): Promise<Role> {
    const realm = { id: realmId, name: '' } as any; // eslint-disable-line @typescript-eslint/no-unsafe-assignment
    return this.rolesService.updateRealmRole(realm, name, {
      name: input.name,
      description: input.description,
    });
  }

  @Mutation(() => Boolean)
  async deleteRole(
    @Args('realmId') realmId: string,
    @Args('name') name: string,
  ): Promise<boolean> {
    const realm = { id: realmId, name: '' } as any; // eslint-disable-line @typescript-eslint/no-unsafe-assignment
    await this.rolesService.deleteRealmRole(realm, name);
    return true;
  }

  @Mutation(() => [Role])
  async assignRolesToUser(
    @Args('realmId') realmId: string,
    @Args('userId') userId: string,
    @Args('roleNames', { type: () => [String] }) roleNames: string[],
  ): Promise<Role[]> {
    const realm = { id: realmId, name: '' } as any; // eslint-disable-line @typescript-eslint/no-unsafe-assignment
    const _result = await this.rolesService.assignRealmRoles(
      realm,
      userId,
      roleNames,
    );
    return this.rolesService.getUserRealmRoles(realm, userId);
  }

  @Mutation(() => [Role])
  async removeRolesFromUser(
    @Args('realmId') realmId: string,
    @Args('userId') userId: string,
    @Args('roleNames', { type: () => [String] }) roleNames: string[],
  ): Promise<Role[]> {
    const realm = { id: realmId, name: '' } as any; // eslint-disable-line @typescript-eslint/no-unsafe-assignment
    await this.rolesService.removeUserRealmRoles(realm, userId, roleNames);
    return this.rolesService.getUserRealmRoles(realm, userId);
  }

  // ─── Group Mutations ────────────────────────────────────────

  @Mutation(() => Group)
  async createGroup(@Args('input') input: CreateGroupInput): Promise<Group> {
    const realm = { id: input.realmId, name: '' } as any;
    const dto = {
      name: input.name,
      description: input.description,
      parentId: input.parentId,
    };
    return this.groupsService.create(realm, dto);
  }

  @Mutation(() => Group)
  async updateGroup(
    @Args('realmId') realmId: string,
    @Args('groupId') groupId: string,
    @Args('input') input: UpdateGroupInput,
  ): Promise<Group> {
    const realm = { id: realmId, name: '' } as any;
    const dto = {
      name: input.name,
      description: input.description,
      parentId: input.parentId,
    };
    return this.groupsService.update(realm, groupId, dto);
  }

  @Mutation(() => Boolean)
  async deleteGroup(
    @Args('realmId') realmId: string,
    @Args('groupId') groupId: string,
  ): Promise<boolean> {
    const realm = { id: realmId, name: '' } as any; // eslint-disable-line @typescript-eslint/no-unsafe-assignment
    await this.groupsService.delete(realm, groupId);
    return true;
  }

  @Mutation(() => Group)
  async addUserToGroup(
    @Args('realmId') realmId: string,
    @Args('userId') userId: string,
    @Args('groupId') groupId: string,
  ): Promise<Group> {
    const realm = { id: realmId, name: '' } as any; // eslint-disable-line @typescript-eslint/no-unsafe-assignment
    await this.groupsService.addUserToGroup(realm, userId, groupId);
    return this.groupsService.findById(realm, groupId);
  }

  @Mutation(() => Boolean)
  async removeUserFromGroup(
    @Args('realmId') realmId: string,
    @Args('userId') userId: string,
    @Args('groupId') groupId: string,
  ): Promise<boolean> {
    const realm = { id: realmId, name: '' } as any; // eslint-disable-line @typescript-eslint/no-unsafe-assignment
    await this.groupsService.removeUserFromGroup(realm, userId, groupId);
    return true;
  }

  // ─── Organization Mutations ────────────────────────────────

  @Mutation(() => Organization)
  async createOrganization(
    @Args('input') input: CreateOrganizationInput,
  ): Promise<Organization> {
    const realm = { id: input.realmId, name: '' } as any;
    const dto = {
      name: input.name,
      slug: input.slug,
      displayName: input.displayName,
      description: input.description,
      enabled: input.enabled,
      logoUrl: input.logoUrl,
      primaryColor: input.primaryColor,
      requireMfa: input.requireMfa,
    };
    return this.organizationsService.create(realm, dto);
  }

  @Mutation(() => Organization)
  async updateOrganization(
    @Args('realmId') realmId: string,
    @Args('slug') slug: string,
    @Args('input') input: UpdateOrganizationInput,
  ): Promise<Organization> {
    const realm = { id: realmId, name: '' } as any; // eslint-disable-line @typescript-eslint/no-unsafe-assignment
    const dto = {
      name: input.displayName,
      displayName: input.displayName,
      description: input.description,
      enabled: input.enabled,
      logoUrl: input.logoUrl,
      primaryColor: input.primaryColor,
      requireMfa: input.requireMfa,
    };
    return this.organizationsService.update(realm, slug, dto);
  }

  @Mutation(() => Boolean)
  async deleteOrganization(
    @Args('realmId') realmId: string,
    @Args('slug') slug: string,
  ): Promise<boolean> {
    const realm = { id: realmId, name: '' } as any; // eslint-disable-line @typescript-eslint/no-unsafe-assignment
    await this.organizationsService.remove(realm, slug);
    return true;
  }

  @Mutation(() => Organization)
  async addMemberToOrganization(
    @Args('realmId') realmId: string,
    @Args('slug') slug: string,
    @Args('userId') userId: string,
    @Args('role', { defaultValue: 'member' }) role: string,
  ): Promise<Organization> {
    const realm = { id: realmId, name: '' } as any; // eslint-disable-line @typescript-eslint/no-unsafe-assignment
    await this.organizationsService.addMember(realm, slug, { userId, role });
    return this.organizationsService.findOne(realm, slug);
  }
}
