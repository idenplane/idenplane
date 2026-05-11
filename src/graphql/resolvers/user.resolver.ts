import { Resolver, Query, Args, Int, Context } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { User } from '../types/user.type.js';
import { UsersService } from '../../users/users.service.js';
import { GraphQLAuthGuard } from '../guards/graphql-auth.guard.js';
import { PaginationInfo } from '../types/pagination.type.js';
import { UserFilterInput } from '../inputs/user.input.js';
import type { Request } from 'express';

@Resolver(() => User)
@UseGuards(GraphQLAuthGuard)
export class UserResolver {
  constructor(private readonly usersService: UsersService) {}

  @Query(() => [User])
  async users(
    @Args('realmId') realmId: string,
    @Args('skip', { type: () => Int, defaultValue: 0 }) skip: number,
    @Args('take', { type: () => Int, defaultValue: 10 }) take: number,
    @Args('filter', { nullable: true }) filter?: UserFilterInput,
  ): Promise<{ items: User[]; pagination: PaginationInfo }> {
    const realm = { id: realmId, name: '' } as any;
    const result = await this.usersService.findAll(
      realm,
      skip,
      take,
      filter ? {
        search: filter.search,
        username: filter.username,
        email: filter.email,
        firstName: filter.firstName,
        lastName: filter.lastName,
      } : undefined,
    );
    return {
      items: result.users,
      pagination: {
        total: result.total,
        page: Math.floor(skip / take) + 1,
        pageSize: take,
        totalPages: Math.ceil(result.total / take),
        hasNext: skip + take < result.total,
        hasPrevious: skip > 0,
      },
    };
  }

  @Query(() => User, { nullable: true })
  async user(
    @Args('realmId') realmId: string,
    @Args('userId') userId: string,
  ): Promise<User | null> {
    try {
      const realm = { id: realmId, name: '' } as any;
      return await this.usersService.findById(realm, userId);
    } catch {
      return null;
    }
  }
}