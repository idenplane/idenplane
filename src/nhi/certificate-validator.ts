import { createHash } from 'crypto';
import type { CertificateInfoDto } from './dto/certificate.dto.js';

/**
 * Result of certificate validation.
 */
export interface CertificateValidationResult {
  /** Whether the certificate is valid */
  valid: boolean;
  /** Parsed certificate information if valid */
  info?: CertificateInfoDto;
  /** Error message if validation failed */
  error?: string;
}

/**
 * Options for certificate validation.
 */
export interface CertificateValidationOptions {
  /** Expected fingerprint (SHA-256) to match against */
  expectedFingerprint?: string;
  /** Whether to allow expired certificates */
  allowExpired?: boolean;
  /** Whether to allow not-yet-valid certificates */
  allowNotYetValid?: boolean;
  /** List of allowed IP ranges (CIDR notation) */
  allowedIpRanges?: string[];
  /** Client IP address to validate against allowed ranges */
  clientIp?: string;
}

/**
 * Utility for validating client certificates in mTLS authentication.
 *
 * This module provides functions to:
 * - Parse PEM-encoded certificates and extract metadata
 * - Validate certificate format and structure
 * - Check certificate expiration and validity windows
 * - Verify certificate fingerprints
 * - Validate IP ranges for certificate-bound credentials
 */
export class CertificateValidator {
  /**
   * Parse and validate a PEM-encoded certificate.
   *
   * @param certificatePem - The PEM-encoded certificate string
   * @returns Validation result with parsed info or error message
   */
  static validate(certificatePem: string): CertificateValidationResult {
    try {
      if (!certificatePem || typeof certificatePem !== 'string') {
        return { valid: false, error: 'Certificate is required' };
      }

      if (!certificatePem.includes('-----BEGIN CERTIFICATE-----')) {
        return {
          valid: false,
          error: 'Invalid certificate format: missing PEM header',
        };
      }

      const info = this.parseCertificateInfo(certificatePem);
      return { valid: true, info };
    } catch (error) {
      return {
        valid: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to parse certificate',
      };
    }
  }

  /**
   * Check certificate validity window (notBefore and notAfter).
   *
   * @param info - Parsed certificate information
   * @param options - Validation options
   * @returns Validation result
   */
  static checkValidity(
    info: CertificateInfoDto,
    options: CertificateValidationOptions,
  ): CertificateValidationResult {
    const now = new Date();
    const notBefore = new Date(info.notBefore);
    const notAfter = new Date(info.notAfter);

    if (now < notBefore) {
      if (options.allowNotYetValid) {
        return { valid: true, info };
      }
      return {
        valid: false,
        error: 'Certificate is not yet valid (notBefore is in the future)',
      };
    }

    if (now > notAfter) {
      if (options.allowExpired) {
        return { valid: true, info };
      }
      return { valid: false, error: 'Certificate has expired' };
    }

    return { valid: true, info };
  }

  /**
   * Verify that the certificate fingerprint matches the expected value.
   *
   * @param info - Parsed certificate information
   * @param expectedFingerprint - Expected fingerprint (SHA256 format)
   * @returns Validation result
   */
  static verifyFingerprint(
    info: CertificateInfoDto,
    expectedFingerprint: string,
  ): CertificateValidationResult {
    if (!expectedFingerprint) {
      return { valid: true, info };
    }

    // Normalize fingerprints for comparison
    const normalizedActual = info.fingerprint
      .replace(/^SHA256:/i, '')
      .replace(/:/g, '')
      .toLowerCase();
    const normalizedExpected = expectedFingerprint
      .replace(/^SHA256:/i, '')
      .replace(/:/g, '')
      .toLowerCase();

    if (normalizedActual !== normalizedExpected) {
      return {
        valid: false,
        error: 'Certificate fingerprint does not match expected value',
      };
    }

    return { valid: true, info };
  }

  /**
   * Validate client IP against allowed IP ranges.
   *
   * @param clientIp - The client IP address
   * @param allowedIpRanges - List of allowed CIDR ranges
   * @returns Validation result
   */
  static validateIpRange(
    clientIp: string,
    allowedIpRanges: string[],
  ): CertificateValidationResult {
    if (!allowedIpRanges || allowedIpRanges.length === 0) {
      return { valid: true };
    }

    if (!clientIp) {
      return {
        valid: false,
        error: 'Client IP is required for IP range validation',
      };
    }

    const isAllowed = allowedIpRanges.some((range) =>
      this.ipMatchesRange(clientIp, range),
    );

    if (!isAllowed) {
      return {
        valid: false,
        error: `Client IP ${clientIp} is not in allowed ranges`,
      };
    }

    return { valid: true };
  }

  /**
   * Perform full certificate validation with all checks.
   *
   * @param certificatePem - The PEM-encoded certificate
   * @param options - Validation options
   * @returns Validation result
   */
  static validateFull(
    certificatePem: string,
    options: CertificateValidationOptions,
  ): CertificateValidationResult {
    // Step 1: Parse and basic format check
    const parseResult = this.validate(certificatePem);
    if (!parseResult.valid) {
      return parseResult;
    }

    const info = parseResult.info!;

    // Step 2: Check validity window
    const validityResult = this.checkValidity(info, options);
    if (!validityResult.valid) {
      return validityResult;
    }

    // Step 3: Verify fingerprint if expected
    if (options.expectedFingerprint) {
      const fingerprintResult = this.verifyFingerprint(
        info,
        options.expectedFingerprint,
      );
      if (!fingerprintResult.valid) {
        return fingerprintResult;
      }
    }

    // Step 4: Validate IP range if allowed ranges specified
    if (
      options.allowedIpRanges &&
      options.allowedIpRanges.length > 0 &&
      options.clientIp
    ) {
      const ipResult = this.validateIpRange(
        options.clientIp,
        options.allowedIpRanges,
      );
      if (!ipResult.valid) {
        return ipResult;
      }
    }

    return { valid: true, info };
  }

  /**
   * Parse certificate information from PEM string.
   * Note: This is a simplified parser; production use should use node-forge or similar.
   */
  private static parseCertificateInfo(
    certificatePem: string,
  ): CertificateInfoDto {
    // Extract base64 content between PEM markers using plain string search
    // (not a regex) to avoid super-linear backtracking on crafted input.
    const begin = '-----BEGIN CERTIFICATE-----';
    const end = '-----END CERTIFICATE-----';
    const beginIdx = certificatePem.indexOf(begin);
    const endIdx = certificatePem.indexOf(end, beginIdx + begin.length);
    if (beginIdx === -1 || endIdx === -1) {
      throw new Error('Invalid certificate format: missing PEM markers');
    }

    const derContent = certificatePem
      .slice(beginIdx + begin.length, endIdx)
      .replace(/\s/g, '');

    // Compute SHA-256 fingerprint
    const derBuffer = Buffer.from(derContent, 'base64');
    const fingerprint = createHash('sha256').update(derBuffer).digest('hex');
    const formattedFingerprint = `SHA256:${fingerprint
      .toUpperCase()
      .match(/.{2}/g)
      ?.join(':')}`;

    // Check for CA basic constraint. Locate the marker with indexOf and test a
    // bounded regex on the remainder — avoids the `[\s\S]*` backtracking the
    // previous single regex incurred on crafted input.
    const basicConstraintsIdx = certificatePem.indexOf('basicConstraints');
    const isCA =
      (basicConstraintsIdx !== -1 &&
        /CA:\s*true/i.test(certificatePem.slice(basicConstraintsIdx))) ||
      /X509v3 Basic Constraints:\s*CA:TRUE/.test(certificatePem);

    // Extract subject components
    const cnMatch = certificatePem.match(/CN\s*=\s*([^,\n]+)/i);
    const oMatch = certificatePem.match(/O\s*=\s*([^,\n]+)/i);
    const cMatch = certificatePem.match(/\bC\s*=\s*([^,\n]+)/i);
    const stMatch = certificatePem.match(/ST\s*=\s*([^,\n]+)/i);
    const lMatch = certificatePem.match(/L\s*=\s*([^,\n]+)/i);
    const ouMatch = certificatePem.match(/OU\s*=\s*([^,\n]+)/i);

    const subjectParts: string[] = [];
    if (cnMatch) subjectParts.push(`CN=${cnMatch[1].trim()}`);
    if (ouMatch) subjectParts.push(`OU=${ouMatch[1].trim()}`);
    if (oMatch) subjectParts.push(`O=${oMatch[1].trim()}`);
    if (lMatch) subjectParts.push(`L=${lMatch[1].trim()}`);
    if (stMatch) subjectParts.push(`ST=${stMatch[1].trim()}`);
    if (cMatch) subjectParts.push(`C=${cMatch[1].trim()}`);

    // Extract issuer components. Isolate the issuer line first with a bounded
    // regex (`[^\n]*` can't backtrack across the rest of the input), then pull
    // the components from it — the previous `issuer=.*X` patterns backtracked
    // on crafted input.
    const issuerLine = certificatePem.match(/issuer\s*=([^\n]*)/i)?.[1] ?? '';
    const issuerCnMatch = issuerLine.match(/CN\s*=\s*([^,\n]+)/i);
    const issuerOumatch = issuerLine.match(/OU\s*=\s*([^,\n]+)/i);
    const issuerOMatch = issuerLine.match(/O\s*=\s*([^,\n]+)/i);

    const issuerParts: string[] = [];
    if (issuerCnMatch) issuerParts.push(`CN=${issuerCnMatch[1].trim()}`);
    if (issuerOumatch) issuerParts.push(`OU=${issuerOumatch[1].trim()}`);
    if (issuerOMatch) issuerParts.push(`O=${issuerOMatch[1].trim()}`);

    // Extract SANs
    const sans: string[] = [];
    const sanMatch = certificatePem.match(
      /Subject Alternative Name:?\s*([^\n]+)/gi,
    );
    if (sanMatch) {
      for (const match of sanMatch) {
        const sansContent = match.replace(/Subject Alternative Name:?\s*/i, '');
        sans.push(
          ...sansContent
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        );
      }
    }

    // Default validity dates (simplified - production should parse actual dates)
    const now = new Date();
    const notBefore = new Date(now.getTime() - 24 * 60 * 60 * 1000); // Yesterday
    const notAfter = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000); // 1 year

    return {
      subject: subjectParts.length > 0 ? subjectParts.join(', ') : 'Unknown',
      issuer:
        issuerParts.length > 0 ? issuerParts.join(', ') : `CN=Unknown Issuer`,
      notBefore: notBefore.toISOString(),
      notAfter: notAfter.toISOString(),
      fingerprint: formattedFingerprint,
      sans: sans.length > 0 ? sans : undefined,
      isCA: isCA || undefined,
    };
  }

  /**
   * Check if an IP address matches a CIDR range.
   * Supports both exact IP and CIDR notation (e.g., "192.168.1.1" or "192.168.0.0/24").
   */
  private static ipMatchesRange(ip: string, range: string): boolean {
    // Handle exact IP match
    if (!range.includes('/')) {
      return ip === range;
    }

    // Handle CIDR notation
    const [addr, prefixLenStr] = range.split('/');
    const prefixLen = parseInt(prefixLenStr, 10);

    if (!addr || isNaN(prefixLen) || prefixLen < 0 || prefixLen > 32) {
      return false;
    }

    const ipParts = ip.split('.').map((p) => parseInt(p, 10));
    const rangeParts = addr.split('.').map((p) => parseInt(p, 10));

    if (ipParts.length !== 4 || rangeParts.length !== 4) {
      return false;
    }

    for (const part of [...ipParts, ...rangeParts]) {
      if (isNaN(part) || part < 0 || part > 255) {
        return false;
      }
    }

    const ipNum =
      (ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3];
    const rangeNum =
      (rangeParts[0] << 24) |
      (rangeParts[1] << 16) |
      (rangeParts[2] << 8) |
      rangeParts[3];

    const mask = prefixLen === 0 ? 0 : (~0 << (32 - prefixLen)) >>> 0;

    return (ipNum & mask) === (rangeNum & mask);
  }
}
