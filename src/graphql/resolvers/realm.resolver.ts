import { Resolver, Query, Args, Int } from '@nestjs/graphql';
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
  realms(): Promise<Realm[]> {
    /* eslint-disable @typescript-eslint/no-unsafe-return */
    return this.realmsService.findAll() as any;
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
    /* eslint-disable @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-member-access,@typescript-eslint/no-unsafe-call */
    const items = (await this.realmsService.findAll()) as any;
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
