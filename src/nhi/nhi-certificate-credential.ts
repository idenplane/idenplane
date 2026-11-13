import { BadRequestException } from '@nestjs/common';
import type { NhiTlsAuthMode } from '@prisma/client';
import {
  CertificatePemError,
  parseSingleCertificatePem,
  summarizeCertificate,
} from '../client-auth/certificate-pem.js';
import {
  configuredRules,
  TLS_CLIENT_AUTH_RULE_FIELDS,
  type TlsClientAuthRules,
} from '../client-auth/certificate-checks.js';
import { DistinguishedNameError } from '../client-auth/distinguished-name.js';
import {
  isValidSanDns,
  isValidSanEmail,
  isValidSanIp,
  isValidSanUri,
  isValidSubjectDn,
} from '../clients/client-auth-settings.js';
import {
  nhiCredentialStatus,
  type NhiCredentialStatus,
  type StatusCredential,
  type StatusIdentity,
} from './nhi-credential-status.js';

/** Rotation overlap when no policy sets one: 24 hours. */
export const DEFAULT_ROTATION_OVERLAP_SECONDS = 86_400;

/** The certificate and rule input of a create or a rotation. */
export interface CertificateCredentialInput extends Partial<
  Record<keyof TlsClientAuthRules, string | null>
> {
  certificatePem?: string;
}

/** The columns a certificate credential stores for its mode. */
export interface CertificateCredentialFields extends TlsClientAuthRules {
  tlsAuthMode: NhiTlsAuthMode | null;
  certificatePem: string | null;
  certThumbprintS256: string | null;
  certSubject: string | null;
  certIssuer: string | null;
  certSerialNumber: string | null;
  certNotBefore: Date | null;
  certNotAfter: Date | null;
}

const RULE_FORMATS: Record<
  keyof TlsClientAuthRules,
  [(value: unknown) => boolean, string]
> = {
  tlsClientAuthSubjectDn: [isValidSubjectDn, 'an RFC 4514 distinguished name'],
  tlsClientAuthSanDns: [isValidSanDns, 'a DNS name without wildcards'],
  tlsClientAuthSanUri: [isValidSanUri, 'an absolute URI'],
  tlsClientAuthSanIp: [isValidSanIp, 'an IPv4 or IPv6 address'],
  tlsClientAuthSanEmail: [isValidSanEmail, 'an email address'],
};

const NO_RULES: TlsClientAuthRules = {
  tlsClientAuthSubjectDn: null,
  tlsClientAuthSanDns: null,
  tlsClientAuthSanUri: null,
  tlsClientAuthSanIp: null,
  tlsClientAuthSanEmail: null,
};

const NO_CERTIFICATE = {
  certificatePem: null,
  certThumbprintS256: null,
  certSubject: null,
  certIssuer: null,
  certSerialNumber: null,
  certNotBefore: null,
  certNotAfter: null,
};

function readCertificate(pem: unknown) {
  try {
    return summarizeCertificate(parseSingleCertificatePem(pem));
  } catch (err) {
    if (err instanceof CertificatePemError) {
      throw new BadRequestException(err.message);
    }
    if (err instanceof DistinguishedNameError) {
      throw new BadRequestException(`certificatePem: ${err.message}`);
    }
    throw err;
  }
}

function certificateColumns(pem: unknown) {
  const certificate = readCertificate(pem);
  return {
    certificatePem: certificate.pem,
    certThumbprintS256: certificate.x5tS256,
    certSubject: certificate.subject,
    certIssuer: certificate.issuer,
    certSerialNumber: certificate.serialNumber || null,
    certNotBefore: certificate.notBefore,
    certNotAfter: certificate.notAfter,
  };
}

/**
 * The columns for a certificate credential of this mode, from validated
 * input:
 *
 * - SELF_SIGNED: exactly one certificate (no key, no chain), not expired,
 *   and no subject rule.
 * - PKI: exactly one subject/SAN rule (RFC 8705 §2.1.2) and no
 *   certificate: any certificate the realm's anchors issue that matches the
 *   rule authenticates.
 * - none (legacy): a certificate is optional and recorded with its
 *   thumbprint; the credential never authenticates a client.
 */
export function certificateCredentialFields(
  mode: NhiTlsAuthMode | null,
  input: CertificateCredentialInput,
): CertificateCredentialFields {
  const rules = configuredRules(input);
  if (mode === 'PKI') {
    if (input.certificatePem !== undefined) {
      throw new BadRequestException(
        'A PKI credential names a subject rule, not a certificate; the realm trust anchors issue its certificates',
      );
    }
    if (rules.length !== 1) {
      throw new BadRequestException(
        `A PKI credential needs exactly one of ${TLS_CLIENT_AUTH_RULE_FIELDS.join(', ')}; ${rules.length} set`,
      );
    }
    const [field] = rules;
    const [valid, format] = RULE_FORMATS[field];
    if (!valid(input[field])) {
      throw new BadRequestException(`${field} must be ${format}`);
    }
    return {
      tlsAuthMode: 'PKI',
      ...NO_CERTIFICATE,
      ...NO_RULES,
      [field]: input[field],
    };
  }
  if (rules.length > 0) {
    throw new BadRequestException(
      `${rules.join(', ')} apply only to tlsAuthMode PKI`,
    );
  }
  if (mode === 'SELF_SIGNED') {
    if (input.certificatePem === undefined) {
      throw new BadRequestException(
        'A SELF_SIGNED credential needs certificatePem',
      );
    }
    const columns = certificateColumns(input.certificatePem);
    if (columns.certNotAfter.getTime() <= Date.now()) {
      throw new BadRequestException('The certificate has expired');
    }
    return { tlsAuthMode: 'SELF_SIGNED', ...columns, ...NO_RULES };
  }
  return {
    tlsAuthMode: null,
    ...(input.certificatePem !== undefined
      ? certificateColumns(input.certificatePem)
      : NO_CERTIFICATE),
    ...NO_RULES,
  };
}

/** A non-certificate credential takes no TLS field. */
export function assertNoTlsFields(input: CertificateCredentialInput): void {
  const rules = configuredRules(input);
  if (rules.length > 0) {
    throw new BadRequestException(
      `${rules.join(', ')} apply only to certificate credentials`,
    );
  }
}

export function pickRules(rules: TlsClientAuthRules): TlsClientAuthRules {
  return {
    tlsClientAuthSubjectDn: rules.tlsClientAuthSubjectDn,
    tlsClientAuthSanDns: rules.tlsClientAuthSanDns,
    tlsClientAuthSanUri: rules.tlsClientAuthSanUri,
    tlsClientAuthSanIp: rules.tlsClientAuthSanIp,
    tlsClientAuthSanEmail: rules.tlsClientAuthSanEmail,
  };
}

/**
 * A credential as the admin API returns it: with its computed status when
 * it is a certificate credential with a TLS mode, `null` otherwise.
 */
export function withStatus<
  T extends StatusCredential & { tlsAuthMode: NhiTlsAuthMode | null },
>(
  credential: T,
  identity: StatusIdentity,
): T & { status: NhiCredentialStatus | null } {
  return {
    ...credential,
    status: credential.tlsAuthMode
      ? nhiCredentialStatus(credential, identity)
      : null,
  };
}
