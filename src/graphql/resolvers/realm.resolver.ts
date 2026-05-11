import { Resolver, Query, Args, Int, Context } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { Realm } from '../types/realm.type.js';
import { RealmsService } from '../../realms/realms.service.js';
import { GraphQLAuthGuard } from '../guards/graphql-auth.guard.js';
import { PaginationInfo } from '../types/pagination.type.js';

@Resolver(() => Realm)
@UseGuards(GraphQLAuthGuard)
export class RealmResolver {
  constructor(private readonly realmsService: RealmsService) {}

  @Query(() => [Realm])
  async realms(): Promise<Realm[]> {
    return this.realmsService.findAll();
  }

  @Query(() => Realm, { nullable: true })
  async realm(@Args('name') name: string): Promise<Realm | null> {
    try {
      return await this.realmsService.findByName(name);
    } catch {
      return null;
    }
  }

  @Query(() => [Realm])
  async realmsPaginated(
    @Args('skip', { type: () => Int, defaultValue: 0 }) skip: number,
    @Args('take', { type: () => Int, defaultValue: 10 }) take: number,
  ): Promise<{ items: Realm[]; pagination: PaginationInfo }> {
    const items = await this.realmsService.findAll();
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
}