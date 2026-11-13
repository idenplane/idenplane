import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { Realm } from '@prisma/client';
import { TlsAdminService } from './tls-admin.service.js';
import { computeX5tS256 } from '../mtls/client-certificate.source.js';
import { issue, type TestIdentity } from '../client-auth/__mocks__/test-pki.js';

const realm = { id: 'realm-1', name: 'r' } as Realm;

describe('TlsAdminService', () => {
  let prisma: Record<string, Record<string, jest.Mock>>;
  let service: TlsAdminService;
  let leaf: TestIdentity;
  let ca: TestIdentity;

  beforeAll(async () => {
    leaf = await issue({ name: [{ O: ['Acme'] }, { CN: ['device'] }] });
    ca = await issue({ ca: true, cn: 'Acme CA' });
  });

  beforeEach(() => {
    const table = () => ({
      findMany: jest.fn(async () => []),
      findFirst: jest.fn(async () => null),
      count: jest.fn(async () => 0),
      create: jest.fn(async (args: { data: object }) => ({
        id: 'new',
        ...args.data,
      })),
      deleteMany: jest.fn(async () => ({ count: 1 })),
    });
    prisma = {
      clientTlsCertificate: table(),
      realmTlsTrustAnchor: table(),
      tlsRevokedCertificate: table(),
      client: { findUnique: jest.fn(async () => ({ nhiIdentityId: null })) },
    };
    service = new TlsAdminService(
      prisma as never,
      {
        findByClientId: jest.fn(async () => ({
          id: 'c-1',
          clientId: 'device',
        })),
      } as never,
    );
  });

  describe('client certificates', () => {
    it("refuses a certificate for an NHI-backed client: those are the identity's credentials", async () => {
      prisma.client.findUnique.mockResolvedValueOnce({
        nhiIdentityId: 'nhi-1',
      });
      await expect(
        service.addClientCertificate(realm, 'device', leaf.pem),
      ).rejects.toThrow(ConflictException);
      expect(prisma.clientTlsCertificate.create).not.toHaveBeenCalled();
    });

    it('registers a certificate and returns its x5tS256', async () => {
      const row = await service.addClientCertificate(realm, 'device', leaf.pem);
      expect(row).toMatchObject({
        x5tS256: computeX5tS256(leaf.certificate.raw),
      });
      expect(prisma.clientTlsCertificate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            clientId: 'c-1',
            realmId: 'realm-1',
            subject: 'CN=device,O=Acme',
            notAfter: leaf.certificate.validToDate,
          }),
        }),
      );
    });

    it('refuses a private key, several certificates, and an expired one', async () => {
      await expect(
        service.addClientCertificate(
          realm,
          'device',
          `${leaf.pem}${leaf.privateKeyPem}`,
        ),
      ).rejects.toThrow(/private key/);
      await expect(
        service.addClientCertificate(realm, 'device', `${leaf.pem}${ca.pem}`),
      ).rejects.toThrow(/exactly one/);
      const expired = await issue({
        notBefore: new Date(Date.now() - 10 * 86_400_000),
        notAfter: new Date(Date.now() - 86_400_000),
      });
      await expect(
        service.addClientCertificate(realm, 'device', expired.pem),
      ).rejects.toThrow(/expired/);
      expect(prisma.clientTlsCertificate.create).not.toHaveBeenCalled();
    });

    it('maps a duplicate to 409 and caps the count', async () => {
      prisma.clientTlsCertificate.create.mockRejectedValueOnce({
        code: 'P2002',
      });
      await expect(
        service.addClientCertificate(realm, 'device', leaf.pem),
      ).rejects.toThrow(ConflictException);
      prisma.clientTlsCertificate.count.mockResolvedValueOnce(10);
      await expect(
        service.addClientCertificate(realm, 'device', leaf.pem),
      ).rejects.toThrow(ConflictException);
    });

    it('deletes only within the client and realm', async () => {
      await service.removeClientCertificate(realm, 'device', 'id-1');
      expect(prisma.clientTlsCertificate.deleteMany).toHaveBeenCalledWith({
        where: { id: 'id-1', clientId: 'c-1', realmId: 'realm-1' },
      });
      prisma.clientTlsCertificate.deleteMany.mockResolvedValueOnce({
        count: 0,
      });
      await expect(
        service.removeClientCertificate(realm, 'device', 'id-2'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('trust anchors', () => {
    it('accepts a CA certificate', async () => {
      await expect(
        service.addTrustAnchor(realm, ca.pem),
      ).resolves.toMatchObject({
        x5tS256: computeX5tS256(ca.certificate.raw),
      });
    });

    it('refuses a certificate that is not a CA', async () => {
      await expect(service.addTrustAnchor(realm, leaf.pem)).rejects.toThrow(
        /not a CA/,
      );
    });
  });

  describe('deny-list', () => {
    it('lists a certificate by thumbprint, issuer and serial', async () => {
      await service.addRevoked(realm, {
        certificatePem: leaf.pem,
        reason: 'lost',
      });
      expect(prisma.tlsRevokedCertificate.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          x5tS256: computeX5tS256(leaf.certificate.raw),
          // Self-signed: the issuer is the subject, in canonical form.
          issuerDn: '2.5.4.3=device,2.5.4.10=acme',
          serialNumber: expect.stringMatching(/^[0-9a-f]+$/),
          reason: 'lost',
        }),
      });
    });

    it('accepts an issuer DN with a serial, canonicalised', async () => {
      await service.addRevoked(realm, {
        issuerDn: 'CN=Acme CA',
        serialNumber: '00:0A:FF',
      });
      expect(prisma.tlsRevokedCertificate.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          x5tS256: null,
          issuerDn: '2.5.4.3=acme ca',
          serialNumber: 'aff',
        }),
      });
    });

    it.each([
      [{}, /Name the certificate/],
      [{ issuerDn: 'CN=a' }, /go together/],
      [{ serialNumber: '01' }, /go together/],
      [{ issuerDn: 'CN=a', serialNumber: 'zz' }, /hexadecimal/],
      [{ issuerDn: 'nope', serialNumber: '01' }, /RFC 4514/],
    ])('refuses %j', async (dto, message) => {
      await expect(service.addRevoked(realm, dto)).rejects.toThrow(message);
      await expect(service.addRevoked(realm, dto)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
