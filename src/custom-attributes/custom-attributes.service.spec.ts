import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { CustomAttributesService } from './custom-attributes.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const mockPrisma = {
  customAttribute: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  userAttribute: {
    findMany: jest.fn(),
    upsert: jest.fn(),
    create: jest.fn(),
  },
  user: {
    findFirst: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockRealm = {
  id: 'realm-1',
  name: 'test-realm',
} as any;

describe('CustomAttributesService', () => {
  let service: CustomAttributesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomAttributesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<CustomAttributesService>(CustomAttributesService);
    jest.clearAllMocks();
  });

  // ─── Attribute Definition CRUD ──────────────────────────────────────

  describe('createAttribute', () => {
    it('should create a text attribute successfully', async () => {
      const dto = {
        name: 'phone_number',
        displayName: 'Phone Number',
        type: 'text',
      };
      const created = { id: 'attr-1', ...dto, realmId: 'realm-1' };
      mockPrisma.customAttribute.create.mockResolvedValue(created);

      const result = await service.createAttribute(mockRealm, dto);

      expect(result).toEqual(created);
      expect(mockPrisma.customAttribute.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          realmId: 'realm-1',
          name: 'phone_number',
          displayName: 'Phone Number',
          type: 'text',
        }),
      });
    });

    it('should throw BadRequestException for select type without options', async () => {
      const dto = {
        name: 'department',
        displayName: 'Department',
        type: 'select',
      };

      await expect(
        service.createAttribute(mockRealm, dto as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for multi-select type without options', async () => {
      const dto = { name: 'tags', displayName: 'Tags', type: 'multi-select' };

      await expect(
        service.createAttribute(mockRealm, dto as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow select type with options', async () => {
      const dto = {
        name: 'department',
        displayName: 'Department',
        type: 'select',
        options: ['Engineering', 'Marketing'],
      };
      mockPrisma.customAttribute.create.mockResolvedValue({
        id: 'attr-1',
        ...dto,
      });

      await expect(
        service.createAttribute(mockRealm, dto as any),
      ).resolves.toBeDefined();
    });

    it('should throw ConflictException on duplicate name', async () => {
      const { Prisma } = jest.requireActual('@prisma/client');
      const error = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        {
          code: 'P2002',
          clientVersion: '5.0.0',
        },
      );
      mockPrisma.customAttribute.create.mockRejectedValue(error);

      await expect(
        service.createAttribute(mockRealm, {
          name: 'phone',
          displayName: 'Phone',
          type: 'text',
        } as any),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findAllAttributes', () => {
    it('should return all attributes for a realm ordered by sortOrder', async () => {
      const attrs = [
        { id: '1', name: 'a', sortOrder: 0 },
        { id: '2', name: 'b', sortOrder: 1 },
      ];
      mockPrisma.customAttribute.findMany.mockResolvedValue(attrs);

      const result = await service.findAllAttributes(mockRealm);

      expect(result).toEqual(attrs);
      expect(mockPrisma.customAttribute.findMany).toHaveBeenCalledWith({
        where: { realmId: 'realm-1' },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      });
    });
  });

  describe('findAttributeById', () => {
    it('should return the attribute when found', async () => {
      const attr = { id: 'attr-1', name: 'phone', realmId: 'realm-1' };
      mockPrisma.customAttribute.findFirst.mockResolvedValue(attr);

      const result = await service.findAttributeById(mockRealm, 'attr-1');
      expect(result).toEqual(attr);
    });

    it('should throw NotFoundException when not found', async () => {
      mockPrisma.customAttribute.findFirst.mockResolvedValue(null);

      await expect(
        service.findAttributeById(mockRealm, 'non-existent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('removeAttribute', () => {
    it('should delete the attribute', async () => {
      const attr = { id: 'attr-1', name: 'phone', realmId: 'realm-1' };
      mockPrisma.customAttribute.findFirst.mockResolvedValue(attr);
      mockPrisma.customAttribute.delete.mockResolvedValue(attr);

      await service.removeAttribute(mockRealm, 'attr-1');

      expect(mockPrisma.customAttribute.delete).toHaveBeenCalledWith({
        where: { id: 'attr-1' },
      });
    });
  });

  // ─── User Attribute Values ──────────────────────────────────────────

  describe('getUserAttributes', () => {
    it('should return formatted user attributes', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        realmId: 'realm-1',
      });
      mockPrisma.userAttribute.findMany.mockResolvedValue([
        {
          attributeId: 'attr-1',
          value: '+1234567890',
          attribute: {
            name: 'phone',
            displayName: 'Phone',
            type: 'text',
            sortOrder: 0,
          },
        },
      ]);

      const result = await service.getUserAttributes(mockRealm, 'user-1');

      expect(result).toEqual([
        {
          attributeId: 'attr-1',
          name: 'phone',
          displayName: 'Phone',
          type: 'text',
          value: '+1234567890',
        },
      ]);
    });

    it('should throw NotFoundException when user is not in realm', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.getUserAttributes(mockRealm, 'user-999'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('setUserAttributes', () => {
    it('should reject unknown attribute names', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        realmId: 'realm-1',
      });
      mockPrisma.customAttribute.findMany.mockResolvedValue([
        {
          id: 'attr-1',
          name: 'phone',
          displayName: 'Phone',
          type: 'text',
          required: false,
        },
      ]);

      await expect(
        service.setUserAttributes(mockRealm, 'user-1', {
          unknown_attr: 'value',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject invalid number values', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        realmId: 'realm-1',
      });
      mockPrisma.customAttribute.findMany.mockResolvedValue([
        {
          id: 'attr-1',
          name: 'age',
          displayName: 'Age',
          type: 'number',
          required: false,
        },
      ]);

      await expect(
        service.setUserAttributes(mockRealm, 'user-1', { age: 'not-a-number' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject invalid select values', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        realmId: 'realm-1',
      });
      mockPrisma.customAttribute.findMany.mockResolvedValue([
        {
          id: 'attr-1',
          name: 'department',
          displayName: 'Department',
          type: 'select',
          required: false,
          options: ['Engineering', 'Marketing'],
        },
      ]);

      await expect(
        service.setUserAttributes(mockRealm, 'user-1', {
          department: 'Finance',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should upsert valid attributes', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        realmId: 'realm-1',
      });
      mockPrisma.customAttribute.findMany.mockResolvedValue([
        {
          id: 'attr-1',
          name: 'phone',
          displayName: 'Phone',
          type: 'text',
          required: false,
          options: null,
        },
      ]);
      mockPrisma.$transaction.mockResolvedValue([]);
      mockPrisma.userAttribute.findMany.mockResolvedValue([
        {
          attributeId: 'attr-1',
          value: '+1234567890',
          attribute: {
            name: 'phone',
            displayName: 'Phone',
            type: 'text',
            sortOrder: 0,
          },
        },
      ]);

      const result = await service.setUserAttributes(mockRealm, 'user-1', {
        phone: '+1234567890',
      });

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('should reject text values containing angle brackets (HTML injection guard)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        realmId: 'realm-1',
      });
      mockPrisma.customAttribute.findMany.mockResolvedValue([
        {
          id: 'attr-1',
          name: 'department',
          displayName: 'Department',
          type: 'text',
          required: false,
          options: null,
        },
      ]);

      await expect(
        service.setUserAttributes(mockRealm, 'user-1', {
          department: '<script>alert(1)</script>',
        }),
      ).rejects.toThrow(/must not contain HTML tags/);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  // ─── Registration Helpers ──────────────────────────────────────────

  describe('validateAndSaveRegistrationAttributes', () => {
    it('should throw BadRequestException for missing required field', async () => {
      mockPrisma.customAttribute.findMany.mockResolvedValue([
        {
          id: 'attr-1',
          name: 'company',
          displayName: 'Company',
          type: 'text',
          required: true,
          options: null,
        },
      ]);

      await expect(
        service.validateAndSaveRegistrationAttributes(mockRealm, 'user-1', {}),
      ).rejects.toThrow(BadRequestException);
    });

    it('should save attribute values for non-empty fields', async () => {
      mockPrisma.customAttribute.findMany.mockResolvedValue([
        {
          id: 'attr-1',
          name: 'company',
          displayName: 'Company',
          type: 'text',
          required: true,
          options: null,
        },
      ]);
      mockPrisma.$transaction.mockResolvedValue([]);

      await service.validateAndSaveRegistrationAttributes(mockRealm, 'user-1', {
        attr_company: 'Acme Corp',
      });

      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('should skip optional attributes with empty values', async () => {
      mockPrisma.customAttribute.findMany.mockResolvedValue([
        {
          id: 'attr-1',
          name: 'company',
          displayName: 'Company',
          type: 'text',
          required: false,
          options: null,
        },
      ]);

      await service.validateAndSaveRegistrationAttributes(mockRealm, 'user-1', {
        attr_company: '',
      });

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  // ─── OIDC Claims ──────────────────────────────────────────────────

  describe('getOidcClaimsForUser', () => {
    it('should return claims for attributes with mapToOidcClaim', async () => {
      mockPrisma.userAttribute.findMany.mockResolvedValue([
        {
          value: '+1234567890',
          attribute: { mapToOidcClaim: 'phone_number' },
        },
        {
          value: 'Engineering',
          attribute: { mapToOidcClaim: null },
        },
      ]);

      const claims = await service.getOidcClaimsForUser('user-1');

      expect(claims).toEqual({ phone_number: '+1234567890' });
    });

    it('should return empty object when no attributes have OIDC claims', async () => {
      mockPrisma.userAttribute.findMany.mockResolvedValue([]);

      const claims = await service.getOidcClaimsForUser('user-1');

      expect(claims).toEqual({});
    });
  });
});
