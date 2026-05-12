import { Resolver, Query, Args, Int } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { Role } from '../types/role.type.js';
import { RolesService } from '../../roles/roles.service.js';
import { GraphQLAuthGuard } from '../guards/graphql-auth.guard.js';
import { PaginationInfo } from '../types/pagination.type.js';

@Resolver(() => Role)
@UseGuards(GraphQLAuthGuard)
export class RoleResolver {
  constructor(private readonly rolesService: RolesService) {}

  @Query(() => [Role])
  async roles(
    @Args('realmId') realmId: string,
    @Args('skip', { type: () => Int, defaultValue: 0 }) skip: number,
    @Args('take', { type: () => Int, defaultValue: 10 }) take: number,
  ): Promise<{ items: Role[]; pagination: PaginationInfo }> {
    const realm = { id: realmId, name: '' } as any;
    const items = await this.rolesService.findRealmRoles(realm);
    const total = items.length;
    const paginatedItems = items.slice(skip, skip + take);
    return {
      items: paginatedItems,
      pagination: {
        total,
        page: Math.floor(skip / take) + 1,
        pageSize: take,
        totalPages: Math.ceil(total / take),
        hasNext: skip + take < total,
        hasPrevious: skip > 0,
      },
    };
  }

  @Query(() => Role, { nullable: true })
  async role(
    @Args('realmId') realmId: string,
    @Args('name') name: string,
  ): Promise<Role | null> {
    try {
      const realm = { id: realmId, name: '' } as any;
      return await this.rolesService.findByName(realm, name);
    } catch {
      return null;
    }
  }

  @Query(() => [Role])
  async clientRoles(
    @Args('realmId') realmId: string,
    @Args('clientId') clientId: string,
  ): Promise<Role[]> {
    const realm = { id: realmId, name: '' } as any;
    return this.rolesService.findClientRoles(realm, clientId);
  }
}
