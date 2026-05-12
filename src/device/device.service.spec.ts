import { NotFoundException, BadRequestException } from '@nestjs/common';
import { DeviceService } from './device.service.js';
import {
  createMockPrismaService,
  type MockPrismaService,
} from '../prisma/prisma.mock.js';
import type { Realm } from '@prisma/client';

describe('DeviceService', () => {
  let service: DeviceService;
  let prisma: MockPrismaService;

  const mockRealm: Realm = { id: 'realm-1', name: 'test-realm' } as Realm;
  const mockClient = {
    id: 'client-db-id',
    realmId: 'realm-1',
    clientId: 'test-client',
    enabled: true,
    grantTypes: ['urn:ietf:params:oauth:grant-type:device_code'],
  };

  beforeEach(() => {
    prisma = createMockPrismaService();
    service = new DeviceService(prisma as any);
  });

  describe('initiateDeviceAuth', () => {
    it('should successfully create device code when client is found with device_code grant type', async () => {
      prisma.client.findUnique.mockResolvedValue(mockClient as any);
      prisma.deviceCode.create.mockResolvedValue({
        id: 'device-1',
        deviceCode: 'mock-device-code',
        userCode: 'ABCD-EFGH',
        clientId: mockClient.id,
        realmId: mockRealm.id,
        scope: null,
        expiresAt: new Date(Date.now() + 600_000),
        interval: 5,
        approved: false,
        denied: false,
        userId: null,
        createdAt: new Date(),
      } as any);

      const result = await service.initiateDeviceAuth(
        mockRealm,
        'test-client',
        'openid profile',
      );

      expect(prisma.client.findUnique).toHaveBeenCalledWith({
        where: {
          realmId_clientId: { realmId: 'realm-1', clientId: 'test-client' },
        },
      });
      expect(prisma.deviceCode.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          deviceCode: expect.any(String),
          userCode: expect.any(String),
          clientId: 'client-db-id',
          realmId: 'realm-1',
          scope: 'openid profile',
          expiresAt: expect.any(Date),
          interval: 5,
        }),
      });
      expect(result).toEqual({
        device_code: expect.any(String),
        user_code: expect.any(String),
        verification_uri: expect.stringContaining('/realms/test-realm/device'),
        verification_uri_complete: expect.stringContaining(
          '/realms/test-realm/device?user_code=',
        ),
        expires_in: 600,
        interval: 5,
      });
    });

    it('should throw NotFoundException when client is not found', async () => {
      prisma.client.findUnique.mockResolvedValue(null);

      await expect(
        service.initiateDeviceAuth(mockRealm, 'non-existent-client'),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.initiateDeviceAuth(mockRealm, 'non-existent-client'),
      ).rejects.toThrow('Client not found');
    });

    it('should throw NotFoundException when client is disabled', async () => {
      prisma.client.findUnique.mockResolvedValue({
        ...mockClient,
        enabled: false,
      } as any);

      await expect(
        service.initiateDeviceAuth(mockRealm, 'test-client'),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.initiateDeviceAuth(mockRealm, 'test-client'),
      ).rejects.toThrow('Client not found');
    });

    it('should throw BadRequestException when client does not support device_code grant', async () => {
      prisma.client.findUnique.mockResolvedValue({
        ...mockClient,
        grantTypes: ['authorization_code'],
      } as any);

      await expect(
        service.initiateDeviceAuth(mockRealm, 'test-client'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.initiateDeviceAuth(mockRealm, 'test-client'),
      ).rejects.toThrow('Client does not support device authorization');
    });
  });

  describe('approveDevice', () => {
    it('should successfully approve device', async () => {
      const mockDeviceCode = {
        id: 'device-1',
        deviceCode: 'mock-device-code',
        userCode: 'ABCD-EFGH',
        clientId: mockClient.id,
        realmId: mockRealm.id,
        scope: null,
        expiresAt: new Date(Date.now() + 600_000),
        interval: 5,
        approved: false,
        denied: false,
        userId: null,
        createdAt: new Date(),
      };

      prisma.deviceCode.findUnique.mockResolvedValue(mockDeviceCode as any);
      prisma.deviceCode.update.mockResolvedValue({
        ...mockDeviceCode,
        approved: true,
        userId: 'user-1',
      } as any);

      await service.approveDevice(mockRealm, 'ABCD-EFGH', 'user-1');

      expect(prisma.deviceCode.findUnique).toHaveBeenCalledWith({
        where: { userCode: 'ABCD-EFGH' },
      });
      expect(prisma.deviceCode.update).toHaveBeenCalledWith({
        where: { id: 'device-1' },
        data: { approved: true, userId: 'user-1' },
      });
    });

    it('should throw NotFoundException for invalid user code', async () => {
      prisma.deviceCode.findUnique.mockResolvedValue(null);

      await expect(
        service.approveDevice(mockRealm, 'INVALID-CODE', 'user-1'),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.approveDevice(mockRealm, 'INVALID-CODE', 'user-1'),
      ).rejects.toThrow('Invalid user code');
    });

    it('should throw NotFoundException when device belongs to different realm', async () => {
      const mockDeviceCode = {
        id: 'device-1',
        deviceCode: 'mock-device-code',
        userCode: 'ABCD-EFGH',
        clientId: mockClient.id,
        realmId: 'different-realm',
        scope: null,
        expiresAt: new Date(Date.now() + 600_000),
        interval: 5,
        approved: false,
        denied: false,
        userId: null,
        createdAt: new Date(),
      };

      prisma.deviceCode.findUnique.mockResolvedValue(mockDeviceCode as any);

      await expect(
        service.approveDevice(mockRealm, 'ABCD-EFGH', 'user-1'),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.approveDevice(mockRealm, 'ABCD-EFGH', 'user-1'),
      ).rejects.toThrow('Invalid user code');
    });

    it('should throw BadRequestException for expired device code', async () => {
      const mockDeviceCode = {
        id: 'device-1',
        deviceCode: 'mock-device-code',
        userCode: 'ABCD-EFGH',
        clientId: mockClient.id,
        realmId: mockRealm.id,
        scope: null,
        expiresAt: new Date(Date.now() - 1000), // Expired
        interval: 5,
        approved: false,
        denied: false,
        userId: null,
        createdAt: new Date(),
      };

      prisma.deviceCode.findUnique.mockResolvedValue(mockDeviceCode as any);

      await expect(
        service.approveDevice(mockRealm, 'ABCD-EFGH', 'user-1'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.approveDevice(mockRealm, 'ABCD-EFGH', 'user-1'),
      ).rejects.toThrow('Device code has expired');
    });
  });

  describe('denyDevice', () => {
    it('should successfully deny device', async () => {
      const mockDeviceCode = {
        id: 'device-1',
        deviceCode: 'mock-device-code',
        userCode: 'ABCD-EFGH',
        clientId: mockClient.id,
        realmId: mockRealm.id,
        scope: null,
        expiresAt: new Date(Date.now() + 600_000),
        interval: 5,
        approved: false,
        denied: false,
        userId: null,
        createdAt: new Date(),
      };

      prisma.deviceCode.findUnique.mockResolvedValue(mockDeviceCode as any);
      prisma.deviceCode.update.mockResolvedValue({
        ...mockDeviceCode,
        denied: true,
      } as any);

      await service.denyDevice(mockRealm, 'ABCD-EFGH');

      expect(prisma.deviceCode.findUnique).toHaveBeenCalledWith({
        where: { userCode: 'ABCD-EFGH' },
      });
      expect(prisma.deviceCode.update).toHaveBeenCalledWith({
        where: { id: 'device-1' },
        data: { denied: true },
      });
    });

    it('should throw NotFoundException for invalid user code', async () => {
      prisma.deviceCode.findUnique.mockResolvedValue(null);

      await expect(
        service.denyDevice(mockRealm, 'INVALID-CODE'),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.denyDevice(mockRealm, 'INVALID-CODE'),
      ).rejects.toThrow('Invalid user code');
    });

    it('should throw NotFoundException when device belongs to different realm', async () => {
      const mockDeviceCode = {
        id: 'device-1',
        deviceCode: 'mock-device-code',
        userCode: 'ABCD-EFGH',
        clientId: mockClient.id,
        realmId: 'different-realm',
        scope: null,
        expiresAt: new Date(Date.now() + 600_000),
        interval: 5,
        approved: false,
        denied: false,
        userId: null,
        createdAt: new Date(),
      };

      prisma.deviceCode.findUnique.mockResolvedValue(mockDeviceCode as any);

      await expect(service.denyDevice(mockRealm, 'ABCD-EFGH')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.denyDevice(mockRealm, 'ABCD-EFGH')).rejects.toThrow(
        'Invalid user code',
      );
    });
  });
});
