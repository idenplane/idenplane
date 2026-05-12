import { NotFoundException } from '@nestjs/common';
import { AuditStreamsService } from './audit-streams.service.js';
import {
  createMockPrismaService,
  type MockPrismaService,
} from '../prisma/prisma.mock.js';
import type { Realm } from '@prisma/client';

const realm = { id: 'realm-1', name: 'test' } as Realm;

const baseStream = {
  id: 'stream-1',
  realmId: 'realm-1',
  name: 'My HTTP Stream',
  streamType: 'http',
  enabled: true,
  url: 'https://logs.example.com/ingest',
  httpHeaders: null,
  syslogHost: null,
  syslogPort: null,
  syslogProtocol: 'udp',
  syslogFacility: 16,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('AuditStreamsService', () => {
  let service: AuditStreamsService;
  let prisma: MockPrismaService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    service = new AuditStreamsService(prisma as any);
  });

  // ─── create ───────────────────────────────────────────

  describe('create', () => {
    it('should create an HTTP stream', async () => {
      prisma.auditLogStream.create.mockResolvedValue(baseStream);

      const result = await service.create(realm, {
        name: 'My HTTP Stream',
        streamType: 'http',
        url: 'https://logs.example.com/ingest',
      });

      expect(prisma.auditLogStream.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          realmId: 'realm-1',
          name: 'My HTTP Stream',
          streamType: 'http',
          url: 'https://logs.example.com/ingest',
        }),
      });
      expect(result).toEqual(baseStream);
    });

    it('should create a syslog stream with defaults', async () => {
      const syslogStream = {
        ...baseStream,
        streamType: 'syslog',
        url: null,
        syslogHost: 'syslog.corp.com',
        syslogPort: 514,
      };
      prisma.auditLogStream.create.mockResolvedValue(syslogStream);

      await service.create(realm, {
        name: 'Syslog',
        streamType: 'syslog',
        syslogHost: 'syslog.corp.com',
        syslogPort: 514,
      });

      expect(prisma.auditLogStream.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          syslogHost: 'syslog.corp.com',
          syslogPort: 514,
          syslogProtocol: 'udp',
          syslogFacility: 16,
        }),
      });
    });
  });

  // ─── findAll ──────────────────────────────────────────

  describe('findAll', () => {
    it('should return all streams for the realm', async () => {
      prisma.auditLogStream.findMany.mockResolvedValue([baseStream]);

      const result = await service.findAll(realm);

      expect(prisma.auditLogStream.findMany).toHaveBeenCalledWith({
        where: { realmId: 'realm-1' },
        orderBy: { createdAt: 'asc' },
      });
      expect(result).toEqual([baseStream]);
    });
  });

  // ─── findOne ──────────────────────────────────────────

  describe('findOne', () => {
    it('should return a stream when found', async () => {
      prisma.auditLogStream.findFirst.mockResolvedValue(baseStream);

      const result = await service.findOne(realm, 'stream-1');

      expect(prisma.auditLogStream.findFirst).toHaveBeenCalledWith({
        where: { id: 'stream-1', realmId: 'realm-1' },
      });
      expect(result).toEqual(baseStream);
    });

    it('should throw NotFoundException when stream not found', async () => {
      prisma.auditLogStream.findFirst.mockResolvedValue(null);

      await expect(service.findOne(realm, 'missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── update ───────────────────────────────────────────

  describe('update', () => {
    it('should update stream fields', async () => {
      prisma.auditLogStream.findFirst.mockResolvedValue(baseStream);
      const updated = { ...baseStream, enabled: false };
      prisma.auditLogStream.update.mockResolvedValue(updated);

      const result = await service.update(realm, 'stream-1', {
        enabled: false,
      });

      expect(prisma.auditLogStream.update).toHaveBeenCalledWith({
        where: { id: 'stream-1' },
        data: expect.objectContaining({ enabled: false }),
      });
      expect(result).toEqual(updated);
    });

    it('should throw NotFoundException when updating a non-existent stream', async () => {
      prisma.auditLogStream.findFirst.mockResolvedValue(null);

      await expect(
        service.update(realm, 'missing-id', { enabled: false }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── remove ───────────────────────────────────────────

  describe('remove', () => {
    it('should delete the stream', async () => {
      prisma.auditLogStream.findFirst.mockResolvedValue(baseStream);
      prisma.auditLogStream.delete.mockResolvedValue(baseStream);

      await service.remove(realm, 'stream-1');

      expect(prisma.auditLogStream.delete).toHaveBeenCalledWith({
        where: { id: 'stream-1' },
      });
    });

    it('should throw NotFoundException when deleting a non-existent stream', async () => {
      prisma.auditLogStream.findFirst.mockResolvedValue(null);

      await expect(service.remove(realm, 'missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── dispatchToStreams ────────────────────────────────

  describe('dispatchToStreams', () => {
    it('should not throw when no streams are configured', async () => {
      prisma.auditLogStream.findMany.mockResolvedValue([]);

      // dispatchToStreams is fire-and-forget; we call doDispatch-equivalent directly
      // via the internal async path exposed through a brief wait
      service.dispatchToStreams('realm-1', 'user.login', { userId: 'u1' });

      // Allow setImmediate to run
      await new Promise((r) => setImmediate(r));

      expect(prisma.auditLogStream.findMany).toHaveBeenCalledWith({
        where: { realmId: 'realm-1', enabled: true },
      });
    });

    it('should attempt HTTP delivery for http-type streams', async () => {
      prisma.auditLogStream.findMany.mockResolvedValue([
        { ...baseStream, streamType: 'http', url: 'https://logs.example.com' },
      ]);

      const fetchMock = jest.fn().mockResolvedValue({ ok: true });
      (global as any).fetch = fetchMock;

      service.dispatchToStreams('realm-1', 'user.login', { userId: 'u1' });
      await new Promise((r) => setImmediate(r));
      // Give async fetch a chance to complete
      await new Promise((r) => setTimeout(r, 10));

      expect(fetchMock).toHaveBeenCalledWith(
        'https://logs.example.com',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        }),
      );

      delete (global as any).fetch;
    });
  });
});
