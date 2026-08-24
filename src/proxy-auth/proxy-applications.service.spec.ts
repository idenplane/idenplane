import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Realm } from '@prisma/client';
import { ProxyApplicationsService } from './proxy-applications.service.js';
import { ProxyAuthService } from './proxy-auth.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const realm = { id: 'realm-1', name: 'master' } as Realm;

const validDto = {
  slug: 'grafana',
  name: 'Grafana',
  clientId: 'grafana-proxy',
  allowedRedirectUris: ['https://grafana.example.com/*'],
  cookieDomain: '.example.com',
};

describe('ProxyApplicationsService', () => {
  let service: ProxyApplicationsService;
  let prisma: {
    client: { findUnique: jest.Mock };
    proxyApplication: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    proxySession: { deleteMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      client: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'client-db-1',
          redirectUris: [],
        }),
      },
      proxyApplication: {
        create: jest.fn().mockImplementation(({ data }) => ({
          id: 'app-1',
          ...data,
        })),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        update: jest.fn().mockImplementation(({ data }) => ({
          id: 'app-1',
          slug: 'grafana',
          ...data,
        })),
        delete: jest.fn().mockResolvedValue({}),
      },
      proxySession: { deleteMany: jest.fn().mockResolvedValue({ count: 3 }) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProxyApplicationsService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ProxyAuthService,
          useValue: {
            callbackUrl: (realmName: string, slug: string) =>
              `https://auth.example.com/realms/${realmName}/proxy/${slug}/callback`,
          },
        },
      ],
    }).compile();

    service = module.get(ProxyApplicationsService);
  });

  describe('create', () => {
    it('404s when the OAuth client does not exist', async () => {
      prisma.client.findUnique.mockResolvedValue(null);

      await expect(service.create(realm, validDto)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('translates the unique-constraint violation into a 409', async () => {
      prisma.proxyApplication.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicate', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(service.create(realm, validDto)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('reports the callback URL and that it is not yet registered', async () => {
      const view = await service.create(realm, validDto);

      expect(view.callbackUrl).toBe(
        'https://auth.example.com/realms/master/proxy/grafana/callback',
      );
      expect(view.callbackRegistered).toBe(false);
    });

    it('reports the callback as registered once it is on the client', async () => {
      prisma.client.findUnique.mockResolvedValue({
        id: 'client-db-1',
        redirectUris: [
          'https://auth.example.com/realms/master/proxy/grafana/callback',
        ],
      });

      const view = await service.create(realm, validDto);
      expect(view.callbackRegistered).toBe(true);
    });

    it('leaves header names at their database defaults when not supplied', async () => {
      await service.create(realm, validDto);

      const { data } = prisma.proxyApplication.create.mock.calls[0][0];
      expect(data).not.toHaveProperty('userHeader');
      expect(data).not.toHaveProperty('groupsHeader');
    });

    it('passes through header overrides', async () => {
      await service.create(realm, {
        ...validDto,
        userHeader: 'X-Auth-Request-User',
      });

      const { data } = prisma.proxyApplication.create.mock.calls[0][0];
      expect(data.userHeader).toBe('X-Auth-Request-User');
    });
  });

  // The check that earns its keep: a cookie domain that does not cover the app
  // produces an infinite redirect loop with no error anywhere in the logs.
  describe('cookieDomain / allowedRedirectUris agreement', () => {
    it('accepts a subdomain of the cookie domain', async () => {
      await expect(
        service.create(realm, {
          ...validDto,
          cookieDomain: '.example.com',
          allowedRedirectUris: ['https://grafana.example.com/*'],
        }),
      ).resolves.toBeDefined();
    });

    it('accepts the cookie domain host itself', async () => {
      await expect(
        service.create(realm, {
          ...validDto,
          cookieDomain: 'example.com',
          allowedRedirectUris: ['https://example.com/*'],
        }),
      ).resolves.toBeDefined();
    });

    it('rejects a host the cookie would never reach', async () => {
      await expect(
        service.create(realm, {
          ...validDto,
          cookieDomain: '.example.com',
          allowedRedirectUris: ['https://grafana.other.test/*'],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a suffix lookalike rather than treating it as a subdomain', async () => {
      await expect(
        service.create(realm, {
          ...validDto,
          cookieDomain: '.example.com',
          allowedRedirectUris: ['https://notexample.com/*'],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a redirect URI with no scheme', async () => {
      await expect(
        service.create(realm, {
          ...validDto,
          allowedRedirectUris: ['grafana.example.com/*'],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('re-validates on update when only the cookie domain changes', async () => {
      prisma.proxyApplication.findUnique.mockResolvedValue({
        id: 'app-1',
        clientId: 'client-db-1',
        cookieDomain: '.example.com',
        allowedRedirectUris: ['https://grafana.example.com/*'],
      });

      await expect(
        service.update(realm, 'grafana', { cookieDomain: '.other.test' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('re-validates on update when only the redirect URIs change', async () => {
      prisma.proxyApplication.findUnique.mockResolvedValue({
        id: 'app-1',
        clientId: 'client-db-1',
        cookieDomain: '.example.com',
        allowedRedirectUris: ['https://grafana.example.com/*'],
      });

      await expect(
        service.update(realm, 'grafana', {
          allowedRedirectUris: ['https://app.other.test/*'],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('update', () => {
    beforeEach(() => {
      prisma.proxyApplication.findUnique.mockResolvedValue({
        id: 'app-1',
        clientId: 'client-db-1',
        cookieDomain: '.example.com',
        allowedRedirectUris: ['https://grafana.example.com/*'],
      });
    });

    it('404s for an unknown slug', async () => {
      prisma.proxyApplication.findUnique.mockResolvedValue(null);

      await expect(
        service.update(realm, 'nope', { name: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('404s when repointing at a client that does not exist', async () => {
      prisma.client.findUnique.mockResolvedValue(null);

      await expect(
        service.update(realm, 'grafana', { clientId: 'ghost' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('leaves untouched fields alone', async () => {
      await service.update(realm, 'grafana', { name: 'Grafana Prod' });

      const { data } = prisma.proxyApplication.update.mock.calls[0][0];
      expect(data.name).toBe('Grafana Prod');
      expect(data).not.toHaveProperty('enabled');
      expect(data).not.toHaveProperty('cookieTtl');
    });
  });

  describe('remove', () => {
    it('404s for an unknown slug', async () => {
      prisma.proxyApplication.findUnique.mockResolvedValue(null);

      await expect(service.remove(realm, 'nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('deletes by primary key', async () => {
      prisma.proxyApplication.findUnique.mockResolvedValue({ id: 'app-1' });

      await service.remove(realm, 'grafana');
      expect(prisma.proxyApplication.delete).toHaveBeenCalledWith({
        where: { id: 'app-1' },
      });
    });
  });

  describe('revokeSessions', () => {
    it('404s for an unknown slug', async () => {
      prisma.proxyApplication.findUnique.mockResolvedValue(null);

      await expect(
        service.revokeSessions(realm, 'nope'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('deletes only this application\'s sessions and reports the count', async () => {
      prisma.proxyApplication.findUnique.mockResolvedValue({ id: 'app-1' });

      await expect(service.revokeSessions(realm, 'grafana')).resolves.toEqual({
        revoked: 3,
      });
      expect(prisma.proxySession.deleteMany).toHaveBeenCalledWith({
        where: { proxyApplicationId: 'app-1' },
      });
    });
  });
});
