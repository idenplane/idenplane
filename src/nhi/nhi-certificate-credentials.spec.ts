import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { Realm } from '@prisma/client';
import { NhiService } from './nhi.service.js';
import { computeX5tS256 } from '../mtls/client-certificate.source.js';
import { issue, type TestIdentity } from '../client-auth/__mocks__/test-pki.js';
import { MAX_LIVE_CERTIFICATE_CREDENTIALS } from './nhi-credential-status.js';
import { DEFAULT_ROTATION_OVERLAP_SECONDS } from './nhi-certificate-credential.js';

const realm = {
  id: 'realm-1',
  name: 'acme',
  mtlsClientAuthEnabled: true,
} as Realm;
const DAY = 86_400_000;

/**
 * Certificate credentials (RFC 8705 NHI binding): creation per mode, the
 * live-certificate cap, and rotation with overlap in one transaction.
 */
describe('NhiService certificate credentials', () => {
  let device: TestIdentity;
  let renewed: TestIdentity;
  let expired: TestIdentity;
  let service: NhiService;
  let calls: string[];
  let prisma: any;
  let liveCount: number;
  let duplicateCount: number;
  let oldCredential: Record<string, unknown> | null;
  let policy: { rotationOverlapSeconds: number } | null;
  let superseded: number;

  beforeAll(async () => {
    device = await issue({ cn: 'device-1' });
    renewed = await issue({ cn: 'device-1' });
    expired = await issue({
      cn: 'old',
      notBefore: new Date(Date.now() - 3 * DAY),
      notAfter: new Date(Date.now() - DAY),
    });
  });

  beforeEach(() => {
    calls = [];
    liveCount = 0;
    duplicateCount = 0;
    superseded = 1;
    policy = null;
    oldCredential = {
      id: 'old',
      realmId: realm.id,
      nhiIdentityId: 'nhi-1',
      credentialType: 'CERTIFICATE',
      name: 'device cert',
      tlsAuthMode: 'SELF_SIGNED',
      certThumbprintS256: computeX5tS256(device.certificate.raw),
      enabled: true,
      revoked: false,
      expiresAt: null,
      certNotBefore: device.certificate.validFromDate,
      certNotAfter: device.certificate.validToDate,
      supersededById: null,
      rotationGraceUntil: null,
      allowedIpRanges: [],
      tlsClientAuthSubjectDn: null,
      tlsClientAuthSanDns: null,
      tlsClientAuthSanUri: null,
      tlsClientAuthSanIp: null,
      tlsClientAuthSanEmail: null,
    };
    const track =
      <T>(name: string, impl: (...args: any[]) => T) =>
      (...args: any[]) => {
        calls.push(name);
        return impl(...args);
      };
    prisma = {
      nhiIdentity: {
        findFirst: jest.fn(async ({ where }) =>
          where.realmId === realm.id && where.id === 'nhi-1'
            ? {
                id: 'nhi-1',
                realmId: realm.id,
                enabled: true,
                lifecycleStatus: 'ACTIVE',
              }
            : null,
        ),
      },
      nhiCredential: {
        count: jest.fn(
          track('count', async ({ where }) =>
            where.certThumbprintS256 ? duplicateCount : liveCount,
          ),
        ),
        create: jest.fn(
          track('create', async ({ data }) => ({ id: 'new', ...data })),
        ),
        findFirst: jest.fn(async () => oldCredential),
        updateMany: jest.fn(
          track('updateMany', async () => ({ count: superseded })),
        ),
      },
      nhiCredentialPolicy: { findFirst: jest.fn(async () => policy) },
      $queryRaw: jest.fn(track('lock', async () => [{ id: 'nhi-1' }])),
      $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => {
        calls.push('begin');
        try {
          return await fn(prisma);
        } finally {
          calls.push('end');
        }
      }),
    };
    service = new NhiService(prisma, {} as never);
  });

  const createdData = () => prisma.nhiCredential.create.mock.calls[0][0].data;

  describe('create', () => {
    it('SELF_SIGNED: stores the certificate, its x5t#S256 and metadata, under the identity lock', async () => {
      const result = await service.createCredential(realm, 'nhi-1', {
        name: 'device cert',
        tlsAuthMode: 'SELF_SIGNED',
        certificatePem: device.pem,
      });

      expect(createdData()).toMatchObject({
        realmId: realm.id,
        nhiIdentityId: 'nhi-1',
        // tlsAuthMode implies CERTIFICATE.
        credentialType: 'CERTIFICATE',
        tlsAuthMode: 'SELF_SIGNED',
        certThumbprintS256: computeX5tS256(device.certificate.raw),
        certSubject: 'CN=device-1',
        certNotBefore: device.certificate.validFromDate,
        certNotAfter: device.certificate.validToDate,
        tlsClientAuthSanDns: null,
      });
      expect(createdData().certSerialNumber).toMatch(/^[0-9a-f]+$/);
      expect(result.status).toBe('active');
      // Lock, cap, duplicate check and insert in one transaction.
      expect(calls).toEqual([
        'begin',
        'lock',
        'count',
        'count',
        'create',
        'end',
      ]);
      const lock = prisma.$queryRaw.mock.calls[0];
      expect(lock[0].join('?')).toMatch(/FOR UPDATE/);
      expect(lock.slice(1)).toEqual(['nhi-1', realm.id]);
    });

    it('PKI: stores exactly one valid rule and no certificate', async () => {
      await service.createCredential(realm, 'nhi-1', {
        name: 'fleet rule',
        credentialType: 'MTLS',
        tlsAuthMode: 'PKI',
        tlsClientAuthSanUri: 'spiffe://example.org/device/1',
      });
      expect(createdData()).toMatchObject({
        credentialType: 'MTLS',
        tlsAuthMode: 'PKI',
        tlsClientAuthSanUri: 'spiffe://example.org/device/1',
        tlsClientAuthSubjectDn: null,
        certificatePem: null,
        certThumbprintS256: null,
      });
    });

    it.each([
      ['SELF_SIGNED without a certificate', { tlsAuthMode: 'SELF_SIGNED' }],
      [
        'SELF_SIGNED with a private key in the PEM',
        { tlsAuthMode: 'SELF_SIGNED', certificatePem: 'KEY' },
      ],
      [
        'SELF_SIGNED with a rule',
        {
          tlsAuthMode: 'SELF_SIGNED',
          certificatePem: 'CERT',
          tlsClientAuthSanDns: 'a.example',
        },
      ],
      [
        'SELF_SIGNED with a chain',
        {
          tlsAuthMode: 'SELF_SIGNED',
          certificatePem: 'CERT',
          certificateChain: 'CERT',
        },
      ],
      [
        'a private key field',
        {
          tlsAuthMode: 'SELF_SIGNED',
          certificatePem: 'CERT',
          privateKeyPem: 'k',
        },
      ],
      ['PKI without a rule', { tlsAuthMode: 'PKI' }],
      [
        'PKI with two rules',
        {
          tlsAuthMode: 'PKI',
          tlsClientAuthSanDns: 'a.example',
          tlsClientAuthSanIp: '10.0.0.1',
        },
      ],
      [
        'PKI with a malformed DN',
        { tlsAuthMode: 'PKI', tlsClientAuthSubjectDn: 'not a dn' },
      ],
      [
        'PKI with a wildcard DNS name',
        { tlsAuthMode: 'PKI', tlsClientAuthSanDns: '*.example' },
      ],
      [
        'PKI with a certificate',
        {
          tlsAuthMode: 'PKI',
          tlsClientAuthSanDns: 'a.example',
          certificatePem: 'CERT',
        },
      ],
      [
        'a TLS mode on an API key',
        { tlsAuthMode: 'SELF_SIGNED', credentialType: 'API_KEY' },
      ],
      [
        'a rule on an API key',
        { credentialType: 'API_KEY', tlsClientAuthSanDns: 'a.example' },
      ],
    ])('refuses %s with 400', async (_name, patch: Record<string, unknown>) => {
      const dto = { name: 'bad', ...patch } as Record<string, unknown>;
      if (dto.certificatePem === 'CERT') dto.certificatePem = device.pem;
      if (dto.certificatePem === 'KEY') {
        dto.certificatePem = `${device.pem}\n${device.privateKeyPem}`;
      }
      if (dto.certificateChain === 'CERT') dto.certificateChain = device.pem;
      await expect(
        service.createCredential(realm, 'nhi-1', dto as never),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.nhiCredential.create).not.toHaveBeenCalled();
    });

    it('refuses an expired certificate', async () => {
      await expect(
        service.createCredential(realm, 'nhi-1', {
          name: 'old',
          tlsAuthMode: 'SELF_SIGNED',
          certificatePem: expired.pem,
        }),
      ).rejects.toThrow(/expired/);
    });

    it(`caps an identity at ${MAX_LIVE_CERTIFICATE_CREDENTIALS} live certificates`, async () => {
      liveCount = MAX_LIVE_CERTIFICATE_CREDENTIALS;
      await expect(
        service.createCredential(realm, 'nhi-1', {
          name: 'eleventh',
          tlsAuthMode: 'SELF_SIGNED',
          certificatePem: device.pem,
        }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.nhiCredential.create).not.toHaveBeenCalled();
      // The count is of live certificate credentials of this identity only.
      expect(prisma.nhiCredential.count.mock.calls[0][0].where).toMatchObject({
        realmId: realm.id,
        nhiIdentityId: 'nhi-1',
        tlsAuthMode: { not: null },
        revoked: false,
      });
    });

    it('refuses a certificate the identity already has live', async () => {
      duplicateCount = 1;
      await expect(
        service.createCredential(realm, 'nhi-1', {
          name: 'again',
          tlsAuthMode: 'SELF_SIGNED',
          certificatePem: device.pem,
        }),
      ).rejects.toThrow(/already registered/);
    });

    it('answers a taken name with 409', async () => {
      prisma.nhiCredential.create.mockRejectedValueOnce({ code: 'P2002' });
      await expect(
        service.createCredential(realm, 'nhi-1', {
          name: 'device cert',
          tlsAuthMode: 'SELF_SIGNED',
          certificatePem: device.pem,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('refuses an identity of another realm', async () => {
      await expect(
        service.createCredential(
          { ...realm, id: 'realm-2' } as Realm,
          'nhi-1',
          {
            name: 'x',
            tlsAuthMode: 'SELF_SIGNED',
            certificatePem: device.pem,
          },
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('rotation with overlap', () => {
    const rotate = (dto: Record<string, unknown> = { certificatePem: 'NEW' }) =>
      service.rotateCredential(realm, 'nhi-1', 'old', {
        ...dto,
        ...(dto.certificatePem === 'NEW'
          ? { certificatePem: renewed.pem }
          : {}),
      } as never);

    it("creates the new credential and keeps the old one in grace for the policy's overlap, in one transaction", async () => {
      policy = { rotationOverlapSeconds: 3600 };
      const before = Date.now();
      const result = await rotate();

      expect(calls).toEqual([
        'begin',
        'lock',
        'count',
        'count',
        'create',
        'updateMany',
        'end',
      ]);
      expect(createdData()).toMatchObject({
        realmId: realm.id,
        nhiIdentityId: 'nhi-1',
        credentialType: 'CERTIFICATE',
        tlsAuthMode: 'SELF_SIGNED',
        certThumbprintS256: computeX5tS256(renewed.certificate.raw),
      });
      const update = prisma.nhiCredential.updateMany.mock.calls[0][0];
      expect(update.where).toEqual({
        id: 'old',
        realmId: realm.id,
        supersededById: null,
        revoked: false,
      });
      expect(update.data.supersededById).toBe('new');
      const grace = update.data.rotationGraceUntil.getTime();
      expect(grace).toBeGreaterThanOrEqual(before + 3600_000);
      expect(grace).toBeLessThanOrEqual(Date.now() + 3600_000);
      expect(result).toMatchObject({
        oldCredentialId: 'old',
        newCredential: { id: 'new', status: 'active' },
        oldCredential: { supersededById: 'new', status: 'grace' },
      });
      expect(
        prisma.nhiCredentialPolicy.findFirst.mock.calls[0][0].where,
      ).toEqual({
        realmId: realm.id,
        enabled: true,
        credentialType: 'CERTIFICATE',
      });
    });

    it('an explicit overlapSeconds wins; without a policy the default applies', async () => {
      policy = { rotationOverlapSeconds: 3600 };
      await rotate({ certificatePem: 'NEW', overlapSeconds: 0 });
      let update = prisma.nhiCredential.updateMany.mock.calls[0][0];
      expect(update.data.rotationGraceUntil.getTime()).toBeLessThanOrEqual(
        Date.now(),
      );

      policy = null;
      const before = Date.now();
      await rotate();
      update = prisma.nhiCredential.updateMany.mock.calls[1][0];
      expect(update.data.rotationGraceUntil.getTime()).toBeGreaterThanOrEqual(
        before + DEFAULT_ROTATION_OVERLAP_SECONDS * 1000,
      );
    });

    it('with no overlap the old credential is expired at once', async () => {
      const result = await rotate({ certificatePem: 'NEW', overlapSeconds: 0 });
      expect((result as any).oldCredential.status).toBe('expired');
    });

    it('counts the old credential against the cap (it stays live in grace)', async () => {
      liveCount = MAX_LIVE_CERTIFICATE_CREDENTIALS;
      await expect(rotate()).rejects.toThrow(ConflictException);
      expect(prisma.nhiCredential.create).not.toHaveBeenCalled();
      expect(calls).toEqual(['begin', 'lock', 'count', 'end']);
    });

    it('rolls back when the old credential was rotated or revoked meanwhile', async () => {
      superseded = 0;
      await expect(rotate()).rejects.toThrow(/meanwhile/);
      expect(calls[calls.length - 1]).toBe('end');
    });

    it.each([
      ['already rotated', { supersededById: 'other' }, /already rotated/],
      ['revoked', { revoked: true }, /revoked/],
      [
        'a legacy certificate without a tlsAuthMode',
        { tlsAuthMode: null },
        /can be rotated/,
      ],
      [
        'a JWT credential',
        { credentialType: 'JWT', tlsAuthMode: null },
        /can be rotated/,
      ],
    ])('refuses a credential that is %s', async (_n, patch, message) => {
      oldCredential = { ...oldCredential, ...patch };
      await expect(rotate()).rejects.toThrow(message);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('SELF_SIGNED rotation needs the new certificate, never a key', async () => {
      await expect(rotate({})).rejects.toThrow(BadRequestException);
      await expect(
        rotate({ certificatePem: `${renewed.pem}\n${renewed.privateKeyPem}` }),
      ).rejects.toThrow(/private key/);
    });

    it('PKI rotation keeps the old rule unless a new one is given', async () => {
      oldCredential = {
        ...oldCredential,
        tlsAuthMode: 'PKI',
        certThumbprintS256: null,
        certNotBefore: null,
        certNotAfter: null,
        tlsClientAuthSanDns: 'sensor-7.devices.example',
      };
      await rotate({});
      expect(createdData()).toMatchObject({
        tlsAuthMode: 'PKI',
        tlsClientAuthSanDns: 'sensor-7.devices.example',
      });
      await rotate({ tlsClientAuthSubjectDn: 'CN=sensor-7,O=Example' });
      expect(prisma.nhiCredential.create.mock.calls[1][0].data).toMatchObject({
        tlsClientAuthSubjectDn: 'CN=sensor-7,O=Example',
        tlsClientAuthSanDns: null,
      });
    });
  });
});
