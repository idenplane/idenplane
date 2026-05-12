/**
 * SCIM Authentication Guard
 * Validates Bearer tokens for SCIM API requests
 * RFC 7644 Section 2.2
 */

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import type { Request, Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service.js';

@Injectable()
export class ScimAuthGuard implements CanActivate {
  private readonly logger = new Logger(ScimAuthGuard.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    // Extract realm from path: /scim/v2/{realmName}/...
    const pathParts = request.path.split('/');
    const realmNameIndex = pathParts.findIndex((p) => p === 'scim') + 2; // Get realm name after /scim/v2
    const realmName = pathParts[realmNameIndex] || 'master';

    // Find realm and check SCIM is enabled
    const realm = await this.prisma.realm.findUnique({
      where: { name: realmName },
    });

    if (!realm) {
      throw new UnauthorizedException('Realm not found');
    }

    if (!realm.scimEnabled) {
      throw new UnauthorizedException(
        'SCIM provisioning is not enabled for this realm',
      );
    }

    // Extract Bearer token
    const authHeader = request.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        'Missing or invalid Authorization header',
      );
    }

    const token = authHeader.slice(7);
    if (!token || token.length < 8) {
      throw new UnauthorizedException('Invalid bearer token');
    }

    // Find and validate SCIM token
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const scimToken = await this.prisma.scimProvisioningToken.findUnique({
      where: { tokenHash },
      include: { realm: true },
    });

    if (!scimToken) {
      throw new UnauthorizedException('Invalid SCIM token');
    }

    if (scimToken.revoked) {
      throw new UnauthorizedException('SCIM token has been revoked');
    }

    if (scimToken.realmId !== realm.id) {
      throw new UnauthorizedException('SCIM token is not valid for this realm');
    }

    if (scimToken.expiresAt && scimToken.expiresAt < new Date()) {
      throw new UnauthorizedException('SCIM token has expired');
    }

    if (!scimToken.enabled) {
      throw new UnauthorizedException('SCIM token is disabled');
    }

    // Update token usage stats
    await this.prisma.scimProvisioningToken.update({
      where: { id: scimToken.id },
      data: {
        lastUsedAt: new Date(),
        requestCount: { increment: 1 },
      },
    });

    // Attach SCIM token info to request for downstream use
    (request as Request & { scimToken: typeof scimToken }).scimToken =
      scimToken;
    (request as Request & { scimRealm: typeof realm }).scimRealm = realm;

    return true;
  }
}
