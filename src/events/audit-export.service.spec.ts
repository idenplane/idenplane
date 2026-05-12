import { AuditExportService } from './audit-export.service.js';
import {
  createMockPrismaService,
  type MockPrismaService,
} from '../prisma/prisma.mock.js';

// Minimal Response mock that captures written data
function makeMockResponse() {
  const chunks: string[] = [];
  return {
    setHeader: jest.fn(),
    write: jest.fn((chunk: string) => {
      chunks.push(chunk);
    }),
    end: jest.fn(),
    json: jest.fn(),
    _chunks: chunks,
  };
}

describe('AuditExportService', () => {
  let service: AuditExportService;
  let prisma: MockPrismaService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    service = new AuditExportService(prisma as any);
  });

  // ─── exportLoginEvents ────────────────────────────────

  describe('exportLoginEvents - JSON', () => {
    it('should set JSON headers and call res.json with events', async () => {
      const mockEvents = [
        {
          id: 'evt-1',
          realmId: 'realm-1',
          type: 'LOGIN',
          userId: 'user-1',
          sessionId: 'sess-1',
          clientId: 'client-1',
          ipAddress: '127.0.0.1',
          error: null,
          details: null,
          createdAt: new Date('2025-01-01T10:00:00Z'),
        },
      ];
      prisma.loginEvent.findMany.mockResolvedValue(mockEvents);

      const res = makeMockResponse();
      await service.exportLoginEvents(
        { realmId: 'realm-1', format: 'json', offset: 0, limit: 100 },
        res as any,
      );

      expect(prisma.loginEvent.findMany).toHaveBeenCalledWith({
        where: { realmId: 'realm-1' },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 100,
      });
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/json; charset=utf-8',
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringContaining('login-events-realm-1'),
      );
      expect(res.json).toHaveBeenCalledWith(mockEvents);
    });
  });

  describe('exportLoginEvents - CSV', () => {
    it('should set CSV headers, write header row, and one data row per event', async () => {
      const mockEvents = [
        {
          id: 'evt-1',
          realmId: 'realm-1',
          type: 'LOGIN',
          userId: 'user-1',
          sessionId: 'sess-1',
          clientId: 'my-app',
          ipAddress: '10.0.0.1',
          error: null,
          details: null,
          createdAt: new Date('2025-06-01T12:00:00Z'),
        },
      ];
      prisma.loginEvent.findMany.mockResolvedValue(mockEvents);

      const res = makeMockResponse();
      await service.exportLoginEvents(
        { realmId: 'realm-1', format: 'csv', offset: 0, limit: 500 },
        res as any,
      );

      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'text/csv; charset=utf-8',
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringContaining('.csv'),
      );
      // Header row + 1 data row
      expect(res.write).toHaveBeenCalledTimes(2);
      const headerRow: string = (res.write as jest.Mock).mock.calls[0][0];
      expect(headerRow).toContain('id');
      expect(headerRow).toContain('realmId');
      expect(headerRow).toContain('type');
      expect(headerRow).toContain('userId');
      expect(headerRow).toContain('createdAt');

      const dataRow: string = (res.write as jest.Mock).mock.calls[1][0];
      expect(dataRow).toContain('evt-1');
      expect(dataRow).toContain('realm-1');
      expect(dataRow).toContain('LOGIN');
      expect(dataRow).toContain('user-1');
      expect(dataRow).toContain('2025-06-01T12:00:00.000Z');
      expect(res.end).toHaveBeenCalled();
    });

    it('should apply filters when provided', async () => {
      prisma.loginEvent.findMany.mockResolvedValue([]);
      const dateFrom = new Date('2025-01-01');
      const dateTo = new Date('2025-12-31');

      const res = makeMockResponse();
      await service.exportLoginEvents(
        {
          realmId: 'realm-1',
          format: 'csv',
          dateFrom,
          dateTo,
          eventType: 'LOGIN_ERROR',
          userId: 'user-2',
          clientId: 'client-x',
          ipAddress: '192.168.1.1',
          offset: 10,
          limit: 50,
        },
        res as any,
      );

      expect(prisma.loginEvent.findMany).toHaveBeenCalledWith({
        where: {
          realmId: 'realm-1',
          type: 'LOGIN_ERROR',
          userId: 'user-2',
          clientId: 'client-x',
          ipAddress: '192.168.1.1',
          createdAt: { gte: dateFrom, lte: dateTo },
        },
        orderBy: { createdAt: 'desc' },
        skip: 10,
        take: 50,
      });
    });

    it('should escape CSV fields that contain commas', async () => {
      const mockEvents = [
        {
          id: 'evt-1',
          realmId: 'realm-1',
          type: 'LOGIN',
          userId: null,
          sessionId: null,
          clientId: null,
          ipAddress: null,
          error: 'Something, went wrong',
          details: null,
          createdAt: new Date('2025-01-01T00:00:00Z'),
        },
      ];
      prisma.loginEvent.findMany.mockResolvedValue(mockEvents);

      const res = makeMockResponse();
      await service.exportLoginEvents(
        { realmId: 'realm-1', format: 'csv', offset: 0, limit: 100 },
        res as any,
      );

      const dataRow: string = (res.write as jest.Mock).mock.calls[1][0];
      expect(dataRow).toContain('"Something, went wrong"');
    });
  });

  // ─── exportAdminEvents ───────────────────────────────

  describe('exportAdminEvents - JSON', () => {
    it('should set JSON headers and call res.json with admin events', async () => {
      const mockEvents = [
        {
          id: 'aevt-1',
          realmId: 'realm-1',
          adminUserId: 'admin-1',
          operationType: 'CREATE',
          resourceType: 'USER',
          resourcePath: '/users/u1',
          ipAddress: '127.0.0.1',
          representation: { email: 'x@y.com' },
          createdAt: new Date('2025-01-01T10:00:00Z'),
        },
      ];
      prisma.adminEvent.findMany.mockResolvedValue(mockEvents);

      const res = makeMockResponse();
      await service.exportAdminEvents(
        { realmId: 'realm-1', format: 'json', offset: 0, limit: 100 },
        res as any,
      );

      expect(res.json).toHaveBeenCalledWith(mockEvents);
    });
  });

  describe('exportAdminEvents - CSV', () => {
    it('should write header row and one data row', async () => {
      const mockEvents = [
        {
          id: 'aevt-1',
          realmId: 'realm-1',
          adminUserId: 'admin-1',
          operationType: 'DELETE',
          resourceType: 'CLIENT',
          resourcePath: '/clients/c1',
          ipAddress: '10.0.0.1',
          representation: null,
          createdAt: new Date('2025-03-15T08:30:00Z'),
        },
      ];
      prisma.adminEvent.findMany.mockResolvedValue(mockEvents);

      const res = makeMockResponse();
      await service.exportAdminEvents(
        { realmId: 'realm-1', format: 'csv', offset: 0, limit: 100 },
        res as any,
      );

      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'text/csv; charset=utf-8',
      );
      expect(res.write).toHaveBeenCalledTimes(2);
      const headerRow: string = (res.write as jest.Mock).mock.calls[0][0];
      expect(headerRow).toContain('adminUserId');
      expect(headerRow).toContain('operationType');
      expect(headerRow).toContain('resourceType');
      expect(headerRow).toContain('resourcePath');

      const dataRow: string = (res.write as jest.Mock).mock.calls[1][0];
      expect(dataRow).toContain('aevt-1');
      expect(dataRow).toContain('DELETE');
      expect(dataRow).toContain('CLIENT');
      expect(res.end).toHaveBeenCalled();
    });

    it('should filter admin events by operationType when eventType provided', async () => {
      prisma.adminEvent.findMany.mockResolvedValue([]);

      const res = makeMockResponse();
      await service.exportAdminEvents(
        {
          realmId: 'realm-1',
          format: 'json',
          eventType: 'UPDATE',
          userId: 'admin-2',
          offset: 0,
          limit: 100,
        },
        res as any,
      );

      expect(prisma.adminEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            operationType: 'UPDATE',
            adminUserId: 'admin-2',
          }),
        }),
      );
    });
  });
});
