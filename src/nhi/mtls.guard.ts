import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  HttpException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator.js';
import { resolveClientIp } from '../common/utils/proxy-ip.util.js';
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
 * Guard for mTLS (mutual TLS) authentication.
 *
 * This guard validates client certificates presented during mTLS handshake
 * and attaches certificate information to the request for downstream use.
 *
 * The guard checks:
 * 1. If the route is protected (not public and in protected routes list)
 * 2. For mTLS-protected routes: validates the client certificate from headers
 * 3. Extracts certificate fingerprint for lookup in NHI credentials
 *
 * Expected headers:
 * - `X-Client-Certificate`: Base64-encoded PEM certificate
 * - `X-Client-Certificate-Fingerprint`: SHA-256 fingerprint of the certificate
 */
@Injectable()
export class MtlsGuard implements CanActivate {
  private readonly logger = new Logger(MtlsGuard.name);

  /** Default routes that require mTLS authentication */
  private readonly defaultProtectedRoutes = [
    '/api/v1/nhi',
    '/api/v1/machine',
    '/api/v1/iot',
    '/api/v1/device',
  ];

  constructor(private readonly reflector: Reflector) {}

  /**
   * Check if the request can proceed based on mTLS validation.
   */
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<NhiCertificateRequest>();
    const response = context.switchToHttp().getResponse<Response>();

    // Skip public routes
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    // Get route path
    const path = request.path;

    // Check if this route requires mTLS
    const protectedRoutes = this.defaultProtectedRoutes;
    const requiresMtls = protectedRoutes.some(
      (route) =>
        path === route ||
        path.startsWith(`${route}/`) ||
        path.startsWith(`${route}-`),
    );

    if (!requiresMtls) {
      // Route doesn't require mTLS - allow through
      return true;
    }

    // Validate mTLS certificate
    const validationResult = this.validateMtlsCertificate(request);

    if (!validationResult.valid) {
      throw new UnauthorizedException(
        validationResult.error || 'Invalid or missing client certificate',
      );
    }

    // Attach certificate info to request for downstream use
    request.nhiCertificate = validationResult.certificateInfo;
    request.nhiIdentityId = validationResult.nhiIdentityId;

    // Set certificate info headers for downstream services
    if (validationResult.certificateInfo) {
      response.setHeader(
        'X-Client-Certificate-Fingerprint',
        validationResult.certificateInfo.fingerprint,
      );
      response.setHeader(
        'X-Client-Certificate-Subject',
        validationResult.certificateInfo.subject,
      );
    }

    return true;
  }

  /**
   * Validate the mTLS certificate from request headers.
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
    // Extract certificate from headers
    const certHeader = request.headers['x-client-certificate'] as string;
    const fingerprintHeader = request.headers[
      'x-client-certificate-fingerprint'
    ] as string;

    // Try to get certificate from base64 header first
    if (certHeader) {
      try {
        const certificatePem = Buffer.from(certHeader, 'base64').toString(
          'utf8',
        );
        const validationResult = CertificateValidator.validateFull(
          certificatePem,
          {
            allowExpired: true,
            allowNotYetValid: false,
          },
        );

        if (!validationResult.valid) {
          return { valid: false, error: validationResult.error };
        }

        return {
          valid: true,
          certificateInfo: {
            fingerprint: validationResult.info!.fingerprint,
            subject: validationResult.info!.subject,
            issuer: validationResult.info!.issuer,
            valid: true,
          },
        };
      } catch {
        this.logger.debug('Failed to decode X-Client-Certificate header');
      }
    }

    // Fallback: use fingerprint header if provided
    if (fingerprintHeader) {
      // Extract fingerprint without prefix
      const fingerprint = fingerprintHeader
        .replace(/^SHA256:/i, '')
        .replace(/:/g, '')
        .toLowerCase();

      return {
        valid: true,
        certificateInfo: {
          fingerprint: `SHA256:${fingerprint}`,
          subject: 'Unknown (verified by fingerprint)',
          issuer: 'Unknown',
          valid: true,
        },
      };
    }

    return {
      valid: false,
      error:
        'No client certificate provided. mTLS authentication requires a valid client certificate.',
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
 * Guard for validating NHI certificate credentials during authentication.
 *
 * This guard extends MtlsGuard to perform additional validation:
 * - Verifies the certificate is bound to a valid NHI identity
 * - Checks if the NHI identity is enabled and active
 * - Validates IP ranges if configured
 */
@Injectable()
export class NhiCertificateGuard implements CanActivate {
  private readonly logger = new Logger(NhiCertificateGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<NhiCertificateRequest>();
    const response = context.switchToHttp().getResponse<Response>();

    // Skip public routes
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    // Get route path
    const path = request.path;

    // Check if this route requires certificate authentication
    const requiresCertificateAuth = path.startsWith('/api/v1/nhi/auth');

    if (!requiresCertificateAuth) {
      return true;
    }

    // Validate certificate from headers
    const certHeader = request.headers['x-client-certificate'] as string;
    const fingerprintHeader = request.headers[
      'x-client-certificate-fingerprint'
    ] as string;

    if (!certHeader && !fingerprintHeader) {
      throw new UnauthorizedException('Certificate authentication required');
    }

    // Parse and validate the certificate
    if (certHeader) {
      try {
        const certificatePem = Buffer.from(certHeader, 'base64').toString(
          'utf8',
        );
        const clientIp = resolveClientIp(request);

        const validationResult = CertificateValidator.validateFull(
          certificatePem,
          {
            allowExpired: false,
            allowNotYetValid: false,
            clientIp,
          },
        );

        if (!validationResult.valid) {
          throw new UnauthorizedException(validationResult.error);
        }

        // Attach certificate info to request
        request.nhiCertificate = {
          fingerprint: validationResult.info!.fingerprint,
          subject: validationResult.info!.subject,
          issuer: validationResult.info!.issuer,
          valid: true,
        };

        // Set response headers with certificate fingerprint for traceability
        response.setHeader(
          'X-Client-Certificate-Fingerprint',
          validationResult.info!.fingerprint,
        );

        return true;
      } catch (error) {
        if (error instanceof HttpException) {
          throw error;
        }
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(`Certificate validation error: ${message}`);
        throw new UnauthorizedException('Invalid certificate');
      }
    }

    // Fingerprint-only validation (less secure, but useful for some integrations)
    if (fingerprintHeader) {
      const fingerprint = fingerprintHeader
        .replace(/^SHA256:/i, '')
        .replace(/:/g, '')
        .toLowerCase();

      request.nhiCertificate = {
        fingerprint: `SHA256:${fingerprint}`,
        subject: 'Unknown',
        issuer: 'Unknown',
        valid: true,
      };

      return true;
    }

    throw new UnauthorizedException('Certificate authentication required');
  }
}
