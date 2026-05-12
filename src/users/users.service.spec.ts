import { ConflictException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service.js';
import {
  createMockPrismaService,
  MockPrismaService,
} from '../prisma/prisma.mock.js';
import type { Realm } from '@prisma/client';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: MockPrismaService;
  let cryptoService: {
    hashPassword: jest.Mock;
    verifyPassword: jest.Mock;
    generateSecret: jest.Mock;
    sha256: jest.Mock;
  };
  let verificationService: { createToken: jest.Mock; validateToken: jest.Mock };
  let emailService: { isConfigured: jest.Mock; sendEmail: jest.Mock };
  let configService: { get: jest.Mock };

  const mockRealm: Realm = {
    id: 'realm-1',
    name: 'test-realm',
    displayName: 'Test Realm',
    enabled: true,
    accessTokenLifespan: 300,
    refreshTokenLifespan: 1800,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Realm;

  const mockUser = {
    id: 'user-1',
    realmId: 'realm-1',
    username: 'testuser',
    email: 'test@example.com',
    emailVerified: false,
    firstName: 'Test',
    lastName: 'User',
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    prisma = createMockPrismaService();
    cryptoService = {
      hashPassword: jest.fn(),
      verifyPassword: jest.fn(),
      generateSecret: jest.fn(),
      sha256: jest.fn(),
    };
    verificationService = {
      createToken: jest.fn().mockResolvedValue('raw-token'),
      validateToken: jest.fn(),
    };
    emailService = {
      isConfigured: jest.fn().mockResolvedValue(false),
      sendEmail: jest.fn().mockResolvedValue(undefined),
    };
    configService = {
      get: jest.fn().mockReturnValue('http://localhost:3000'),
    };
    const passwordPolicyService = {
      validate: jest.fn().mockReturnValue({ valid: true, errors: [] }),
      checkHistory: jest.fn().mockResolvedValue(false),
      recordHistory: jest.fn().mockResolvedValue(undefined),
      isExpired: jest.fn().mockReturnValue(false),
    };
    const themeEmailService = {
      getSubject: jest.fn().mockReturnValue('Verify Your Email — AuthMe'),
      renderEmail: jest.fn().mockReturnValue('<html>verify</html>'),
    };
    const bruteForceService = {
      resetFailures: jest.fn().mockResolvedValue(undefined),
    };
    service = new UsersService(
      prisma as any,
      cryptoService as any,
      verificationService as any,
      emailService as any,
      configService as any,
      passwordPolicyService as any,
      themeEmailService as any,
      bruteForceService as any,
    );
  });

  describe('create', () => {
    it('should create a user without a password', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue(mockUser);

      const result = await service.create(mockRealm, {
        username: 'testuser',
        email: 'test@example.com',
      });

      expect(result).toEqual(mockUser);
      expect(cryptoService.hashPassword).not.toHaveBeenCalled();
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            realmId: 'realm-1',
            username: 'testuser',
            email: 'test@example.com',
            passwordHash: undefined,
          }),
        }),
      );
    });

    it('should create a user with a hashed password', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      cryptoService.hashPassword.mockResolvedValue('hashed-password');
      prisma.user.create.mockResolvedValue(mockUser);

      await service.create(mockRealm, {
        username: 'testuser',
        password: 'secret123',
      });

      expect(cryptoService.hashPassword).toHaveBeenCalledWith('secret123');
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            passwordHash: 'hashed-password',
          }),
        }),
      );
    });

    it('should throw ConflictException when username already exists', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);

      await expect(
        service.create(mockRealm, { username: 'testuser' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException when email already exists', async () => {
      // First call (username check) returns null, second call (email check) returns existing user
      prisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockUser);

      await expect(
        service.create(mockRealm, {
          username: 'newuser',
          email: 'test@example.com',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findAll', () => {
    it('should return paginated users and total count', async () => {
      const users = [mockUser];
      prisma.user.findMany.mockResolvedValue(users);
      prisma.user.count.mockResolvedValue(1);

      const result = await service.findAll(mockRealm, 0, 10);

      expect(result).toEqual({ users, total: 1 });
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { realmId: 'realm-1' },
        select: expect.any(Object),
        skip: 0,
        take: 10,
        orderBy: { createdAt: 'asc' },
      });
      expect(prisma.user.count).toHaveBeenCalledWith({
        where: { realmId: 'realm-1' },
      });
    });

    it('should return empty array when no users exist', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      prisma.user.count.mockResolvedValue(0);

      const result = await service.findAll(mockRealm, 0, 10);

      expect(result).toEqual({ users: [], total: 0 });
    });
  });

  describe('findById', () => {
    it('should return the user when found', async () => {
      prisma.user.findFirst.mockResolvedValue(mockUser);

      const result = await service.findById(mockRealm, 'user-1');

      expect(result).toEqual(mockUser);
      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { id: 'user-1', realmId: 'realm-1' },
        select: expect.any(Object),
      });
    });

    it('should throw NotFoundException when user does not exist', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(service.findById(mockRealm, 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('should update and return the user', async () => {
      prisma.user.findFirst.mockResolvedValue(mockUser);
      const updatedUser = { ...mockUser, firstName: 'Updated' };
      prisma.user.update.mockResolvedValue(updatedUser);

      const result = await service.update(mockRealm, 'user-1', {
        firstName: 'Updated',
      });

      expect(result).toEqual(updatedUser);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          email: undefined,
          firstName: 'Updated',
          lastName: undefined,
          enabled: undefined,
          emailVerified: undefined,
        },
        select: expect.any(Object),
      });
    });

    it('should throw NotFoundException when user does not exist', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.update(mockRealm, 'nonexistent', { firstName: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('should delete the user', async () => {
      prisma.user.findFirst.mockResolvedValue(mockUser);
      prisma.user.delete.mockResolvedValue(mockUser);

      await service.remove(mockRealm, 'user-1');

      expect(prisma.user.delete).toHaveBeenCalledWith({
        where: { id: 'user-1' },
      });
    });

    it('should throw NotFoundException when user does not exist', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(service.remove(mockRealm, 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('setPassword', () => {
    it('should hash and set the password for an existing user', async () => {
      prisma.user.findFirst.mockResolvedValue(mockUser);
      cryptoService.hashPassword.mockResolvedValue('new-hashed-password');
      prisma.user.update.mockResolvedValue({});

      await service.setPassword(mockRealm, 'user-1', 'newpassword');

      expect(cryptoService.hashPassword).toHaveBeenCalledWith('newpassword');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          passwordHash: 'new-hashed-password',
          passwordChangedAt: expect.any(Date),
        },
      });
    });

    it('should throw NotFoundException when user does not exist', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.setPassword(mockRealm, 'nonexistent', 'password'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
