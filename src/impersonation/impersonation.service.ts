import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { JwkService } from '../crypto/jwk.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { EventsService } from '../events/events.service.js';
import {
  LoginEventType,
  OperationType,
  ResourceType,
} from '../events/event-types.js';
import type { Realm } from '@prisma/client';
import type { JWTPayload } from 'jose';

export interface ImpersonationTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  impersonation_session_id: string;
}

@Injectable()
export class ImpersonationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwkService: JwkService,
    private readonly crypto: CryptoService,
    private readonly eventsService: EventsService,
  ) {}

  async startImpersonation(
    realm: Realm,
    adminUserId: string,
    targetUserId: string,
    ip?: string,
  ): Promise<ImpersonationTokenResponse> {
    // Check impersonation is enabled for this realm
    if (!realm.impersonationEnabled) {
      throw new ForbiddenException(
        'Impersonation is not enabled for this realm',
      );
    }

    // Validate target user exists and belongs to this realm
    const targetUser = await this.prisma.user.findUnique({
      where: { id: targetUserId },
    });

    if (!targetUser || targetUser.realmId !== realm.id) {
      throw new NotFoundException(`User '${targetUserId}' not found in realm`);
    }

    if (!targetUser.enabled) {
      throw new BadRequestException('Cannot impersonate a disabled user');
    }

    // Validate admin user exists.
    // When authenticated via static API key, adminUserId is 'api-key:...' (with fingerprint).
    // API key auth is already verified by AdminApiKeyGuard, so skip the DB lookup.
    if (!adminUserId.startsWith('api-key:')) {
      const adminUser = await this.prisma.user.findUnique({
        where: { id: adminUserId },
      });
      if (!adminUser) {
        throw new NotFoundException(`Admin user '${adminUserId}' not found`);
      }
      // Prevent self-impersonation
      if (adminUserId === targetUserId) {
        throw new BadRequestException('Cannot impersonate yourself');
      }
    }

    const maxDuration = realm.impersonationMaxDuration ?? 1800;

    // Create an OAuth session for the impersonation
    const session = await this.prisma.session.create({
      data: {
        userId: targetUserId,
        ipAddress: ip,
        expiresAt: new Date(Date.now() + maxDuration * 1000),
      },
    });

    // Record the impersonation session
    const impersonationSession = await this.prisma.impersonationSession.create({
      data: {
        realmId: realm.id,
        adminUserId,
        targetUserId,
        sessionId: session.id,
        active: true,
        expiresAt: new Date(Date.now() + maxDuration * 1000),
      },
    });

    const signingKey = await this.getActiveSigningKey(realm.id);

    // Build access token payload with impersonation claims (RFC 8693 act claim)
    const accessTokenPayload: JWTPayload = {
      iss: this.getIssuer(realm),
      sub: targetUserId,
      aud: realm.name,
      typ: 'Bearer',
      sid: session.id,
      // RFC 8693 actor claim — identifies the admin performing the impersonation
      act: { sub: adminUserId },
      // Custom impersonation marker
      impersonated: true,
    };

    const accessToken = await this.jwkService.signJwt(
      accessTokenPayload,
      signingKey.privateKey,
      signingKey.kid,
      maxDuration,
    );

    // Generate opaque refresh token (shorter lifespan matches impersonation window)
    const rawRefreshToken = this.crypto.generateSecret(64);
    const refreshTokenHash = this.crypto.sha256(rawRefreshToken);

    await this.prisma.refreshToken.create({
      data: {
        sessionId: session.id,
        tokenHash: refreshTokenHash,
        scope: 'openid',
        expiresAt: new Date(Date.now() + maxDuration * 1000),
        isOffline: false,
      },
    });

    // Audit log — login event visible in user event stream
    this.eventsService.recordLoginEvent({
      realmId: realm.id,
      type: LoginEventType.IMPERSONATION_START,
      userId: targetUserId,
      sessionId: session.id,
      ipAddress: ip,
      details: {
        impersonatorId: adminUserId,
        impersonationSessionId: impersonationSession.id,
      },
    });

    // Admin event for full audit trail
    this.eventsService.recordAdminEvent({
      realmId: realm.id,
      adminUserId,
      operationType: OperationType.CREATE,
      resourceType: ResourceType.IMPERSONATION,
      resourcePath: `users/${targetUserId}/impersonate`,
      representation: {
        impersonationSessionId: impersonationSession.id,
        targetUserId,
        adminUserId,
        expiresAt: impersonationSession.expiresAt,
      },
      ipAddress: ip,
    });

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: maxDuration,
      refresh_token: rawRefreshToken,
      impersonation_session_id: impersonationSession.id,
    };
  }

  async endImpersonation(
    realm: Realm,
    impersonationSessionId: string,
    adminUserId: string,
    ip?: string,
  ): Promise<void> {
    const impSession = await this.prisma.impersonationSession.findUnique({
      where: { id: impersonationSessionId },
    });

    if (!impSession || impSession.realmId !== realm.id) {
      throw new NotFoundException('Impersonation session not found');
    }

    if (impSession.adminUserId !== adminUserId) {
      throw new ForbiddenException('You do not own this impersonation session');
    }

    if (!impSession.active) {
      throw new BadRequestException('Impersonation session is already ended');
    }

    // Revoke all refresh tokens for the underlying OAuth session
    await this.prisma.refreshToken.updateMany({
      where: { sessionId: impSession.sessionId },
      data: { revoked: true },
    });

    // Delete the OAuth session (invalidates the access token scope)
    await this.prisma.session
      .delete({ where: { id: impSession.sessionId } })
      .catch(() => {
        // Session may already have been cleaned up — safe to ignore
      });

    // Mark the impersonation session as ended
    await this.prisma.impersonationSession.update({
      where: { id: impersonationSessionId },
      data: { active: false, endedAt: new Date() },
    });

    // Audit log
    this.eventsService.recordLoginEvent({
      realmId: realm.id,
      type: LoginEventType.IMPERSONATION_END,
      userId: impSession.targetUserId,
      sessionId: impSession.sessionId,
      ipAddress: ip,
      details: {
        impersonatorId: adminUserId,
        impersonationSessionId,
      },
    });

    this.eventsService.recordAdminEvent({
      realmId: realm.id,
      adminUserId,
      operationType: OperationType.DELETE,
      resourceType: ResourceType.IMPERSONATION,
      resourcePath: `impersonation/${impersonationSessionId}/end`,
      representation: {
        impersonationSessionId,
        targetUserId: impSession.targetUserId,
        adminUserId,
      },
      ipAddress: ip,
    });
  }

  // ─── Private helpers ────────────────────────────────────

  private async getActiveSigningKey(realmId: string) {
    const key = await this.prisma.realmSigningKey.findFirst({
      where: { realmId, active: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!key) {
      throw new Error('No active signing key found for realm');
    }
    return key;
  }

  private getIssuer(realm: Realm): string {
    const baseUrl = process.env['BASE_URL'] ?? 'http://localhost:3000';
    return `${baseUrl}/realms/${realm.name}`;
  }
}
