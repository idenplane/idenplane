import { Resolver, Query, Args, Int, Context } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { Client } from '../types/client.type.js';
import { ClientsService } from '../../clients/clients.service.js';
import { GraphQLAuthGuard } from '../guards/graphql-auth.guard.js';
import { PaginationInfo } from '../types/pagination.type.js';
import type { Request } from 'express';

@Resolver(() => Client)
@UseGuards(GraphQLAuthGuard)
export class ClientResolver {
  constructor(private readonly clientsService: ClientsService) {}

  private getRealmId(context: any): string | null {
    const req = context.req as Request;
    return (req.headers['x-realm-id'] as string) || null;
  }

  @Query(() => [Client])
  async clients(
    @Context() context: any,
    @Args('realmId') realmId: string,
  ): Promise<Client[]> {
    const realm = { id: realmId, name: '' } as any; // eslint-disable-line @typescript-eslint/no-unsafe-assignment
    return this.clientsService.findAll(realm);
  }

  @Query(() => Client, { nullable: true })
  async client(
    @Context() context: any,
    @Args('realmId') realmId: string,
    @Args('clientId') clientId: string,
  ): Promise<Client | null> {
    try {
      const realm = { id: realmId, name: '' } as any; // eslint-disable-line @typescript-eslint/no-unsafe-assignment
      return await this.clientsService.findByClientId(realm, clientId);
    } catch {
      return null;
    }
  }

  @Query(() => [Client])
  async clientsPaginated(
    @Context() context: any,
    @Args('realmId') realmId: string,
    @Args('skip', { type: () => Int, defaultValue: 0 }) skip: number,
    @Args('take', { type: () => Int, defaultValue: 10 }) take: number,
  ): Promise<{ items: Client[]; pagination: PaginationInfo }> {
    const realm = { id: realmId, name: '' } as any; // eslint-disable-line @typescript-eslint/no-unsafe-assignment
    const items = await this.clientsService.findAll(realm);
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
