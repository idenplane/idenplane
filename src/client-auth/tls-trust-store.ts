import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { X509Certificate } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PrismaService } from '../prisma/prisma.service.js';
import { MTLS_CONFIG, type MtlsConfig } from '../mtls/mtls-config.js';
import { computeX5tS256 } from '../mtls/client-certificate.source.js';
import { normalizeSerial } from './certificate-pem.js';
import {
  canonicalDn,
  certificateNames,
  parseDerName,
} from './distinguished-name.js';
import { isCaCertificate } from './certificate-checks.js';

/**
 * The realm's certificate trust: its anchors (plus the global ones, when
 * the realm opts in) and its deny-list.
 *
 * Nothing here is cached across requests: a deleted anchor or a new
 * deny-list entry takes effect on the next request, on every instance.
 */
@Injectable()
export class TlsTrustStore implements OnModuleInit {
  private readonly logger = new Logger(TlsTrustStore.name);
  private globalAnchors: X509Certificate[] = [];
  /** Parsed anchors by thumbprint, so a PEM is parsed once per process. */
  private readonly parsed = new Map<string, X509Certificate>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MTLS_CONFIG) private readonly config: MtlsConfig,
  ) {}

  /**
   * Loads MTLS_GLOBAL_TRUST_ANCHORS_FILE. A file that cannot be read, holds
   * no certificate, or holds a non-CA certificate stops startup.
   */
  async onModuleInit(): Promise<void> {
    const file = this.config.globalTrustAnchorsFile;
    if (!this.config.enabled || !file) return;
    const text = await readFile(file, 'utf8');
    this.globalAnchors = parsePemBundle(text, file);
    this.logger.log(
      `Loaded ${this.globalAnchors.length} global mTLS trust anchor(s)`,
    );
  }

  /** The anchors `tls_client_auth` paths may end at, for this realm. */
  async anchors(realm: {
    id: string;
    mtlsTrustGlobalAnchors?: boolean;
  }): Promise<X509Certificate[]> {
    const rows = await this.prisma.realmTlsTrustAnchor.findMany({
      where: { realmId: realm.id },
      select: { x5tS256: true, certificatePem: true },
    });
    const anchors: X509Certificate[] = [];
    for (const row of rows) {
      let certificate = this.parsed.get(row.x5tS256);
      if (!certificate) {
        try {
          certificate = new X509Certificate(row.certificatePem);
        } catch {
          this.logger.error(
            `Trust anchor ${row.x5tS256} in realm ${realm.id} is unreadable; ignored`,
          );
          continue;
        }
        if (computeX5tS256(certificate.raw) !== row.x5tS256) continue;
        this.parsed.set(row.x5tS256, certificate);
      }
      anchors.push(certificate);
    }
    if (realm.mtlsTrustGlobalAnchors === true) {
      anchors.push(...this.globalAnchors);
    }
    return anchors;
  }

  /**
   * A synchronous deny-list check for these certificates, from one query:
   * a certificate is revoked when its thumbprint, or its issuer and serial
   * number, are listed.
   */
  async revocationCheck(
    realmId: string,
    certificates: readonly X509Certificate[],
  ): Promise<(certificate: X509Certificate) => boolean> {
    const keyOf = (c: X509Certificate) => {
      const serial = normalizeSerial(c.serialNumber) ?? '';
      let issuer = '';
      try {
        issuer = canonicalDn(parseDerName(certificateNames(c.raw).issuer));
      } catch {
        // An unreadable issuer cannot match an issuer entry.
      }
      return { x5t: computeX5tS256(c.raw), serial, issuer };
    };
    const keys = certificates.map(keyOf);
    const rows = await this.prisma.tlsRevokedCertificate.findMany({
      where: {
        realmId,
        OR: [
          { x5tS256: { in: keys.map((k) => k.x5t) } },
          { serialNumber: { in: keys.map((k) => k.serial).filter(Boolean) } },
        ],
      },
      select: { x5tS256: true, issuerDn: true, serialNumber: true },
    });
    const thumbprints = new Set(
      rows.flatMap((r) => (r.x5tS256 ? [r.x5tS256] : [])),
    );
    const issuerSerials = new Set(
      rows.flatMap((r) =>
        r.issuerDn && r.serialNumber ? [`${r.issuerDn}|${r.serialNumber}`] : [],
      ),
    );
    return (certificate) => {
      const key = keyOf(certificate);
      return (
        thumbprints.has(key.x5t) ||
        (key.serial !== '' &&
          key.issuer !== '' &&
          issuerSerials.has(`${key.issuer}|${key.serial}`))
      );
    };
  }
}

/** Every certificate in a PEM bundle; each must be a CA certificate. */
export function parsePemBundle(
  text: string,
  source: string,
): X509Certificate[] {
  if (/PRIVATE KEY/.test(text)) {
    throw new Error(`${source} contains a private key`);
  }
  const blocks =
    text.match(
      /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
    ) ?? [];
  if (blocks.length === 0) {
    throw new Error(`${source} contains no PEM certificate`);
  }
  return blocks.map((block, index) => {
    let certificate: X509Certificate;
    try {
      certificate = new X509Certificate(block);
    } catch {
      throw new Error(`${source}: certificate ${index + 1} is not valid X.509`);
    }
    const problem = isCaCertificate(certificate);
    if (problem) {
      throw new Error(`${source}: certificate ${index + 1}: ${problem}`);
    }
    return certificate;
  });
}
