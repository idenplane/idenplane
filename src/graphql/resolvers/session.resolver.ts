import { Resolver, Query, Args, Int } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { Session } from '../types/session.type.js';
import {
  SessionsService,
  SessionInfo,
} from '../../sessions/sessions.service.js';
import { GraphQLAuthGuard } from '../guards/graphql-auth.guard.js';
import { PaginationInfo } from '../types/pagination.type.js';

@Resolver(() => Session)
@UseGuards(GraphQLAuthGuard)
export class SessionResolver {
  constructor(private readonly sessionsService: SessionsService) {}

  private toSession(s: SessionInfo): Session {
    return {
      id: s.id,
      userId: s.userId,
      ipAddress: s.ipAddress ?? null,
      userAgent: s.userAgent ?? null,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
    };
  }

  @Query(() => [Session])
  async sessions(
    @Args('realmId') realmId: string,
    @Args('skip', { type: () => Int, defaultValue: 0 }) skip: number,
    @Args('take', { type: () => Int, defaultValue: 10 }) take: number,
  ): Promise<{ items: Session[]; pagination: PaginationInfo }> {
    const realm = { id: realmId, name: '' } as any;
    const allSessions = await this.sessionsService.getRealmSessions(realm);
    const items = allSessions
      .slice(skip, skip + take)
      .map((s) => this.toSession(s));
    const total = allSessions.length;
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

  @Query(() => [Session])
  async userSessions(
    @Args('realmId') realmId: string,
    @Args('userId') userId: string,
  ): Promise<Session[]> {
    const realm = { id: realmId, name: '' } as any;
    const sessions = await this.sessionsService.getUserSessions(realm, userId);
    return sessions.map((s) => this.toSession(s));
  }
}
