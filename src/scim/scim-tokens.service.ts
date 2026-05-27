/**
 * SCIM Tokens Service
 * Manages SCIM provisioning tokens for authentication
 */

import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { randomBytes, createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { EventsService } from '../events/events.service.js';

export interface CreateScimTokenDto {
  name: string;
  description?: string;
  scopes?: string[];
  expiresAt?: Date;
}

export interface ScimTokenResponse {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  scopes: string[];
  createdAt: Date;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  requestCount: number;
  revoked: boolean;
  // The plain token - only returned once at creation time
  token?: string;
}

@Injectable()
export class ScimTokensService {
  private readonly logger = new Logger(ScimTokensService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsService: EventsService,
  ) {}

  /**
   * Create a new SCIM provisioning token
   * Returns the plain token which should be shown only once
   */
  async createToken(
    realmId: string,
    dto: CreateScimTokenDto,
  ): Promise<ScimTokenResponse> {
    // Check for existing token with same name
    const existing = await this.prisma.scimProvisioningToken.findFirst({
      where: { realmId, name: dto.name },
    });
    if (existing) {
      throw new ConflictException(
        `Token with name '${dto.name}' already exists`,
      );
    }

    // Generate a secure random token
    const plainToken = this.generateToken();
    const tokenHash = createHash('sha256').update(plainToken).digest('hex');

    const token = await this.prisma.scimProvisioningToken.create({
      data: {
        realmId,
        name: dto.name,
        description: dto.description,
        scopes: dto.scopes || [
          'urn:scim:schemas:core:1.0:Users',
          'urn:scim:schemas:core:1.0:Groups',
        ],
        expiresAt: dto.expiresAt,
        tokenHash,
        enabled: true,
      },
    });

    await this.eventsService.recordAdminEvent({
      realmId,
      adminUserId: 'system',
      operationType: 'CREATE',
      resourceType: 'SCIM_TOKEN',
      resourcePath: `/admin/realms/${realmId}/scim-tokens`,
      representation: { name: dto.name },
    });

    this.logger.log(`SCIM: Created token '${dto.name}' for realm ${realmId}`);

    return {
      ...token,
      token: plainToken, // Only returned once at creation
    };
  }

  /**
   * Get all SCIM tokens for a realm (without plain tokens)
   */
  async getTokens(
    realmId: string,
  ): Promise<Omit<ScimTokenResponse, 'token'>[]> {
    const tokens = await this.prisma.scimProvisioningToken.findMany({
      where: { realmId },
      orderBy: { createdAt: 'desc' },
    });

    return tokens.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      enabled: t.enabled,
      scopes: t.scopes,
      createdAt: t.createdAt,
      expiresAt: t.expiresAt,
      lastUsedAt: t.lastUsedAt,
      requestCount: t.requestCount,
      revoked: t.revoked,
    }));
  }

  /**
   * Get a specific token by ID
   */
  async getTokenById(
    realmId: string,
    tokenId: string,
  ): Promise<Omit<ScimTokenResponse, 'token'>> {
    const token = await this.prisma.scimProvisioningToken.findFirst({
      where: { id: tokenId, realmId },
    });

    if (!token) {
      throw new NotFoundException('Token not found');
    }

    return {
      id: token.id,
      name: token.name,
      description: token.description,
      enabled: token.enabled,
      scopes: token.scopes,
      createdAt: token.createdAt,
      expiresAt: token.expiresAt,
      lastUsedAt: token.lastUsedAt,
      requestCount: token.requestCount,
      revoked: token.revoked,
    };
  }

  /**
   * Revoke a SCIM token
   */
  async revokeToken(realmId: string, tokenId: string): Promise<void> {
    const token = await this.prisma.scimProvisioningToken.findFirst({
      where: { id: tokenId, realmId },
    });

    if (!token) {
      throw new NotFoundException('Token not found');
    }

    await this.prisma.scimProvisioningToken.update({
      where: { id: tokenId },
      data: {
        revoked: true,
        revokedAt: new Date(),
      },
    });

    await this.eventsService.recordAdminEvent({
      realmId,
      adminUserId: 'system',
      operationType: 'DELETE',
      resourceType: 'SCIM_TOKEN',
      resourcePath: `/admin/realms/${realmId}/scim-tokens/${tokenId}`,
      representation: { tokenId },
    });

    this.logger.log(`SCIM: Revoked token ${tokenId} in realm ${realmId}`);
  }

  /**
   * Enable or disable a SCIM token
   */
  async setTokenEnabled(
    realmId: string,
    tokenId: string,
    enabled: boolean,
  ): Promise<void> {
    const token = await this.prisma.scimProvisioningToken.findFirst({
      where: { id: tokenId, realmId },
    });

    if (!token) {
      throw new NotFoundException('Token not found');
    }

    await this.prisma.scimProvisioningToken.update({
      where: { id: tokenId },
      data: { enabled },
    });

    await this.eventsService.recordAdminEvent({
      realmId,
      adminUserId: 'system',
      operationType: 'UPDATE',
      resourceType: 'SCIM_TOKEN',
      resourcePath: `/admin/realms/${realmId}/scim-tokens/${tokenId}`,
      representation: { enabled },
    });

    this.logger.log(
      `SCIM: ${enabled ? 'Enabled' : 'Disabled'} token ${tokenId} in realm ${realmId}`,
    );
  }

  /**
   * Validate a raw token and return the associated token record
   */
  async validateToken(
    realmId: string,
    plainToken: string,
  ): Promise<import('@prisma/client').ScimProvisioningToken | null> {
    const tokenHash = createHash('sha256').update(plainToken).digest('hex');

    const token = await this.prisma.scimProvisioningToken.findUnique({
      where: { tokenHash },
      include: { realm: true },
    });

    if (!token) return null;

    if (token.realmId !== realmId) return null;
    if (token.revoked) return null;
    if (!token.enabled) return null;
    if (token.expiresAt && token.expiresAt < new Date()) return null;

    // Update usage stats
    await this.prisma.scimProvisioningToken.update({
      where: { id: token.id },
      data: {
        lastUsedAt: new Date(),
        requestCount: { increment: 1 },
      },
    });

    return token;
  }

  /**
   * Delete a SCIM token
   */
  async deleteToken(realmId: string, tokenId: string): Promise<void> {
    const token = await this.prisma.scimProvisioningToken.findFirst({
      where: { id: tokenId, realmId },
    });

    if (!token) {
      throw new NotFoundException('Token not found');
    }

    await this.prisma.scimProvisioningToken.delete({
      where: { id: tokenId },
    });

    await this.eventsService.recordAdminEvent({
      realmId,
      adminUserId: 'system',
      operationType: 'DELETE',
      resourceType: 'SCIM_TOKEN',
      resourcePath: `/admin/realms/${realmId}/scim-tokens/${tokenId}`,
      representation: { tokenId },
    });

    this.logger.log(`SCIM: Deleted token ${tokenId} in realm ${realmId}`);
  }

  /**
   * Generate a secure random token
   * Uses crypto.randomBytes for secure generation
   */
  private generateToken(): string {
    const chars =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~';
    const length = 32;
    // Rejection sampling: discard bytes at or above the largest multiple of
    // chars.length that fits in a byte, so `byte % chars.length` is unbiased
    // (CodeQL js/biased-cryptographic-random — a plain modulo over-weights the
    // first 256 % chars.length symbols).
    const limit = Math.floor(256 / chars.length) * chars.length;
    let token = '';
    while (token.length < length) {
      const buffer = randomBytes(length);
      for (let i = 0; i < buffer.length && token.length < length; i++) {
        if (buffer[i] < limit) {
          token += chars[buffer[i] % chars.length];
        }
      }
    }
    return token;
  }
}
