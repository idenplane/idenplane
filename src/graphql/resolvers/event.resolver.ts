import { Resolver, Query, Args, Int } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { LoginEvent, AdminEvent } from '../types/event.type.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { GraphQLAuthGuard } from '../guards/graphql-auth.guard.js';
import { PaginationInfo } from '../types/pagination.type.js';

@Resolver(() => LoginEvent)
@UseGuards(GraphQLAuthGuard)
export class EventResolver {
  constructor(private readonly prisma: PrismaService) {}

  @Query(() => [LoginEvent])
  async loginEvents(
    @Args('realmId') realmId: string,
    @Args('skip', { type: () => Int, defaultValue: 0 }) skip: number,
    @Args('take', { type: () => Int, defaultValue: 10 }) take: number,
  ): Promise<{ items: LoginEvent[]; pagination: PaginationInfo }> {
    const where = { realmId };
    const [items, total] = await Promise.all([
      this.prisma.loginEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.loginEvent.count({ where }),
    ]);
    return {
      items,
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

  @Query(() => [AdminEvent])
  async adminEvents(
    @Args('realmId') realmId: string,
    @Args('skip', { type: () => Int, defaultValue: 0 }) skip: number,
    @Args('take', { type: () => Int, defaultValue: 10 }) take: number,
  ): Promise<{ items: AdminEvent[]; pagination: PaginationInfo }> {
    const where = { realmId };
    const [items, total] = await Promise.all([
      this.prisma.adminEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.adminEvent.count({ where }),
    ]);
    return {
      items,
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