import { Resolver, Query, Args, Int } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { Group } from '../types/group.type.js';
import { GroupsService } from '../../groups/groups.service.js';
import { GraphQLAuthGuard } from '../guards/graphql-auth.guard.js';
import { PaginationInfo } from '../types/pagination.type.js';

@Resolver(() => Group)
@UseGuards(GraphQLAuthGuard)
export class GroupResolver {
  constructor(private readonly groupsService: GroupsService) {}

  @Query(() => [Group])
  async groups(
    @Args('realmId') realmId: string,
    @Args('skip', { type: () => Int, defaultValue: 0 }) skip: number,
    @Args('take', { type: () => Int, defaultValue: 10 }) take: number,
  ): Promise<{ items: Group[]; pagination: PaginationInfo }> {
    const realm = { id: realmId, name: '' } as any;
    const items = await this.groupsService.findAll(realm);
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

  @Query(() => Group, { nullable: true })
  async group(
    @Args('realmId') realmId: string,
    @Args('groupId') groupId: string,
  ): Promise<Group | null> {
    try {
      const realm = { id: realmId, name: '' } as any;
      return await this.groupsService.findById(realm, groupId);
    } catch {
      return null;
    }
  }

  @Query(() => [Group])
  async groupsByUser(
    @Args('realmId') realmId: string,
    @Args('userId') userId: string,
  ): Promise<Group[]> {
    const realm = { id: realmId, name: '' } as any;
    return this.groupsService.getUserGroups(realm, userId);
  }
}