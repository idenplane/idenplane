import 'reflect-metadata';
import type { Client } from '@prisma/client';
import { NhiClientCertificateResolver } from './nhi-client-certificate.resolver.js';
import { ClientCertificateResolverRegistry } from '../client-auth/client-certificate-resolver.js';
import { ClientTableCertificateResolver } from '../client-auth/client-table-certificate.resolver.js';
import { PkiPathValidator } from '../client-auth/pki-path-validator.js';
import { TlsTrustStore } from '../client-auth/tls-trust-store.js';
import {
  computeX5tS256,
  type PresentedClientCertificate,
} from '../mtls/client-certificate.source.js';
import {
  chain,
  issue,
  OIDS,
  type TestIdentity,
} from '../client-auth/__mocks__/test-pki.js';

const HOUR = 3_600_000;
const realm = { id: 'realm-1', mtlsClientAuthEnabled: true };

function presented(
  leaf: TestIdentity,
  intermediates: TestIdentity[] = [],
): PresentedClientCertificate {
  return {
    source: 'tls',
    certificate: leaf.certificate,
    der: leaf.certificate.raw,
    x5tS256: computeX5tS256(leaf.certificate.raw),
    chain: intermediates.map((i) => i.certificate),
  };
}

const nhiClient = (patch: Partial<Client> = {}) =>
  ({
    id: 'c-1',
    realmId: realm.id,
    clientId: 'nhi-device',
    clientType: 'CONFIDENTIAL',
    enabled: true,
    tokenEndpointAuthMethod: 'self_signed_tls_client_auth',
    tlsClientAuthSubjectDn: null,
    tlsClientAuthSanDns: null,
    tlsClientAuthSanUri: null,
    tlsClientAuthSanIp: null,
    tlsClientAuthSanEmail: null,
    tlsClientCertificateBoundAccessTokens: true,
    nhiIdentityId: 'nhi-1',
    ...patch,
  }) as unknown as Client;

interface Row {
  id: string;
  realmId: string;
  nhiIdentityId: string;
  tlsAuthMode: 'SELF_SIGNED' | 'PKI' | null;
  certThumbprintS256: string | null;
  certificatePem: string | null;
  enabled: boolean;
  revoked: boolean;
  expiresAt: Date | null;
  certNotBefore: Date | null;
  certNotAfter: Date | null;
  supersededById: string | null;
  rotationGraceUntil: Date | null;
  tlsClientAuthSubjectDn: string | null;
  tlsClientAuthSanDns: string | null;
  tlsClientAuthSanUri: string | null;
  tlsClientAuthSanIp: string | null;
  tlsClientAuthSanEmail: string | null;
}

function row(patch: Partial<Row>): Row {
  return {
    id: 'cred-1',
    realmId: realm.id,
    nhiIdentityId: 'nhi-1',
    tlsAuthMode: 'SELF_SIGNED',
    certThumbprintS256: null,
    certificatePem: null,
    enabled: true,
    revoked: false,
    expiresAt: null,
    certNotBefore: new Date(Date.now() - HOUR),
    certNotAfter: new Date(Date.now() + HOUR),
    supersededById: null,
    rotationGraceUntil: null,
    tlsClientAuthSubjectDn: null,
    tlsClientAuthSanDns: null,
    tlsClientAuthSanUri: null,
    tlsClientAuthSanIp: null,
    tlsClientAuthSanEmail: null,
    ...patch,
  };
}

/** The rows a findMany `where` of plain equalities selects. */
function matching(rows: Row[], where: Record<string, unknown>): Row[] {
  return rows.filter((r) =>
    Object.entries(where).every(
      ([key, value]) => r[key as keyof Row] === value,
    ),
  );
}

describe('NhiClientCertificateResolver', () => {
  let device: TestIdentity;
  let otherDevice: TestIdentity;
  let pki: Awaited<ReturnType<typeof chain>>;
  let credentials: Row[];
  let identity: { enabled: boolean; lifecycleStatus: string } | null;
  let anchors: { x5tS256: string; certificatePem: string }[];
  let revoked: {
    x5tS256: string | null;
    issuerDn: string | null;
    serialNumber: string | null;
  }[];
  let prisma: {
    nhiIdentity: { findFirst: jest.Mock };
    nhiCredential: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
    };
    realmTlsTrustAnchor: { findMany: jest.Mock };
    tlsRevokedCertificate: { findMany: jest.Mock; count: jest.Mock };
  };
  let config: { enabled: boolean; maxChainDepth: number };
  let audit: { recordAudit: jest.Mock };
  let registry: ClientCertificateResolverRegistry;
  let resolver: NhiClientCertificateResolver;

  beforeAll(async () => {
    device = await issue({ cn: 'device-1' });
    otherDevice = await issue({ cn: 'device-2' });
    pki = await chain({
      name: [{ O: ['Example'] }, { CN: ['sensor-7'] }],
      san: [{ type: 'dns', value: 'sensor-7.devices.example' }],
    });
  });

  beforeEach(() => {
    credentials = [
      row({
        id: 'self-1',
        certThumbprintS256: computeX5tS256(device.certificate.raw),
        certificatePem: device.pem,
      }),
    ];
    identity = { enabled: true, lifecycleStatus: 'ACTIVE' };
    anchors = [
      {
        x5tS256: computeX5tS256(pki.root.certificate.raw),
        certificatePem: pki.root.pem,
      },
    ];
    revoked = [];
    prisma = {
      nhiIdentity: {
        findFirst: jest.fn(async ({ where }) =>
          where.realmId === realm.id && where.id === 'nhi-1' ? identity : null,
        ),
      },
      nhiCredential: {
        findMany: jest.fn(async ({ where }) => matching(credentials, where)),
        findFirst: jest.fn(
          async ({ where }) => matching(credentials, where)[0] ?? null,
        ),
        update: jest.fn(async () => ({ id: 'x' })),
      },
      realmTlsTrustAnchor: { findMany: jest.fn(async () => anchors) },
      tlsRevokedCertificate: {
        findMany: jest.fn(async () => revoked),
        // isRevokedKey: OR of { x5tS256 } and { serialNumber, issuerDn }.
        count: jest.fn(
          async ({ where }) =>
            revoked.filter((r) =>
              (where.OR as Record<string, unknown>[]).some((c) =>
                Object.entries(c).every(
                  ([k, v]) => (r as Record<string, unknown>)[k] === v,
                ),
              ),
            ).length,
        ),
      },
    };
    audit = { recordAudit: jest.fn(async () => undefined) };
    config = { enabled: true, maxChainDepth: 5 };
    registry = new ClientCertificateResolverRegistry();
    resolver = new NhiClientCertificateResolver(
      prisma as never,
      new TlsTrustStore(prisma as never, config as never),
      new PkiPathValidator(),
      registry,
      config as never,
      audit as never,
    );
    resolver.onModuleInit();
  });

  const resolveSelfSigned = (
    certificate = device,
    client = nhiClient(),
    r: typeof realm = realm,
  ) =>
    resolver.resolve({
      realm: r,
      client,
      method: 'self_signed_tls_client_auth',
      certificate: presented(certificate),
    });

  it('registers itself', () => {
    expect(registry.resolvers()).toEqual([resolver]);
  });

  it('leaves a client that is not NHI-backed to other resolvers', async () => {
    await expect(
      resolveSelfSigned(device, nhiClient({ nhiIdentityId: null })),
    ).resolves.toBeNull();
    await expect(
      resolver.bindingActive({
        realm,
        client: nhiClient({ nhiIdentityId: null }),
        x5tS256: 'x',
      }),
    ).resolves.toBeNull();
  });

  it('the client-table resolver leaves an NHI-backed client alone, whatever the registration order', async () => {
    const table = new ClientTableCertificateResolver(
      {} as never,
      {} as never,
      new PkiPathValidator(),
      new ClientCertificateResolverRegistry(),
      config as never,
    );
    await expect(
      table.resolve({
        realm,
        client: nhiClient(),
        method: 'self_signed_tls_client_auth',
        certificate: presented(device),
      }),
    ).resolves.toBeNull();
  });

  describe('self_signed_tls_client_auth', () => {
    it('authenticates an exact thumbprint match and always binds tokens', async () => {
      await expect(resolveSelfSigned()).resolves.toEqual({
        clientId: 'nhi-device',
        method: 'self_signed_tls_client_auth',
        bindToCertificate: true,
        // The token names the credential that accepted the certificate.
        bindingClaims: { nhi_cid: 'self-1' },
      });
    });

    it('scopes every query by the realm and the identity', async () => {
      await resolveSelfSigned();
      expect(prisma.nhiIdentity.findFirst.mock.calls[0][0].where).toEqual({
        id: 'nhi-1',
        realmId: realm.id,
      });
      expect(prisma.nhiCredential.findMany.mock.calls[0][0].where).toEqual({
        realmId: realm.id,
        nhiIdentityId: 'nhi-1',
        tlsAuthMode: 'SELF_SIGNED',
        certThumbprintS256: computeX5tS256(device.certificate.raw),
      });
    });

    it('authenticates a credential in its rotation grace period', async () => {
      credentials[0] = {
        ...credentials[0],
        supersededById: 'self-2',
        rotationGraceUntil: new Date(Date.now() + HOUR),
      };
      await expect(resolveSelfSigned()).resolves.toMatchObject({
        bindToCertificate: true,
      });
    });

    it.each([
      [
        'past its grace period',
        {
          supersededById: 'self-2',
          rotationGraceUntil: new Date(Date.now() - 1),
        },
        'credential_expired',
      ],
      ['revoked', { revoked: true }, 'credential_revoked'],
      ['disabled', { enabled: false }, 'credential_disabled'],
      [
        'not yet valid',
        { certNotBefore: new Date(Date.now() + HOUR) },
        'credential_not_yet_valid',
      ],
      [
        'expired',
        { certNotAfter: new Date(Date.now() - 1) },
        'credential_expired',
      ],
      [
        'past expiresAt',
        { expiresAt: new Date(Date.now() - 1) },
        'credential_expired',
      ],
    ])('refuses a credential %s', async (_name, patch, reason) => {
      credentials[0] = { ...credentials[0], ...patch };
      await expect(resolveSelfSigned()).resolves.toEqual({ rejected: reason });
    });

    it('refuses a certificate no credential pins', async () => {
      await expect(resolveSelfSigned(otherDevice)).resolves.toEqual({
        rejected: 'no_matching_credential',
      });
    });

    it('fails closed for a legacy credential without a tlsAuthMode', async () => {
      credentials[0] = { ...credentials[0], tlsAuthMode: null };
      await expect(resolveSelfSigned()).resolves.toEqual({
        rejected: 'no_matching_credential',
      });
    });

    it('does not use a PKI credential for self_signed_tls_client_auth', async () => {
      credentials[0] = { ...credentials[0], tlsAuthMode: 'PKI' };
      await expect(resolveSelfSigned()).resolves.toEqual({
        rejected: 'no_matching_credential',
      });
    });

    it("never matches another realm's credential", async () => {
      credentials[0] = { ...credentials[0], realmId: 'realm-2' };
      await expect(resolveSelfSigned()).resolves.toEqual({
        rejected: 'no_matching_credential',
      });
    });

    it('refuses a deny-listed certificate', async () => {
      revoked = [
        {
          x5tS256: computeX5tS256(device.certificate.raw),
          issuerDn: null,
          serialNumber: null,
        },
      ];
      await expect(resolveSelfSigned()).resolves.toEqual({
        rejected: 'revoked',
      });
    });
  });

  describe('fail closed', () => {
    it.each(['SUSPENDED', 'PROVISIONING', 'DECOMMISSIONED'])(
      'refuses an identity that is %s',
      async (lifecycleStatus) => {
        identity = { enabled: true, lifecycleStatus };
        await expect(resolveSelfSigned()).resolves.toEqual({
          rejected: 'identity_inactive',
        });
      },
    );

    it('refuses a disabled identity', async () => {
      identity = { enabled: false, lifecycleStatus: 'ACTIVE' };
      await expect(resolveSelfSigned()).resolves.toEqual({
        rejected: 'identity_inactive',
      });
    });

    it('refuses an identity that is not in the realm', async () => {
      await expect(
        resolveSelfSigned(device, nhiClient({ nhiIdentityId: 'elsewhere' })),
      ).resolves.toEqual({ rejected: 'identity_not_found' });
    });

    it('refuses a client of another realm', async () => {
      await expect(
        resolveSelfSigned(device, nhiClient({ realmId: 'realm-2' })),
      ).resolves.toEqual({ rejected: 'realm_mismatch' });
    });

    it('refuses everything with MTLS_ENABLED off', async () => {
      config.enabled = false;
      await expect(resolveSelfSigned()).resolves.toEqual({
        rejected: 'mtls_disabled',
      });
    });

    it("refuses everything with the realm's mtlsClientAuthEnabled off", async () => {
      await expect(
        resolveSelfSigned(device, nhiClient(), {
          ...realm,
          mtlsClientAuthEnabled: false,
        }),
      ).resolves.toEqual({ rejected: 'mtls_disabled' });
      expect(prisma.nhiCredential.findMany).not.toHaveBeenCalled();
    });
  });

  describe('tls_client_auth (PKI)', () => {
    const pkiCredential = (patch: Partial<Row> = {}) =>
      row({
        id: 'pki-1',
        tlsAuthMode: 'PKI',
        certNotBefore: null,
        certNotAfter: null,
        tlsClientAuthSanDns: 'sensor-7.devices.example',
        ...patch,
      });
    const resolvePki = (leaf = pki.leaf, intermediates = [pki.intermediate]) =>
      resolver.resolve({
        realm,
        client: nhiClient({ tokenEndpointAuthMethod: 'tls_client_auth' }),
        method: 'tls_client_auth',
        certificate: presented(leaf, intermediates),
      });

    beforeEach(() => {
      credentials = [pkiCredential()];
    });

    it('authenticates a certificate that chains to the anchors and matches the rule', async () => {
      await expect(resolvePki()).resolves.toEqual({
        clientId: 'nhi-device',
        method: 'tls_client_auth',
        bindToCertificate: true,
        // The credential, and the certificate's issuer and serial for the
        // deny-list check at introspection.
        bindingClaims: {
          nhi_cid: 'pki-1',
          nhi_crt: {
            iss: '2.5.4.3=test intermediate,2.5.4.10=test pki',
            sn: expect.stringMatching(/^[0-9a-f]+$/),
          },
        },
      });
      expect(prisma.nhiCredential.findMany.mock.calls[0][0].where).toEqual({
        realmId: realm.id,
        nhiIdentityId: 'nhi-1',
        tlsAuthMode: 'PKI',
      });
    });

    it.each([
      [
        'subject DN',
        {
          tlsClientAuthSanDns: null,
          tlsClientAuthSubjectDn: 'CN=sensor-7,O=Example',
        },
      ],
      [
        'SAN dNSName, ignoring case',
        { tlsClientAuthSanDns: 'SENSOR-7.devices.example' },
      ],
    ])('matches a %s rule', async (_name, patch) => {
      credentials = [pkiCredential(patch)];
      await expect(resolvePki()).resolves.toMatchObject({
        bindToCertificate: true,
      });
    });

    it('refuses a certificate that matches no credential rule', async () => {
      credentials = [
        pkiCredential({ tlsClientAuthSanDns: 'sensor-8.devices.example' }),
      ];
      await expect(resolvePki()).resolves.toEqual({
        rejected: 'subject_mismatch',
      });
    });

    it('refuses a matching credential that is revoked, and accepts another one in grace', async () => {
      credentials = [pkiCredential({ revoked: true })];
      await expect(resolvePki()).resolves.toEqual({
        rejected: 'credential_revoked',
      });
      credentials.push(
        pkiCredential({
          id: 'pki-0',
          supersededById: 'pki-1',
          rotationGraceUntil: new Date(Date.now() + HOUR),
        }),
      );
      await expect(resolvePki()).resolves.toMatchObject({
        bindToCertificate: true,
      });
    });

    it('refuses a certificate that does not chain to the realm anchors', async () => {
      const stranger = await issue({
        cn: 'sensor-7',
        san: [{ type: 'dns', value: 'sensor-7.devices.example' }],
        eku: [OIDS.clientAuth],
      });
      const result = await resolvePki(stranger, []);
      expect(result).toHaveProperty('rejected');
      expect(result).not.toHaveProperty('clientId');
    });

    it('refuses everything when the realm has no trust anchor', async () => {
      anchors = [];
      await expect(resolvePki()).resolves.toEqual({
        rejected: 'no_trust_anchors',
      });
    });

    it('has nothing to match when the identity has no PKI credential', async () => {
      credentials = [];
      await expect(resolvePki()).resolves.toEqual({
        rejected: 'no_matching_credential',
      });
    });

    it('refuses a deny-listed leaf', async () => {
      revoked = [
        {
          x5tS256: computeX5tS256(pki.leaf.certificate.raw),
          issuerDn: null,
          serialNumber: null,
        },
      ];
      const result = await resolvePki();
      expect(result).toHaveProperty('rejected');
    });
  });

  describe('usage and audit', () => {
    it('records a successful use: one update of the credential and ACCESS_GRANTED', async () => {
      await resolveSelfSigned();
      expect(prisma.nhiCredential.update).toHaveBeenCalledWith({
        where: { id: 'self-1', realmId: realm.id },
        data: { lastUsedAt: expect.any(Date), requestCount: { increment: 1 } },
        select: { id: true },
      });
      expect(audit.recordAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          realmId: realm.id,
          nhiIdentityId: 'nhi-1',
          action: 'ACCESS_GRANTED',
          credentialId: 'self-1',
        }),
      );
    });

    it('records a refusal as ACCESS_DENIED with the reason', async () => {
      credentials[0] = { ...credentials[0], revoked: true };
      await resolveSelfSigned();
      expect(prisma.nhiCredential.update).not.toHaveBeenCalled();
      expect(audit.recordAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'ACCESS_DENIED',
          success: false,
          errorCode: 'credential_revoked',
        }),
      );
    });

    it('does not audit a refusal that says nothing about the identity', async () => {
      config.enabled = false;
      await resolveSelfSigned();
      expect(audit.recordAudit).not.toHaveBeenCalled();
    });

    it('a failed usage update never fails the authentication', async () => {
      prisma.nhiCredential.update.mockRejectedValueOnce(new Error('db down'));
      await expect(resolveSelfSigned()).resolves.toMatchObject({
        bindToCertificate: true,
      });
    });
  });

  describe('bindingActive (introspection)', () => {
    const x5t = () => computeX5tS256(device.certificate.raw);
    const ask = (
      patch: Partial<Client> = {},
      x5tS256: string | null = x5t(),
      r = realm,
      claims: Record<string, unknown> = { nhi_cid: 'self-1' },
    ) =>
      resolver.bindingActive({
        realm: r,
        client: nhiClient(patch),
        x5tS256,
        claims,
      });

    it('holds while the bound SELF_SIGNED credential is active or in grace', async () => {
      await expect(ask()).resolves.toBe(true);
      credentials[0] = {
        ...credentials[0],
        supersededById: 'self-2',
        rotationGraceUntil: new Date(Date.now() + HOUR),
      };
      await expect(ask()).resolves.toBe(true);
    });

    it('checks exactly the credential the token names, in this realm and identity', async () => {
      await ask();
      expect(prisma.nhiCredential.findFirst.mock.calls[0][0].where).toEqual({
        id: 'self-1',
        realmId: realm.id,
        nhiIdentityId: 'nhi-1',
      });
      await expect(ask({}, x5t(), realm, {})).resolves.toBe(false);
      await expect(ask({}, x5t(), realm, { nhi_cid: 'unknown' })).resolves.toBe(
        false,
      );
      // Another credential's thumbprint does not hold.
      await expect(ask({}, 'other-thumbprint')).resolves.toBe(false);
    });

    it('ends when the credential is revoked or its grace period ends', async () => {
      credentials[0] = { ...credentials[0], revoked: true };
      await expect(ask()).resolves.toBe(false);
      credentials[0] = {
        ...credentials[0],
        revoked: false,
        supersededById: 'self-2',
        rotationGraceUntil: new Date(Date.now() - 1),
      };
      await expect(ask()).resolves.toBe(false);
    });

    it('ends when the identity is suspended, the realm turns it off, or the certificate is deny-listed', async () => {
      identity = { enabled: true, lifecycleStatus: 'SUSPENDED' };
      await expect(ask()).resolves.toBe(false);
      identity = { enabled: true, lifecycleStatus: 'ACTIVE' };
      await expect(
        ask({}, x5t(), { ...realm, mtlsClientAuthEnabled: false }),
      ).resolves.toBe(false);
      revoked = [{ x5tS256: x5t(), issuerDn: null, serialNumber: null }];
      await expect(ask()).resolves.toBe(false);
    });

    it('SELF_SIGNED: a deny-list entry by issuer and serial ends it too', async () => {
      await expect(ask()).resolves.toBe(true);
      const issued = (await resolveSelfSigned()) as { bindingClaims?: unknown };
      expect(issued.bindingClaims).toEqual({ nhi_cid: 'self-1' });
      const { revocationKey } =
        await import('../client-auth/tls-trust-store.js');
      const key = revocationKey(device.certificate);
      revoked = [
        { x5tS256: null, issuerDn: key.issuer, serialNumber: key.serial },
      ];
      await expect(ask()).resolves.toBe(false);
    });

    it('an NHI token without cnf is never active', async () => {
      await expect(ask({}, null)).resolves.toBe(false);
    });

    describe('PKI', () => {
      const pkiClient = { tokenEndpointAuthMethod: 'tls_client_auth' as const };
      const pkiRow = (patch: Partial<Row>) =>
        row({
          tlsAuthMode: 'PKI',
          certNotBefore: null,
          certNotAfter: null,
          tlsClientAuthSanDns: 'x.example',
          ...patch,
        });
      const crt = { iss: 'CN=Issuing CA,O=Example', sn: '1a2b' };
      const askPki = (cid = 'pki-old') =>
        ask(pkiClient, 'leaf-thumbprint', realm, {
          nhi_cid: cid,
          nhi_crt: crt,
        });

      beforeEach(() => {
        credentials = [
          pkiRow({ id: 'pki-old' }),
          pkiRow({ id: 'pki-new', tlsClientAuthSanDns: 'y.example' }),
        ];
      });

      it('holds while the credential that issued the token is active', async () => {
        await expect(askPki()).resolves.toBe(true);
      });

      it('a revoked credential ends its tokens at once, even with another PKI credential live', async () => {
        credentials[0] = { ...credentials[0], revoked: true };
        await expect(askPki()).resolves.toBe(false);
        await expect(askPki('pki-new')).resolves.toBe(true);
      });

      it('a rotated-out credential holds through its grace period and ends after it', async () => {
        credentials[0] = {
          ...credentials[0],
          supersededById: 'pki-new',
          rotationGraceUntil: new Date(Date.now() + HOUR),
        };
        await expect(askPki()).resolves.toBe(true);
        credentials[0] = {
          ...credentials[0],
          rotationGraceUntil: new Date(Date.now() - 1),
        };
        await expect(askPki()).resolves.toBe(false);
      });

      it('checks the deny-list by thumbprint and by the issuer and serial in the token', async () => {
        revoked = [{ x5tS256: null, issuerDn: crt.iss, serialNumber: crt.sn }];
        await expect(askPki()).resolves.toBe(false);
        revoked = [
          { x5tS256: 'leaf-thumbprint', issuerDn: null, serialNumber: null },
        ];
        await expect(askPki()).resolves.toBe(false);
      });

      it('a SELF_SIGNED credential id does not hold a PKI token', async () => {
        credentials = [row({ id: 'self-1' })];
        await expect(askPki('self-1')).resolves.toBe(false);
      });
    });
  });
});
