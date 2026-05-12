jest.mock('../crypto/jwk.service.js', () => ({ JwkService: jest.fn() }));

import { ConflictException, NotFoundException } from '@nestjs/common';
import { IdentityProvidersService } from './identity-providers.service.js';
import {
  createMockPrismaService,
  MockPrismaService,
} from '../prisma/prisma.mock.js';
import type { Realm } from '@prisma/client';

describe('IdentityProvidersService', () => {
  let service: IdentityProvidersService;
  let prisma: MockPrismaService;

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

  const createDto = {
    alias: 'google',
    displayName: 'Google',
    clientId: 'google-client-id',
    clientSecret: 'google-client-secret',
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userinfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
  };

  const mockIdp = {
    id: 'idp-1',
    realmId: 'realm-1',
    alias: 'google',
    displayName: 'Google',
    enabled: true,
    providerType: 'oidc',
    clientId: 'google-client-id',
    clientSecret: 'google-client-secret',
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userinfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    jwksUrl: null,
    issuer: null,
    defaultScopes: 'openid email profile',
    trustEmail: false,
    linkOnly: false,
    syncUserProfile: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    prisma = createMockPrismaService();
    service = new IdentityProvidersService(prisma as any);
  });

  describe('create', () => {
    it('should create a new identity provider with provided values', async () => {
      prisma.identityProvider.findUnique.mockResolvedValue(null);
      prisma.identityProvider.create.mockResolvedValue(mockIdp);

      const result = await service.create(mockRealm, createDto);

      expect(result).toEqual(mockIdp);
      expect(prisma.identityProvider.findUnique).toHaveBeenCalledWith({
        where: { realmId_alias: { realmId: 'realm-1', alias: 'google' } },
      });
      expect(prisma.identityProvider.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          realmId: 'realm-1',
          alias: 'google',
          displayName: 'Google',
          clientId: 'google-client-id',
          clientSecret: 'google-client-secret',
        }),
      });
    });

    it('should apply default values when optional fields are omitted', async () => {
      prisma.identityProvider.findUnique.mockResolvedValue(null);
      prisma.identityProvider.create.mockResolvedValue(mockIdp);

      await service.create(mockRealm, createDto);

      expect(prisma.identityProvider.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          enabled: true,
          providerType: 'oidc',
          defaultScopes: 'openid email profile',
          trustEmail: false,
          linkOnly: false,
          syncUserProfile: true,
        }),
      });
    });

    it('should respect explicit optional values when provided', async () => {
      prisma.identityProvider.findUnique.mockResolvedValue(null);
      prisma.identityProvider.create.mockResolvedValue(mockIdp);

      await service.create(mockRealm, {
        ...createDto,
        enabled: false,
        providerType: 'saml',
        defaultScopes: 'openid',
        trustEmail: true,
        linkOnly: true,
        syncUserProfile: false,
      });

      expect(prisma.identityProvider.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          enabled: false,
          providerType: 'saml',
          defaultScopes: 'openid',
          trustEmail: true,
          linkOnly: true,
          syncUserProfile: false,
        }),
      });
    });

    it('should throw ConflictException when alias already exists in realm', async () => {
      prisma.identityProvider.findUnique.mockResolvedValue(mockIdp);

      await expect(service.create(mockRealm, createDto)).rejects.toThrow(
        ConflictException,
      );

      expect(prisma.identityProvider.create).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('should return all identity providers for the realm', async () => {
      const idps = [mockIdp];
      prisma.identityProvider.findMany.mockResolvedValue(idps);

      const result = await service.findAll(mockRealm);

      expect(result).toEqual(idps);
      expect(prisma.identityProvider.findMany).toHaveBeenCalledWith({
        where: { realmId: 'realm-1' },
        select: expect.objectContaining({
          id: true,
          alias: true,
          displayName: true,
          enabled: true,
          providerType: true,
        }),
      });
    });

    it('should return an empty array when no identity providers exist', async () => {
      prisma.identityProvider.findMany.mockResolvedValue([]);

      const result = await service.findAll(mockRealm);

      expect(result).toEqual([]);
    });
  });

  describe('findByAlias', () => {
    it('should return the identity provider when found', async () => {
      prisma.identityProvider.findUnique.mockResolvedValue(mockIdp);

      const result = await service.findByAlias(mockRealm, 'google');

      expect(result).toEqual(mockIdp);
      expect(prisma.identityProvider.findUnique).toHaveBeenCalledWith({
        where: { realmId_alias: { realmId: 'realm-1', alias: 'google' } },
      });
    });

    it('should throw NotFoundException when alias does not exist', async () => {
      prisma.identityProvider.findUnique.mockResolvedValue(null);

      await expect(
        service.findByAlias(mockRealm, 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update and return the identity provider', async () => {
      prisma.identityProvider.findUnique.mockResolvedValue(mockIdp);
      const updatedIdp = { ...mockIdp, displayName: 'Google SSO' };
      prisma.identityProvider.update.mockResolvedValue(updatedIdp);

      const result = await service.update(mockRealm, 'google', {
        displayName: 'Google SSO',
      });

      expect(result).toEqual(updatedIdp);
      expect(prisma.identityProvider.update).toHaveBeenCalledWith({
        where: { realmId_alias: { realmId: 'realm-1', alias: 'google' } },
        data: { displayName: 'Google SSO' },
      });
    });

    it('should throw NotFoundException when identity provider does not exist', async () => {
      prisma.identityProvider.findUnique.mockResolvedValue(null);

      await expect(
        service.update(mockRealm, 'nonexistent', { displayName: 'X' }),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.identityProvider.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('should delete the identity provider', async () => {
      prisma.identityProvider.findUnique.mockResolvedValue(mockIdp);
      prisma.identityProvider.delete.mockResolvedValue(mockIdp);

      const result = await service.remove(mockRealm, 'google');

      expect(result).toEqual(mockIdp);
      expect(prisma.identityProvider.delete).toHaveBeenCalledWith({
        where: { realmId_alias: { realmId: 'realm-1', alias: 'google' } },
      });
    });

    it('should throw NotFoundException when identity provider does not exist', async () => {
      prisma.identityProvider.findUnique.mockResolvedValue(null);

      await expect(service.remove(mockRealm, 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );

      expect(prisma.identityProvider.delete).not.toHaveBeenCalled();
    });
  });
});
