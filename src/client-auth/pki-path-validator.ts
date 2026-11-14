import 'reflect-metadata';
import { Injectable } from '@nestjs/common';
import type { X509Certificate } from 'node:crypto';
import {
  BasicConstraintsExtension,
  ExtendedKeyUsageExtension,
  KeyUsageFlags,
  KeyUsagesExtension,
  X509Certificate as ParsedCertificate,
} from '@peculiar/x509';
import { computeX5tS256 } from '../mtls/client-certificate.source.js';

/** Why a certificate path was refused. Internal: never sent to the client. */
export type PkiFailure =
  | 'malformed'
  | 'leaf_is_anchor'
  | 'leaf_is_ca'
  | 'untrusted'
  | 'chain_too_long'
  | 'expired'
  | 'not_yet_valid'
  | 'issuer_not_ca'
  | 'issuer_key_usage'
  | 'path_length_exceeded'
  | 'unknown_critical_extension'
  | 'name_constraints'
  | 'leaf_eku'
  | 'revoked';

export type PkiValidationResult =
  | { ok: true; /** Leaf first, anchor last. */ path: X509Certificate[] }
  | { ok: false; reason: PkiFailure };

export interface PkiValidationInput {
  leaf: X509Certificate;
  /** Intermediates the client presented, in any order. */
  intermediates: readonly X509Certificate[];
  /** The CAs the realm trusts. */
  anchors: readonly X509Certificate[];
  /** Most certificates in the path, anchor excluded (MTLS_MAX_CHAIN_DEPTH). */
  maxChainDepth: number;
  now?: Date;
  /** The realm's deny-list. */
  isRevoked?: (certificate: X509Certificate) => boolean;
}

const OID = {
  basicConstraints: '2.5.29.19',
  keyUsage: '2.5.29.15',
  extKeyUsage: '2.5.29.37',
  subjectAltName: '2.5.29.17',
  subjectKeyIdentifier: '2.5.29.14',
  authorityKeyIdentifier: '2.5.29.35',
  nameConstraints: '2.5.29.30',
  clientAuth: '1.3.6.1.5.5.7.3.2',
} as const;

/**
 * The extensions this validator processes. Any other extension marked
 * critical fails the path (RFC 5280 §4.2), certificate policies included:
 * policy processing is not implemented.
 */
const PROCESSED_EXTENSIONS = new Set<string>([
  OID.basicConstraints,
  OID.keyUsage,
  OID.extKeyUsage,
  OID.subjectAltName,
  OID.subjectKeyIdentifier,
  OID.authorityKeyIdentifier,
]);

/** Bound on signature checks per validation, whatever the anchors hold. */
const MAX_SIGNATURE_CHECKS = 256;

interface Node {
  certificate: X509Certificate;
  parsed: ParsedCertificate;
  anchor: boolean;
  /** subject == issuer (RFC 5280 "self-issued"). */
  selfIssued: boolean;
}

function parse(certificate: X509Certificate): ParsedCertificate {
  return new ParsedCertificate(certificate.raw);
}

/**
 * RFC 5280 §6 path validation, application level, for `tls_client_auth`.
 * Builds a path from the leaf through the presented intermediates to one of
 * the realm's anchors and checks, on every certificate: signature, validity
 * window, critical extensions and name constraints (unsupported, so
 * refused), the deny-list; on issuers: CA flag, keyCertSign, pathLen; on the
 * leaf: not a CA, and the clientAuth EKU when the EKU extension is present.
 *
 * Decisions: `anyExtendedKeyUsage` alone does not satisfy clientAuth; an
 * issuer without a keyUsage extension is accepted (RFC 5280 §6.1.4 (n)); the
 * anchor's own validity, CA flag and pathLen are checked too; the depth
 * counts the leaf and intermediates, not the anchor.
 */
@Injectable()
export class PkiPathValidator {
  validate(input: PkiValidationInput): PkiValidationResult {
    const now = input.now ?? new Date();
    let leaf: Node;
    let pool: Node[];
    try {
      leaf = this.node(input.leaf, false);
      pool = [
        // Anchors first, so the shortest trusted path is tried first.
        ...input.anchors.map((c) => this.node(c, true)),
        ...input.intermediates.map((c) => this.node(c, false)),
      ];
    } catch {
      return { ok: false, reason: 'malformed' };
    }
    const leafX5t = computeX5tS256(input.leaf.raw);
    if (input.anchors.some((a) => computeX5tS256(a.raw) === leafX5t)) {
      return { ok: false, reason: 'leaf_is_anchor' };
    }

    const signatureCache = new Map<string, boolean>();
    let checks = 0;
    const issues = (child: Node, parent: Node): boolean => {
      const key = `${child.certificate.fingerprint256}>${parent.certificate.fingerprint256}`;
      const cached = signatureCache.get(key);
      if (cached !== undefined) return cached;
      if (++checks > MAX_SIGNATURE_CHECKS) return false;
      let ok: boolean;
      try {
        ok =
          child.certificate.checkIssued(parent.certificate) &&
          child.certificate.verify(parent.certificate.publicKey);
      } catch {
        ok = false;
      }
      signatureCache.set(key, ok);
      return ok;
    };

    let firstFailure: PkiFailure | undefined;
    let tooLong = false;
    const visit = (path: Node[]): PkiValidationResult | undefined => {
      const tip = path[path.length - 1];
      for (const candidate of pool) {
        if (path.includes(candidate)) continue;
        // The same certificate presented as an intermediate and trusted as
        // an anchor is the anchor.
        if (
          !candidate.anchor &&
          pool.some(
            (p) =>
              p.anchor &&
              p.certificate.fingerprint256 ===
                candidate.certificate.fingerprint256,
          )
        ) {
          continue;
        }
        if (!issues(tip, candidate)) continue;
        if (candidate.anchor) {
          if (path.length > input.maxChainDepth) {
            tooLong = true;
            continue;
          }
          const full = [...path, candidate];
          const failure = this.check(full, now, input.isRevoked);
          if (!failure)
            return { ok: true, path: full.map((n) => n.certificate) };
          firstFailure ??= failure;
          continue;
        }
        if (path.length >= input.maxChainDepth) {
          tooLong = true;
          continue;
        }
        const found = visit([...path, candidate]);
        if (found) return found;
      }
      return undefined;
    };

    const found = visit([leaf]);
    if (found) return found;
    return {
      ok: false,
      reason: firstFailure ?? (tooLong ? 'chain_too_long' : 'untrusted'),
    };
  }

  private node(certificate: X509Certificate, anchor: boolean): Node {
    const parsed = parse(certificate);
    return {
      certificate,
      parsed,
      anchor,
      selfIssued: certificate.subject === certificate.issuer,
    };
  }

  /** The first rule a signature-linked path breaks, or `undefined`. */
  private check(
    path: Node[],
    now: Date,
    isRevoked: PkiValidationInput['isRevoked'],
  ): PkiFailure | undefined {
    for (const node of path) {
      const { certificate, parsed } = node;
      if (now < certificate.validFromDate) return 'not_yet_valid';
      if (now > certificate.validToDate) return 'expired';
      for (const extension of parsed.extensions) {
        if (extension.type === OID.nameConstraints) return 'name_constraints';
        if (extension.critical && !PROCESSED_EXTENSIONS.has(extension.type)) {
          return 'unknown_critical_extension';
        }
      }
      if (isRevoked?.(certificate)) return 'revoked';
    }

    const leaf = path[0].parsed;
    if (leaf.getExtension(BasicConstraintsExtension)?.ca) return 'leaf_is_ca';
    const eku = leaf.getExtension(ExtendedKeyUsageExtension);
    if (eku && !eku.usages.map(String).includes(OID.clientAuth)) {
      return 'leaf_eku';
    }

    // Issuers: index 1 .. anchor.
    for (let i = 1; i < path.length; i++) {
      const issuer = path[i].parsed;
      const constraints = issuer.getExtension(BasicConstraintsExtension);
      if (!constraints?.ca) return 'issuer_not_ca';
      const keyUsage = issuer.getExtension(KeyUsagesExtension);
      if (keyUsage && !(keyUsage.usages & KeyUsageFlags.keyCertSign)) {
        return 'issuer_key_usage';
      }
      if (constraints.pathLength !== undefined) {
        // Non-self-issued intermediates between this issuer and the leaf.
        const below = path.slice(1, i).filter((n) => !n.selfIssued).length;
        if (below > constraints.pathLength) return 'path_length_exceeded';
      }
    }
    return undefined;
  }
}
