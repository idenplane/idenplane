import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { TLSSocket } from 'node:tls';
import type { Request, Response } from 'express';
import { CertificateValidator } from './certificate-validator.js';

/**
 * Request type with NHI certificate information attached.
 */
export interface NhiCertificateRequest extends Request {
  nhiCertificate?: {
    fingerprint: string;
    subject: string;
    issuer: string;
    valid: boolean;
  };
  nhiIdentityId?: string;
}

/**
 * Options for mTLS guard configuration.
 */
export interface MtlsGuardOptions {
  /** Routes that require mTLS authentication */
  routes?: string[];
  /** Whether to allow expired certificates */
  allowExpired?: boolean;
  /** Whether to allow not-yet-valid certificates */
  allowNotYetValid?: boolean;
}

/**
 * Transport-level certificate gate for explicitly protected routes.
 * Requires a verified peer certificate from a direct TLS connection. HTTP
 * certificate/fingerprint headers are never trusted as proof of possession.
 * This gate does not bind a certificate to a tenant-scoped NHI credential.
 */
@Injectable()
export class MtlsGuard implements CanActivate {
  /** Default routes that require mTLS authentication */
  private readonly defaultProtectedRoutes = [
    '/api/v1/nhi',
    '/api/v1/machine',
    '/api/v1/iot',
    '/api/v1/device',
  ];

  /**
   * Check if the request can proceed based on mTLS validation.
   */
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<NhiCertificateRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    const requiresMtls = this.defaultProtectedRoutes.some(
      (route) =>
        request.path === route ||
        request.path.startsWith(`${route}/`) ||
        request.path.startsWith(`${route}-`),
    );
    if (!requiresMtls) return true;
    const result = this.validateMtlsCertificate(request);
    if (!result.valid)
      throw new UnauthorizedException(
        result.error || 'Verified TLS client certificate required',
      );
    request.nhiCertificate = result.certificateInfo;
    if (result.certificateInfo) {
      response.setHeader(
        'X-Client-Certificate-Fingerprint',
        result.certificateInfo.fingerprint,
      );
    }
    return true;
  }

  /**
   * Validate the peer certificate from the verified TLS connection.
   */
  private validateMtlsCertificate(request: NhiCertificateRequest): {
    valid: boolean;
    error?: string;
    certificateInfo?: {
      fingerprint: string;
      subject: string;
      issuer: string;
      valid: boolean;
    };
    nhiIdentityId?: string;
  } {
    const socket = request.socket;
    if (
      !(socket instanceof TLSSocket) ||
      !socket.encrypted ||
      !socket.authorized
    ) {
      return {
        valid: false,
        error:
          'A verified TLS client certificate is required; forwarded certificate headers are not authentication',
      };
    }
    const certificate = socket.getPeerX509Certificate();
    if (!certificate)
      return {
        valid: false,
        error: 'TLS peer did not provide a client certificate',
      };
    const result = CertificateValidator.validateFull(
      certificate.toString(),
      {},
    );
    if (!result.valid) return { valid: false, error: result.error };
    return {
      valid: true,
      certificateInfo: {
        fingerprint: result.info!.fingerprint,
        subject: result.info!.subject,
        issuer: result.info!.issuer,
        valid: true,
      },
    };
  }

  /**
   * Set custom protected routes for this guard instance.
   */
  setProtectedRoutes(routes: string[]): void {
    this.defaultProtectedRoutes.length = 0;
    this.defaultProtectedRoutes.push(...routes);
  }
}

/**
 * Fail-closed reservation for the unfinished NHI certificate auth path.
 * Enable only after tenant/credential binding, lifecycle and revocation checks
 * are implemented together with proof of private-key possession.
 */
@Injectable()
export class NhiCertificateGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<NhiCertificateRequest>();
    // Certificate metadata and a successful TLS handshake do not establish a
    // tenant-scoped, active NHI credential or its revocation status.
    // Keep this reserved auth path closed until that binding is implemented.
    // Public-route metadata must not bypass this dedicated authentication gate.
    if (request.path.startsWith('/api/v1/nhi/auth')) {
      throw new UnauthorizedException(
        'NHI certificate authentication is not enabled',
      );
    }
    return true;
  }
}
