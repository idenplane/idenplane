import 'reflect-metadata';
import type { X509Certificate } from 'node:crypto';
import { isIP } from 'node:net';
import {
  BasicConstraintsExtension,
  KeyUsageFlags,
  KeyUsagesExtension,
  SubjectAlternativeNameExtension,
  X509Certificate as ParsedCertificate,
} from '@peculiar/x509';
import {
  canonicalDn,
  certificateNames,
  parseDerName,
  parseRfc4514,
} from './distinguished-name.js';

const NAME_CONSTRAINTS = '2.5.29.30';
const KNOWN_CRITICAL = new Set([
  '2.5.29.19', // basicConstraints
  '2.5.29.15', // keyUsage
  '2.5.29.37', // extKeyUsage
  '2.5.29.17', // subjectAltName
  '2.5.29.14', // subjectKeyIdentifier
  '2.5.29.35', // authorityKeyIdentifier
]);

/**
 * Why a certificate cannot serve as a trust anchor, or `undefined` if it
 * can: it must be a CA (basicConstraints cA), allow keyCertSign when it has
 * a keyUsage, and carry nothing the path validator would refuse.
 */
export function isCaCertificate(
  certificate: X509Certificate,
): string | undefined {
  let parsed: ParsedCertificate;
  try {
    parsed = new ParsedCertificate(certificate.raw);
  } catch {
    return 'the certificate cannot be parsed';
  }
  if (!parsed.getExtension(BasicConstraintsExtension)?.ca) {
    return 'not a CA certificate (basicConstraints cA is not set)';
  }
  const keyUsage = parsed.getExtension(KeyUsagesExtension);
  if (keyUsage && !(keyUsage.usages & KeyUsageFlags.keyCertSign)) {
    return 'its keyUsage does not allow keyCertSign';
  }
  for (const extension of parsed.extensions) {
    if (extension.type === NAME_CONSTRAINTS) {
      return 'nameConstraints are not supported';
    }
    if (extension.critical && !KNOWN_CRITICAL.has(extension.type)) {
      return `unsupported critical extension ${extension.type}`;
    }
  }
  return undefined;
}

// ─── RFC 8705 §2.1.2 subject rules ───────────────────────────────────────────

/** The `tls_client_auth_*` metadata of a client, as stored. */
export interface TlsClientAuthRules {
  tlsClientAuthSubjectDn: string | null;
  tlsClientAuthSanDns: string | null;
  tlsClientAuthSanUri: string | null;
  tlsClientAuthSanIp: string | null;
  tlsClientAuthSanEmail: string | null;
}

export const TLS_CLIENT_AUTH_RULE_FIELDS = [
  'tlsClientAuthSubjectDn',
  'tlsClientAuthSanDns',
  'tlsClientAuthSanUri',
  'tlsClientAuthSanIp',
  'tlsClientAuthSanEmail',
] as const satisfies readonly (keyof TlsClientAuthRules)[];

export type TlsClientAuthRuleField =
  (typeof TLS_CLIENT_AUTH_RULE_FIELDS)[number];

/** The rules that are set (non-empty). */
export function configuredRules(
  rules: Partial<TlsClientAuthRules>,
): TlsClientAuthRuleField[] {
  return TLS_CLIENT_AUTH_RULE_FIELDS.filter((field) => {
    const value = rules[field];
    return typeof value === 'string' && value !== '';
  });
}

/** IPv4 as is, IPv6 in its canonical compressed form, else `undefined`. */
export function canonicalIp(text: string): string | undefined {
  const value = text.trim();
  const family = isIP(value);
  if (family === 4) return value;
  if (family === 6) {
    try {
      return new URL(`http://[${value}]/`).hostname.slice(1, -1);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

interface SanValues {
  dns: string[];
  uri: string[];
  ip: string[];
  email: string[];
}

function sanValues(certificate: X509Certificate): SanValues {
  const values: SanValues = { dns: [], uri: [], ip: [], email: [] };
  const extension = new ParsedCertificate(certificate.raw).getExtension(
    SubjectAlternativeNameExtension,
  );
  for (const name of extension?.names.toJSON() ?? []) {
    if (name.type === 'dns') values.dns.push(name.value);
    else if (name.type === 'url') values.uri.push(name.value);
    else if (name.type === 'email') values.email.push(name.value);
    else if (name.type === 'ip') {
      const ip = canonicalIp(name.value);
      if (ip) values.ip.push(ip);
    }
  }
  return values;
}

/**
 * Whether the certificate matches the one rule the client is registered
 * with (RFC 8705 §2.1.2). The subject DN is compared as parsed RDNs; a
 * dNSName ignores ASCII case, as DNS does; an IP address is compared in
 * canonical form; a URI and an email address must be exactly equal. No
 * wildcards. A client with no rule, or with more than one, never matches.
 */
export function matchesTlsClientAuthRule(
  certificate: X509Certificate,
  rules: TlsClientAuthRules,
): boolean {
  const configured = configuredRules(rules);
  if (configured.length !== 1) return false;
  const [field] = configured;
  const expected = rules[field]!;
  try {
    switch (field) {
      case 'tlsClientAuthSubjectDn':
        return (
          canonicalDn(
            parseDerName(certificateNames(certificate.raw).subject),
          ) === canonicalDn(parseRfc4514(expected))
        );
      case 'tlsClientAuthSanDns':
        return sanValues(certificate).dns.some(
          (dns) => dns.toLowerCase() === expected.toLowerCase(),
        );
      case 'tlsClientAuthSanUri':
        return sanValues(certificate).uri.includes(expected);
      case 'tlsClientAuthSanIp': {
        const ip = canonicalIp(expected);
        return ip !== undefined && sanValues(certificate).ip.includes(ip);
      }
      case 'tlsClientAuthSanEmail':
        return sanValues(certificate).email.includes(expected);
    }
  } catch {
    return false;
  }
}
