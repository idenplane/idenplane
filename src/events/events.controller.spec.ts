jest.mock('../crypto/jwk.service.js', () => ({ JwkService: jest.fn() }));

import { EventsController } from './events.controller.js';
import type { Realm } from '@prisma/client';

describe('EventsController', () => {
  let controller: EventsController;
  let mockEventsService: {
    queryLoginEvents: jest.Mock;
    clearLoginEvents: jest.Mock;
    queryAdminEvents: jest.Mock;
  };
  let mockAuditExportService: {
    exportLoginEvents: jest.Mock;
    exportAdminEvents: jest.Mock;
  };
  let mockAuditStreamsService: {
    create: jest.Mock;
    findAll: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
  };

  const realm = {
    id: 'realm-1',
    name: 'test-realm',
    enabled: true,
  } as Realm;

  beforeEach(() => {
    mockEventsService = {
      queryLoginEvents: jest.fn(),
      clearLoginEvents: jest.fn(),
      queryAdminEvents: jest.fn(),
    };
    mockAuditExportService = {
      exportLoginEvents: jest.fn().mockResolvedValue(undefined),
      exportAdminEvents: jest.fn().mockResolvedValue(undefined),
    };
    mockAuditStreamsService = {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };

    controller = new EventsController(
      mockEventsService as any,
      mockAuditExportService as any,
      mockAuditStreamsService as any,
    );
  });

  describe('getLoginEvents', () => {
    it('should call eventsService.queryLoginEvents with all params provided', () => {
      const expected = [{ id: 'event-1' }];
      mockEventsService.queryLoginEvents.mockReturnValue(expected);

      const result = controller.getLoginEvents(
        realm,
        'LOGIN',
        'user-1',
        'client-1',
        '2025-01-01',
        '2025-12-31',
        '0',
        '10',
      );

      expect(mockEventsService.queryLoginEvents).toHaveBeenCalledWith({
        realmId: 'realm-1',
        type: 'LOGIN',
        userId: 'user-1',
        clientId: 'client-1',
        dateFrom: new Date('2025-01-01'),
        dateTo: new Date('2025-12-31'),
        first: 0,
        max: 10,
      });
      expect(result).toEqual(expected);
    });

    it('should call eventsService.queryLoginEvents with no optional params', () => {
      const expected: unknown[] = [];
      mockEventsService.queryLoginEvents.mockReturnValue(expected);

      const result = controller.getLoginEvents(realm);

      expect(mockEventsService.queryLoginEvents).toHaveBeenCalledWith({
        realmId: 'realm-1',
        type: undefined,
        userId: undefined,
        clientId: undefined,
        dateFrom: undefined,
        dateTo: undefined,
        first: undefined,
        max: undefined,
      });
      expect(result).toEqual(expected);
    });

    it('should parse date strings into Date objects', () => {
      controller.getLoginEvents(
        realm,
        undefined,
        undefined,
        undefined,
        '2025-06-15T10:30:00Z',
        '2025-06-16T10:30:00Z',
      );

      const call = mockEventsService.queryLoginEvents.mock.calls[0][0];
      expect(call.dateFrom).toEqual(new Date('2025-06-15T10:30:00Z'));
      expect(call.dateTo).toEqual(new Date('2025-06-16T10:30:00Z'));
    });

    it('should parse first and max as integers', () => {
      controller.getLoginEvents(
        realm,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        '5',
        '25',
      );

      const call = mockEventsService.queryLoginEvents.mock.calls[0][0];
      expect(call.first).toBe(5);
      expect(call.max).toBe(25);
    });
  });

  describe('clearLoginEvents', () => {
    it('should call eventsService.clearLoginEvents with realm.id', () => {
      mockEventsService.clearLoginEvents.mockReturnValue(undefined);

      const result = controller.clearLoginEvents(realm);

      expect(mockEventsService.clearLoginEvents).toHaveBeenCalledWith(
        'realm-1',
      );
      expect(result).toBeUndefined();
    });
  });

  describe('getAdminEvents', () => {
    it('should call eventsService.queryAdminEvents with all params provided', () => {
      const expected = [{ id: 'admin-event-1' }];
      mockEventsService.queryAdminEvents.mockReturnValue(expected);

      const result = controller.getAdminEvents(
        realm,
        'CREATE',
        'USER',
        '2025-01-01',
        '2025-12-31',
        '0',
        '50',
      );

      expect(mockEventsService.queryAdminEvents).toHaveBeenCalledWith({
        realmId: 'realm-1',
        operationType: 'CREATE',
        resourceType: 'USER',
        dateFrom: new Date('2025-01-01'),
        dateTo: new Date('2025-12-31'),
        first: 0,
        max: 50,
      });
      expect(result).toEqual(expected);
    });

    it('should call eventsService.queryAdminEvents with no optional params', () => {
      const expected: unknown[] = [];
      mockEventsService.queryAdminEvents.mockReturnValue(expected);

      const result = controller.getAdminEvents(realm);

      expect(mockEventsService.queryAdminEvents).toHaveBeenCalledWith({
        realmId: 'realm-1',
        operationType: undefined,
        resourceType: undefined,
        dateFrom: undefined,
        dateTo: undefined,
        first: undefined,
        max: undefined,
      });
      expect(result).toEqual(expected);
    });
  });

  describe('exportLoginEvents', () => {
    it('should delegate to auditExportService.exportLoginEvents', async () => {
      const mockRes = { flushHeaders: jest.fn() } as any;
      const query = {
        format: 'csv' as const,
        offset: 0,
        limit: 500,
        dateFrom: '2025-01-01',
        dateTo: '2025-12-31',
        eventType: 'LOGIN',
        userId: 'user-1',
        clientId: undefined,
        ipAddress: undefined,
      };

      await controller.exportLoginEvents(realm, query, mockRes);

      expect(mockAuditExportService.exportLoginEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          realmId: 'realm-1',
          format: 'csv',
          offset: 0,
          limit: 500,
          dateFrom: new Date('2025-01-01'),
          dateTo: new Date('2025-12-31'),
          eventType: 'LOGIN',
          userId: 'user-1',
        }),
        mockRes,
      );
    });
  });

  describe('exportAdminEvents', () => {
    it('should delegate to auditExportService.exportAdminEvents', async () => {
      const mockRes = { flushHeaders: jest.fn() } as any;
      const query = {
        format: 'json' as const,
        offset: 0,
        limit: 1000,
        dateFrom: undefined,
        dateTo: undefined,
        eventType: undefined,
        userId: undefined,
        clientId: undefined,
        ipAddress: undefined,
      };

      await controller.exportAdminEvents(realm, query, mockRes);

      expect(mockAuditExportService.exportAdminEvents).toHaveBeenCalledWith(
        expect.objectContaining({ realmId: 'realm-1', format: 'json' }),
        mockRes,
      );
    });
  });

  describe('audit streams', () => {
    it('createStream should delegate to auditStreamsService.create', () => {
      const dto = { name: 'S', streamType: 'http' as const };
      mockAuditStreamsService.create.mockReturnValue({});
      controller.createStream(realm, dto);
      expect(mockAuditStreamsService.create).toHaveBeenCalledWith(realm, dto);
    });

    it('listStreams should delegate to auditStreamsService.findAll', () => {
      mockAuditStreamsService.findAll.mockReturnValue([]);
      controller.listStreams(realm);
      expect(mockAuditStreamsService.findAll).toHaveBeenCalledWith(realm);
    });

    it('getStream should delegate to auditStreamsService.findOne', () => {
      mockAuditStreamsService.findOne.mockReturnValue({});
      controller.getStream(realm, 'stream-1');
      expect(mockAuditStreamsService.findOne).toHaveBeenCalledWith(
        realm,
        'stream-1',
      );
    });

    it('updateStream should delegate to auditStreamsService.update', () => {
      const dto = { enabled: false };
      mockAuditStreamsService.update.mockReturnValue({});
      controller.updateStream(realm, 'stream-1', dto);
      expect(mockAuditStreamsService.update).toHaveBeenCalledWith(
        realm,
        'stream-1',
        dto,
      );
    });

    it('removeStream should delegate to auditStreamsService.remove', () => {
      mockAuditStreamsService.remove.mockReturnValue(undefined);
      controller.removeStream(realm, 'stream-1');
      expect(mockAuditStreamsService.remove).toHaveBeenCalledWith(
        realm,
        'stream-1',
      );
    });
  });
});
