import 'reflect-metadata';
import type { Client } from '@prisma/client';
import { ClientTableCertificateResolver } from './client-table-certificate.resolver.js';
import { ClientCertificateResolverRegistry } from './client-certificate-resolver.js';
import { PkiPathValidator } from './pki-path-validator.js';
import { TlsTrustStore } from './tls-trust-store.js';
import {
  canonicalDn,
  certificateNames,
  parseDerName,
} from './distinguished-name.js';
import { normalizeSerial } from './certificate-pem.js';
import { computeX5tS256 } from '../mtls/client-certificate.source.js';
import type { PresentedClientCertificate } from '../mtls/client-certificate.source.js';
import { chain, issue, type TestIdentity } from './__mocks__/test-pki.js';

const DAY = 86_400_000;
const realm = { id: 'realm-1' };

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

const baseClient = {
  id: 'c-1',
  realmId: realm.id,
  clientId: 'device',
  clientType: 'CONFIDENTIAL',
  enabled: true,
  tokenEndpointAuthMethod: 'tls_client_auth',
  tlsClientAuthSubjectDn: null,
  tlsClientAuthSanDns: null,
  tlsClientAuthSanUri: null,
  tlsClientAuthSanIp: null,
  tlsClientAuthSanEmail: null,
  tlsClientCertificateBoundAccessTokens: false,
} as unknown as Client;

describe('ClientTableCertificateResolver', () => {
  let pki: Awaited<ReturnType<typeof chain>>;
  let prisma: {
    clientTlsCertificate: { findUnique: jest.Mock };
    realmTlsTrustAnchor: { findMany: jest.Mock };
    tlsRevokedCertificate: { findMany: jest.Mock };
  };
  let anchors: { x5tS256: string; certificatePem: string }[];
  let revoked: {
    x5tS256: string | null;
    issuerDn: string | null;
    serialNumber: string | null;
  }[];
  let registry: ClientCertificateResolverRegistry;
  let resolver: ClientTableCertificateResolver;

  beforeAll(async () => {
    pki = await chain({
      name: [{ O: ['Example'] }, { CN: ['device-1'] }],
      san: [{ type: 'dns', value: 'device-1.example.com' }],
    });
  });

  beforeEach(() => {
    anchors = [
      {
        x5tS256: computeX5tS256(pki.root.certificate.raw),
        certificatePem: pki.root.pem,
      },
    ];
    revoked = [];
    prisma = {
      clientTlsCertificate: { findUnique: jest.fn() },
      realmTlsTrustAnchor: { findMany: jest.fn(async () => anchors) },
      tlsRevokedCertificate: { findMany: jest.fn(async () => revoked) },
    };
    const config = { enabled: true, maxChainDepth: 5 } as never;
    registry = new ClientCertificateResolverRegistry();
    resolver = new ClientTableCertificateResolver(
      prisma as never,
      new TlsTrustStore(prisma as never, config),
      new PkiPathValidator(),
      registry,
      config,
    );
    resolver.onModuleInit();
  });

  it('registers itself', () => {
    expect(registry.resolvers()).toEqual([resolver]);
  });

  describe('tls_client_auth', () => {
    const pkiClient = (rules: Partial<Client>) =>
      ({ ...baseClient, ...rules }) as Client;
    const resolveWith = (
      client: Client,
      leaf = pki.leaf,
      chainCerts = [pki.intermediate],
    ) =>
      resolver.resolve({
        realm,
        client,
        method: 'tls_client_auth',
        certificate: presented(leaf, chainCerts),
      });

    it('accepts a chain to the realm anchor that matches the subject DN', async () => {
      expect(
        await resolveWith(
          pkiClient({
            tlsClientAuthSubjectDn: 'CN=device-1,O=Example',
            tlsClientCertificateBoundAccessTokens: true,
          }),
        ),
      ).toEqual({
        clientId: 'device',
        method: 'tls_client_auth',
        bindToCertificate: true,
      });
    });

    it('accepts a SAN rule', async () => {
      expect(
        await resolveWith(
          pkiClient({ tlsClientAuthSanDns: 'device-1.example.com' }),
        ),
      ).toMatchObject({ clientId: 'device' });
    });

    it('rejects a certificate that matches no rule', async () => {
      expect(
        await resolveWith(
          pkiClient({ tlsClientAuthSubjectDn: 'CN=device-2,O=Example' }),
        ),
      ).toEqual({ rejected: 'subject_mismatch' });
    });

    it('rejects a client with no rule or two rules', async () => {
      expect(await resolveWith(pkiClient({}))).toEqual({
        rejected: 'subject_rule_not_configured',
      });
      expect(
        await resolveWith(
          pkiClient({
            tlsClientAuthSubjectDn: 'CN=device-1,O=Example',
            tlsClientAuthSanDns: 'device-1.example.com',
          }),
        ),
      ).toEqual({ rejected: 'subject_rule_not_configured' });
    });

    it('rejects when the realm has no anchors', async () => {
      anchors = [];
      expect(
        await resolveWith(
          pkiClient({ tlsClientAuthSubjectDn: 'CN=device-1,O=Example' }),
        ),
      ).toEqual({ rejected: 'no_trust_anchors' });
    });

    it('rejects a certificate from another CA with the same subject', async () => {
      const other = await chain({
        name: [{ O: ['Example'] }, { CN: ['device-1'] }],
      });
      expect(
        await resolveWith(
          pkiClient({ tlsClientAuthSubjectDn: 'CN=device-1,O=Example' }),
          other.leaf,
          [other.intermediate],
        ),
      ).toEqual({ rejected: 'untrusted' });
    });

    it('rejects a leaf on the deny-list, by thumbprint or by issuer and serial', async () => {
      const client = pkiClient({
        tlsClientAuthSubjectDn: 'CN=device-1,O=Example',
      });
      revoked = [
        {
          x5tS256: computeX5tS256(pki.leaf.certificate.raw),
          issuerDn: null,
          serialNumber: null,
        },
      ];
      expect(await resolveWith(client)).toEqual({ rejected: 'revoked' });
      revoked = [
        {
          x5tS256: null,
          issuerDn: canonicalDn(
            parseDerName(certificateNames(pki.leaf.certificate.raw).issuer),
          ),
          serialNumber: normalizeSerial(pki.leaf.certificate.serialNumber)!,
        },
      ];
      expect(await resolveWith(client)).toEqual({ rejected: 'revoked' });
    });

    it('rejects a revoked intermediate', async () => {
      revoked = [
        {
          x5tS256: computeX5tS256(pki.intermediate.certificate.raw),
          issuerDn: null,
          serialNumber: null,
        },
      ];
      expect(
        await resolveWith(
          pkiClient({ tlsClientAuthSubjectDn: 'CN=device-1,O=Example' }),
        ),
      ).toEqual({ rejected: 'revoked' });
    });

    it('does not take an issuer+serial entry from another issuer', async () => {
      revoked = [
        {
          x5tS256: null,
          issuerDn: 'cn=someone else',
          serialNumber: normalizeSerial(pki.leaf.certificate.serialNumber)!,
        },
      ];
      expect(
        await resolveWith(
          pkiClient({ tlsClientAuthSubjectDn: 'CN=device-1,O=Example' }),
        ),
      ).toMatchObject({ clientId: 'device' });
    });

    it('uses the global anchors only when the realm opts in', async () => {
      anchors = [];
      const config = { enabled: true, maxChainDepth: 5 } as never;
      const store = new TlsTrustStore(prisma as never, config);
      (store as unknown as { globalAnchors: unknown[] }).globalAnchors = [
        pki.root.certificate,
      ];
      const withGlobal = new ClientTableCertificateResolver(
        prisma as never,
        store,
        new PkiPathValidator(),
        new ClientCertificateResolverRegistry(),
        config,
      );
      const client = pkiClient({
        tlsClientAuthSubjectDn: 'CN=device-1,O=Example',
      });
      const input = {
        client,
        method: 'tls_client_auth' as const,
        certificate: presented(pki.leaf, [pki.intermediate]),
      };
      expect(await withGlobal.resolve({ realm, ...input })).toEqual({
        rejected: 'no_trust_anchors',
      });
      expect(
        await withGlobal.resolve({
          realm: { ...realm, mtlsTrustGlobalAnchors: true },
          ...input,
        }),
      ).toMatchObject({ clientId: 'device' });
    });
  });

  describe('self_signed_tls_client_auth', () => {
    let self: TestIdentity;
    const client = {
      ...baseClient,
      tokenEndpointAuthMethod: 'self_signed_tls_client_auth',
    } as Client;

    beforeAll(async () => {
      self = await issue({ cn: 'pinned' });
    });

    const row = (overrides = {}) => ({
      realmId: realm.id,
      notBefore: new Date(Date.now() - DAY),
      notAfter: new Date(Date.now() + DAY),
      ...overrides,
    });
    const resolveSelf = () =>
      resolver.resolve({
        realm,
        client,
        method: 'self_signed_tls_client_auth',
        certificate: presented(self),
      });

    it('accepts a registered thumbprint inside its window', async () => {
      prisma.clientTlsCertificate.findUnique.mockResolvedValue(row());
      expect(await resolveSelf()).toEqual({
        clientId: 'device',
        method: 'self_signed_tls_client_auth',
        bindToCertificate: false,
      });
      expect(prisma.clientTlsCertificate.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            clientId_x5tS256: {
              clientId: 'c-1',
              x5tS256: computeX5tS256(self.certificate.raw),
            },
          },
        }),
      );
    });

    it('rejects an unregistered certificate', async () => {
      prisma.clientTlsCertificate.findUnique.mockResolvedValue(null);
      expect(await resolveSelf()).toEqual({ rejected: 'unregistered' });
    });

    it('rejects a row in another realm', async () => {
      prisma.clientTlsCertificate.findUnique.mockResolvedValue(
        row({ realmId: 'other' }),
      );
      expect(await resolveSelf()).toEqual({ rejected: 'unregistered' });
    });

    it('rejects outside the validity window', async () => {
      prisma.clientTlsCertificate.findUnique.mockResolvedValue(
        row({ notAfter: new Date(Date.now() - 1000) }),
      );
      expect(await resolveSelf()).toEqual({ rejected: 'expired' });
      prisma.clientTlsCertificate.findUnique.mockResolvedValue(
        row({ notBefore: new Date(Date.now() + DAY) }),
      );
      expect(await resolveSelf()).toEqual({ rejected: 'not_yet_valid' });
    });

    it('rejects a revoked certificate', async () => {
      prisma.clientTlsCertificate.findUnique.mockResolvedValue(row());
      revoked = [
        {
          x5tS256: computeX5tS256(self.certificate.raw),
          issuerDn: null,
          serialNumber: null,
        },
      ];
      expect(await resolveSelf()).toEqual({ rejected: 'revoked' });
    });
  });
});
