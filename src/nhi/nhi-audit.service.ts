import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export type NhiAuditAction =
  | 'PROVISIONED'
  | 'CREDENTIAL_ISSUED'
  | 'CREDENTIAL_ROTATED'
  | 'CREDENTIAL_REVOKED'
  | 'ACCESS_GRANTED'
  | 'ACCESS_DENIED'
  | 'SUSPENDED'
  | 'REACTIVATED'
  | 'DECOMMISSIONED'
  | 'UPDATED'
  | 'CERTIFICATE_SET'
  | 'POLICY_CREATED'
  | 'POLICY_UPDATED'
  | 'POLICY_DELETED';

export interface RecordNhiAuditParams {
  realmId: string;
  nhiIdentityId: string;
  action: NhiAuditAction;
  credentialId?: string;
  ipAddress?: string;
  userAgent?: string;
  success?: boolean;
  errorCode?: string;
  details?: Record<string, unknown>;
}

export interface QueryNhiAuditParams {
  realmId: string;
  nhiIdentityId?: string;
  action?: string;
  success?: boolean;
  dateFrom?: Date;
  dateTo?: Date;
  first?: number;
  max?: number;
}

@Injectable()
export class NhiAuditService {
  private readonly logger = new Logger(NhiAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async recordAudit(params: RecordNhiAuditParams): Promise<void> {
    try {
      await this.prisma.nhiAuditLog.create({
        data: {
          realmId: params.realmId,
          nhiIdentityId: params.nhiIdentityId,
          action: params.action,
          credentialId: params.credentialId,
          ipAddress: params.ipAddress,
          userAgent: params.userAgent,
          success: params.success ?? true,
          errorCode: params.errorCode,
          details:
            params.details !== undefined
              ? (params.details as unknown as Prisma.InputJsonValue)
              : undefined,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to record NHI audit log: ${(err as Error).message}`,
      );
    }
  }

  async queryAuditLogs(params: QueryNhiAuditParams) {
    const where: Record<string, unknown> = { realmId: params.realmId };
    if (params.nhiIdentityId) where['nhiIdentityId'] = params.nhiIdentityId;
    if (params.action) where['action'] = params.action;
    if (params.success !== undefined) where['success'] = params.success;
    if (params.dateFrom || params.dateTo) {
      const createdAt: Record<string, Date> = {};
      if (params.dateFrom) createdAt['gte'] = params.dateFrom;
      if (params.dateTo) createdAt['lte'] = params.dateTo;
      where['createdAt'] = createdAt;
    }

    return this.prisma.nhiAuditLog.findMany({
      where: where,
      orderBy: { createdAt: 'desc' },
      skip: params.first ?? 0,
      take: params.max ?? 100,
    });
  }

  async clearAuditLogs(realmId: string, nhiIdentityId?: string): Promise<void> {
    const where: { realmId: string; nhiIdentityId?: string } = { realmId };
    if (nhiIdentityId) where['nhiIdentityId'] = nhiIdentityId;
    await this.prisma.nhiAuditLog.deleteMany({ where });
  }
}
