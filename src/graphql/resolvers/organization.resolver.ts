import { Resolver, Query, Args, Int } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { Organization } from '../types/organization.type.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { GraphQLAuthGuard } from '../guards/graphql-auth.guard.js';
import { PaginationInfo } from '../types/pagination.type.js';

@Resolver(() => Organization)
@UseGuards(GraphQLAuthGuard)
export class OrganizationResolver {
  constructor(private readonly prisma: PrismaService) {}

  @Query(() => [Organization])
  async organizations(
    @Args('realmId') realmId: string,
    @Args('skip', { type: () => Int, defaultValue: 0 }) skip: number,
    @Args('take', { type: () => Int, defaultValue: 10 }) take: number,
  ): Promise<{ items: Organization[]; pagination: PaginationInfo }> {
    const where = { realmId };
    const [items, total] = await Promise.all([
      this.prisma.organization.findMany({
        where,
        orderBy: { name: 'asc' },
        skip,
        take,
      }),
      this.prisma.organization.count({ where }),
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

  @Query(() => Organization, { nullable: true })
  async organization(
    @Args('realmId') realmId: string,
    @Args('id') id: string,
  ): Promise<Organization | null> {
    const org = await this.prisma.organization.findFirst({
      where: { id, realmId },
    });
    return org;
  }
}