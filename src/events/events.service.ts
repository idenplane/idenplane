import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  LoginEventTypeValue,
  OperationTypeValue,
  ResourceTypeValue,
} from './event-types.js';
import type { WebhooksService } from '../webhooks/webhooks.service.js';
import type { PluginManagerService } from '../plugins/plugin-manager.service.js';

export interface RecordLoginEventParams {
  realmId: string;
  userId?: string;
  sessionId?: string;
  type: LoginEventTypeValue;
  clientId?: string;
  ipAddress?: string;
  error?: string;
  details?: Record<string, unknown>;
}

export interface RecordAdminEventParams {
  realmId: string;
  adminUserId: string;
  operationType: OperationTypeValue;
  resourceType: ResourceTypeValue;
  resourcePath: string;
  representation?: Record<string, unknown>;
  ipAddress?: string;
}

export interface QueryEventsParams {
  realmId: string;
  type?: string;
  userId?: string;
  clientId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  first?: number;
  max?: number;
}

export interface QueryAdminEventsParams {
  realmId: string;
  operationType?: string;
  resourceType?: string;
  dateFrom?: Date;
  dateTo?: Date;
  first?: number;
  max?: number;
}

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly webhooksService?: WebhooksService,
    @Optional() private readonly pluginManager?: PluginManagerService,
  ) {}

  async recordLoginEvent(params: RecordLoginEventParams): Promise<void> {
    const realm = await this.prisma.realm.findUnique({
      where: { id: params.realmId },
      select: { eventsEnabled: true },
    });
    if (!realm?.eventsEnabled) return;

    try {
      await this.prisma.loginEvent.create({
        data: {
          realmId: params.realmId,
          userId: params.userId,
          sessionId: params.sessionId,
          type: params.type,
          clientId: params.clientId,
          ipAddress: params.ipAddress,
          error: params.error,
          details:
            params.details !== undefined
              ? (params.details as unknown as Prisma.InputJsonValue)
              : undefined,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to record login event: ${(err as Error).message}`,
      );
    }

    // Dispatch webhook event (non-blocking, best-effort)
    this.webhooksService?.dispatchEvent({
      realmId: params.realmId,
      eventType: `user.${params.type.toLowerCase()}`,
      payload: {
        userId: params.userId,
        sessionId: params.sessionId,
        clientId: params.clientId,
        ipAddress: params.ipAddress,
        error: params.error,
        details: params.details,
      },
    });

    // Dispatch to event-listener plugins (non-blocking, best-effort)
    this.pluginManager?.dispatchEvent({
      type: `user.${params.type.toLowerCase()}`,
      realmId: params.realmId,
      userId: params.userId,
      sessionId: params.sessionId,
      clientId: params.clientId,
      ipAddress: params.ipAddress,
      error: params.error,
      details: params.details,
    });
  }

  async recordAdminEvent(params: RecordAdminEventParams): Promise<void> {
    const realm = await this.prisma.realm.findUnique({
      where: { id: params.realmId },
      select: { adminEventsEnabled: true },
    });
    if (!realm?.adminEventsEnabled) return;

    try {
      await this.prisma.adminEvent.create({
        data: {
          realmId: params.realmId,
          adminUserId: params.adminUserId,
          operationType: params.operationType,
          resourceType: params.resourceType,
          resourcePath: params.resourcePath,
          representation:
            params.representation !== undefined
              ? (params.representation as unknown as Prisma.InputJsonValue)
              : undefined,
          ipAddress: params.ipAddress,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to record admin event: ${(err as Error).message}`,
      );
    }
  }

  async queryLoginEvents(params: QueryEventsParams) {
    const where: Record<string, unknown> = { realmId: params.realmId };
    if (params.type) where['type'] = params.type;
    if (params.userId) where['userId'] = params.userId;
    if (params.clientId) where['clientId'] = params.clientId;
    if (params.dateFrom || params.dateTo) {
      const createdAt: Record<string, Date> = {};
      if (params.dateFrom) createdAt['gte'] = params.dateFrom;
      if (params.dateTo) createdAt['lte'] = params.dateTo;
      where['createdAt'] = createdAt;
    }

    return this.prisma.loginEvent.findMany({
      where: where,
      orderBy: { createdAt: 'desc' },
      skip: params.first ?? 0,
      take: params.max ?? 100,
    });
  }

  async queryAdminEvents(params: QueryAdminEventsParams) {
    const where: Record<string, unknown> = { realmId: params.realmId };
    if (params.operationType) where['operationType'] = params.operationType;
    if (params.resourceType) where['resourceType'] = params.resourceType;
    if (params.dateFrom || params.dateTo) {
      const createdAt: Record<string, Date> = {};
      if (params.dateFrom) createdAt['gte'] = params.dateFrom;
      if (params.dateTo) createdAt['lte'] = params.dateTo;
      where['createdAt'] = createdAt;
    }

    return this.prisma.adminEvent.findMany({
      where: where,
      orderBy: { createdAt: 'desc' },
      skip: params.first ?? 0,
      take: params.max ?? 100,
    });
  }

  async clearLoginEvents(realmId: string): Promise<void> {
    await this.prisma.loginEvent.deleteMany({ where: { realmId } });
  }

  async clearAdminEvents(realmId: string): Promise<void> {
    await this.prisma.adminEvent.deleteMany({ where: { realmId } });
  }
}
