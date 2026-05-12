import { Injectable } from '@nestjs/common';
import { Response } from 'express';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export interface ExportLoginEventsParams {
  realmId: string;
  format: 'json' | 'csv';
  dateFrom?: Date;
  dateTo?: Date;
  eventType?: string;
  userId?: string;
  clientId?: string;
  ipAddress?: string;
  offset: number;
  limit: number;
}

export interface ExportAdminEventsParams {
  realmId: string;
  format: 'json' | 'csv';
  dateFrom?: Date;
  dateTo?: Date;
  eventType?: string; // maps to operationType
  userId?: string; // maps to adminUserId
  clientId?: string; // not applicable but accepted for API consistency
  ipAddress?: string;
  offset: number;
  limit: number;
}

// CSV helpers

function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = typeof value === 'object' ? JSON.stringify(value) : String(value);
  // Wrap in quotes if it contains a comma, quote, or newline
  if (
    str.includes(',') ||
    str.includes('"') ||
    str.includes('\n') ||
    str.includes('\r')
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildCsvRow(fields: unknown[]): string {
  return fields.map(escapeCsvField).join(',');
}

const LOGIN_EVENT_CSV_HEADERS = [
  'id',
  'realmId',
  'type',
  'userId',
  'sessionId',
  'clientId',
  'ipAddress',
  'error',
  'details',
  'createdAt',
];

const ADMIN_EVENT_CSV_HEADERS = [
  'id',
  'realmId',
  'adminUserId',
  'operationType',
  'resourceType',
  'resourcePath',
  'ipAddress',
  'representation',
  'createdAt',
];

@Injectable()
export class AuditExportService {
  constructor(private readonly prisma: PrismaService) {}

  async exportLoginEvents(
    params: ExportLoginEventsParams,
    res: Response,
  ): Promise<void> {
    const where: Record<string, unknown> = { realmId: params.realmId };
    if (params.eventType) where['type'] = params.eventType;
    if (params.userId) where['userId'] = params.userId;
    if (params.clientId) where['clientId'] = params.clientId;
    if (params.ipAddress) where['ipAddress'] = params.ipAddress;
    if (params.dateFrom || params.dateTo) {
      const createdAt: Record<string, Date> = {};
      if (params.dateFrom) createdAt['gte'] = params.dateFrom;
      if (params.dateTo) createdAt['lte'] = params.dateTo;
      where['createdAt'] = createdAt;
    }

    const events = await this.prisma.loginEvent.findMany({
      where: where,
      orderBy: { createdAt: 'desc' },
      skip: params.offset,
      take: params.limit,
    });

    if (params.format === 'csv') {
      const filename = `login-events-${params.realmId}-${Date.now()}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${filename}"`,
      );

      res.write(LOGIN_EVENT_CSV_HEADERS.join(',') + '\n');
      for (const evt of events) {
        res.write(
          buildCsvRow([
            evt.id,
            evt.realmId,
            evt.type,
            evt.userId,
            evt.sessionId,
            evt.clientId,
            evt.ipAddress,
            evt.error,
            evt.details,
            evt.createdAt.toISOString(),
          ]) + '\n',
        );
      }
      res.end();
    } else {
      const filename = `login-events-${params.realmId}-${Date.now()}.json`;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${filename}"`,
      );
      res.json(events);
    }
  }

  async exportAdminEvents(
    params: ExportAdminEventsParams,
    res: Response,
  ): Promise<void> {
    const where: Record<string, unknown> = { realmId: params.realmId };
    if (params.eventType) where['operationType'] = params.eventType;
    if (params.userId) where['adminUserId'] = params.userId;
    if (params.ipAddress) where['ipAddress'] = params.ipAddress;
    if (params.dateFrom || params.dateTo) {
      const createdAt: Record<string, Date> = {};
      if (params.dateFrom) createdAt['gte'] = params.dateFrom;
      if (params.dateTo) createdAt['lte'] = params.dateTo;
      where['createdAt'] = createdAt;
    }

    const events = await this.prisma.adminEvent.findMany({
      where: where,
      orderBy: { createdAt: 'desc' },
      skip: params.offset,
      take: params.limit,
    });

    if (params.format === 'csv') {
      const filename = `admin-events-${params.realmId}-${Date.now()}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${filename}"`,
      );

      res.write(ADMIN_EVENT_CSV_HEADERS.join(',') + '\n');
      for (const evt of events) {
        res.write(
          buildCsvRow([
            evt.id,
            evt.realmId,
            evt.adminUserId,
            evt.operationType,
            evt.resourceType,
            evt.resourcePath,
            evt.ipAddress,
            evt.representation,
            evt.createdAt.toISOString(),
          ]) + '\n',
        );
      }
      res.end();
    } else {
      const filename = `admin-events-${params.realmId}-${Date.now()}.json`;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${filename}"`,
      );
      res.json(events);
    }
  }
}
