import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { Realm } from '@prisma/client';
import { NhiOAuthClientService } from './nhi-oauth-client.service.js';

const realm = {
  id: 'realm-1',
  name: 'acme',
  mtlsClientAuthEnabled: true,
} as Realm;

const stored = {
  id: 'c-1',
  realmId: realm.id,
  clientId: 'nhi-nhi-1',
  name: 'sensor',
  enabled: true,
  clientType: 'CONFIDENTIAL',
  grantTypes: ['client_credentials'],
  tokenEndpointAuthMethod: 'self_signed_tls_client_auth',
  tlsClientCertificateBoundAccessTokens: true,
  nhiIdentityId: 'nhi-1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('NhiOAuthClientService', () => {
  let prisma: {
    client: { findFirst: jest.Mock };
    nhiCredential: { findMany: jest.Mock };
  };
  let clients: { createForNhiIdentity: jest.Mock; remove: jest.Mock };
  let nhi: { findById: jest.Mock };
  let identity: { id: string; name: string; lifecycleStatus: string };
  let service: NhiOAuthClientService;

  beforeEach(() => {
    identity = { id: 'nhi-1', name: 'sensor', lifecycleStatus: 'ACTIVE' };
    prisma = {
      client: { findFirst: jest.fn(async () => null) },
      nhiCredential: {
        findMany: jest.fn(async () => [{ tlsAuthMode: 'SELF_SIGNED' }]),
      },
    };
    clients = {
      createForNhiIdentity: jest.fn(async (_r, input) => ({
        ...stored,
        ...input,
        // Fields the view must not pass on.
        redirectUris: [],
        serviceAccountUserId: null,
      })),
      remove: jest.fn(async () => undefined),
    };
    nhi = { findById: jest.fn(async () => identity) };
    service = new NhiOAuthClientService(
      prisma as never,
      clients as never,
      nhi as never,
    );
  });

  it('creates a confidential client_credentials client with the method the credentials imply', async () => {
    const result = await service.ensure(realm, 'nhi-1', {});
    expect(clients.createForNhiIdentity).toHaveBeenCalledWith(realm, {
      clientId: 'nhi-nhi-1',
      name: 'sensor',
      nhiIdentityId: 'nhi-1',
      tokenEndpointAuthMethod: 'self_signed_tls_client_auth',
    });
    expect(result.created).toBe(true);
    expect(result.client).toEqual({
      ...stored,
      tokenEndpoint: '/realms/acme/protocol/openid-connect/token',
      mtlsClientAuthEnabled: true,
    });
    // Only live certificate credentials of this identity, in this realm.
    expect(prisma.nhiCredential.findMany.mock.calls[0][0].where).toMatchObject({
      realmId: realm.id,
      nhiIdentityId: 'nhi-1',
      tlsAuthMode: { not: null },
    });
  });

  it('PKI credentials imply tls_client_auth; a body method wins', async () => {
    prisma.nhiCredential.findMany.mockResolvedValue([{ tlsAuthMode: 'PKI' }]);
    await service.ensure(realm, 'nhi-1', {});
    expect(
      clients.createForNhiIdentity.mock.calls[0][1].tokenEndpointAuthMethod,
    ).toBe('tls_client_auth');

    await service.ensure(realm, 'nhi-1', {
      tokenEndpointAuthMethod: 'self_signed_tls_client_auth',
      clientId: 'sensor-0042',
      name: 'Sensor 42',
    });
    expect(clients.createForNhiIdentity.mock.calls[1][1]).toMatchObject({
      tokenEndpointAuthMethod: 'self_signed_tls_client_auth',
      clientId: 'sensor-0042',
      name: 'Sensor 42',
    });
  });

  it.each([
    ['no certificate credential', []],
    ['both modes', [{ tlsAuthMode: 'SELF_SIGNED' }, { tlsAuthMode: 'PKI' }]],
  ])('needs a method when the identity has %s', async (_n, rows) => {
    prisma.nhiCredential.findMany.mockResolvedValue(rows);
    await expect(service.ensure(realm, 'nhi-1', {})).rejects.toThrow(
      BadRequestException,
    );
    expect(clients.createForNhiIdentity).not.toHaveBeenCalled();
  });

  it('returns the existing client (200) instead of creating another', async () => {
    prisma.client.findFirst.mockResolvedValue(stored);
    const result = await service.ensure(realm, 'nhi-1', {
      tokenEndpointAuthMethod: 'self_signed_tls_client_auth',
    });
    expect(result.created).toBe(false);
    expect(result.client.clientId).toBe('nhi-nhi-1');
    expect(clients.createForNhiIdentity).not.toHaveBeenCalled();
    expect(prisma.client.findFirst.mock.calls[0][0].where).toEqual({
      realmId: realm.id,
      nhiIdentityId: 'nhi-1',
    });
  });

  it('refuses a different method or clientId than the existing client', async () => {
    prisma.client.findFirst.mockResolvedValue(stored);
    await expect(
      service.ensure(realm, 'nhi-1', {
        tokenEndpointAuthMethod: 'tls_client_auth',
      }),
    ).rejects.toThrow(ConflictException);
    await expect(
      service.ensure(realm, 'nhi-1', { clientId: 'other' }),
    ).rejects.toThrow(ConflictException);
  });

  it('a lost race returns the winner; a taken clientId is 409', async () => {
    clients.createForNhiIdentity.mockRejectedValue({ code: 'P2002' });
    prisma.client.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(stored);
    await expect(service.ensure(realm, 'nhi-1', {})).resolves.toMatchObject({
      created: false,
    });

    prisma.client.findFirst.mockResolvedValue(null);
    await expect(service.ensure(realm, 'nhi-1', {})).rejects.toThrow(
      /already exists/,
    );
  });

  it('refuses a decommissioned identity', async () => {
    identity.lifecycleStatus = 'DECOMMISSIONED';
    await expect(service.ensure(realm, 'nhi-1', {})).rejects.toThrow(
      ConflictException,
    );
  });

  it('an identity of another realm is not found', async () => {
    nhi.findById.mockRejectedValue(new NotFoundException());
    await expect(service.ensure(realm, 'nhi-x', {})).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.get(realm, 'nhi-x')).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.remove(realm, 'nhi-x')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('gets and deletes the client through ClientsService', async () => {
    await expect(service.get(realm, 'nhi-1')).rejects.toThrow(
      NotFoundException,
    );
    prisma.client.findFirst.mockResolvedValue(stored);
    await expect(service.get(realm, 'nhi-1')).resolves.toMatchObject({
      clientId: 'nhi-nhi-1',
    });
    await service.remove(realm, 'nhi-1');
    expect(clients.remove).toHaveBeenCalledWith(realm, 'nhi-nhi-1');
  });
});
