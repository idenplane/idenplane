import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Realm } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  CreateAuditStreamDto,
  UpdateAuditStreamDto,
} from './dto/audit-stream.dto.js';
import * as dgram from 'node:dgram';
import * as net from 'node:net';

@Injectable()
export class AuditStreamsService {
  private readonly logger = new Logger(AuditStreamsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── CRUD ──────────────────────────────────────────────

  async create(realm: Realm, dto: CreateAuditStreamDto) {
    return this.prisma.auditLogStream.create({
      data: {
        realmId: realm.id,
        name: dto.name,
        streamType: dto.streamType,
        enabled: dto.enabled ?? true,
        url: dto.url,
        httpHeaders: (dto.httpHeaders as Record<string, string>) ?? undefined,
        syslogHost: dto.syslogHost,
        syslogPort: dto.syslogPort,
        syslogProtocol: dto.syslogProtocol ?? 'udp',
        syslogFacility: dto.syslogFacility ?? 16,
      },
    });
  }

  async findAll(realm: Realm) {
    return this.prisma.auditLogStream.findMany({
      where: { realmId: realm.id },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findOne(realm: Realm, id: string) {
    const stream = await this.prisma.auditLogStream.findFirst({
      where: { id, realmId: realm.id },
    });
    if (!stream) {
      throw new NotFoundException(`Audit log stream '${id}' not found`);
    }
    return stream;
  }

  async update(realm: Realm, id: string, dto: UpdateAuditStreamDto) {
    await this.findOne(realm, id);
    return this.prisma.auditLogStream.update({
      where: { id },
      data: {
        name: dto.name,
        enabled: dto.enabled,
        url: dto.url,
        httpHeaders: (dto.httpHeaders as Record<string, string>) ?? undefined,
        syslogHost: dto.syslogHost,
        syslogPort: dto.syslogPort,
        syslogProtocol: dto.syslogProtocol,
        syslogFacility: dto.syslogFacility,
      },
    });
  }

  async remove(realm: Realm, id: string) {
    await this.findOne(realm, id);
    await this.prisma.auditLogStream.delete({ where: { id } });
  }

  // ─── Dispatch ──────────────────────────────────────────

  /**
   * Dispatch an event to all enabled streams for this realm.
   * Non-blocking; errors are logged and swallowed.
   */
  dispatchToStreams(
    realmId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): void {
    setImmediate(() => {
      this.doDispatch(realmId, eventType, payload).catch((err) => {
        this.logger.warn(
          `Stream dispatch error for realm=${realmId}: ${(err as Error).message}`,
        );
      });
    });
  }

  private async doDispatch(
    realmId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const streams = await this.prisma.auditLogStream.findMany({
      where: { realmId, enabled: true },
    });

    if (streams.length === 0) return;

    const message = JSON.stringify({
      eventType,
      timestamp: new Date().toISOString(),
      realmId,
      ...payload,
    });

    await Promise.allSettled(
      streams.map((stream) => {
        if (stream.streamType === 'http') {
          return this.deliverHttp(stream, message);
        }
        if (stream.streamType === 'syslog') {
          return this.deliverSyslog(stream, message);
        }
        return Promise.resolve();
      }),
    );
  }

  // ─── HTTP delivery ────────────────────────────────────

  private async deliverHttp(
    stream: {
      id: string;
      url: string | null;
      httpHeaders: unknown;
    },
    body: string,
  ): Promise<void> {
    if (!stream.url) {
      this.logger.warn(`HTTP stream ${stream.id} has no URL configured`);
      return;
    }

    const extraHeaders: Record<string, string> =
      stream.httpHeaders && typeof stream.httpHeaders === 'object'
        ? (stream.httpHeaders as Record<string, string>)
        : {};

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      await fetch(stream.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Idenplane-AuditStream/1.0',
          ...extraHeaders,
        },
        body,
        signal: controller.signal,
      });
    } catch (err) {
      this.logger.warn(
        `HTTP stream ${stream.id} delivery failed: ${(err as Error).message}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  // ─── Syslog delivery ──────────────────────────────────

  /**
   * Sends a syslog-formatted message (RFC 3164 / BSD-style) over UDP or TCP.
   * Priority = facility * 8 + severity (6 = informational).
   */
  private deliverSyslog(
    stream: {
      id: string;
      syslogHost: string | null;
      syslogPort: number | null;
      syslogProtocol: string;
      syslogFacility: number;
    },
    message: string,
  ): Promise<void> {
    const host = stream.syslogHost ?? 'localhost';
    const port = stream.syslogPort ?? 514;
    const facility = stream.syslogFacility ?? 16;
    const severity = 6; // informational
    const priority = facility * 8 + severity;

    const ts = new Date().toLocaleString('en-US', {
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

    const packet = `<${priority}>${ts} idenplane audit: ${message}`;
    const buf = Buffer.from(packet, 'utf8');

    if (stream.syslogProtocol === 'tcp') {
      return this.deliverSyslogTcp(stream.id, host, port, buf);
    }
    return this.deliverSyslogUdp(stream.id, host, port, buf);
  }

  private deliverSyslogUdp(
    streamId: string,
    host: string,
    port: number,
    buf: Buffer,
  ): Promise<void> {
    return new Promise((resolve) => {
      const client = dgram.createSocket('udp4');
      client.send(buf, port, host, (err) => {
        client.close();
        if (err) {
          this.logger.warn(
            `Syslog UDP stream ${streamId} delivery failed: ${err.message}`,
          );
        }
        resolve();
      });
    });
  }

  private deliverSyslogTcp(
    streamId: string,
    host: string,
    port: number,
    buf: Buffer,
  ): Promise<void> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      const timer = setTimeout(() => {
        socket.destroy();
        this.logger.warn(`Syslog TCP stream ${streamId} timed out`);
        resolve();
      }, 5_000);

      socket.connect(port, host, () => {
        socket.write(buf, () => {
          clearTimeout(timer);
          socket.destroy();
          resolve();
        });
      });

      socket.on('error', (err) => {
        clearTimeout(timer);
        this.logger.warn(
          `Syslog TCP stream ${streamId} delivery failed: ${err.message}`,
        );
        resolve();
      });
    });
  }
}
