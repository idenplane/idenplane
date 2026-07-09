import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import type { Realm } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { JwkService } from '../crypto/jwk.service.js';
import { ScopesService } from '../scopes/scopes.service.js';
import { resolveUserClaims } from '../scopes/claims.resolver.js';
import { CustomAttributesService } from '../custom-attributes/custom-attributes.service.js';
import { TokenBlacklistService } from './token-blacklist.service.js';
import { BackchannelLogoutService } from './backchannel-logout.service.js';
import { EventsService } from '../events/events.service.js';
import { LoginEventType } from '../events/event-types.js';
import { matchesRedirectUri } from '../common/redirect-uri.utils.js';

@Injectable()
export class TokensService {
  private readonly logger = new Logger(TokensService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly jwkService: JwkService,
    private readonly scopesService: ScopesService,
    private readonly blacklist: TokenBlacklistService,
    private readonly backchannelLogout: BackchannelLogoutService,
    private readonly eventsService: EventsService,
    private readonly customAttributesService: CustomAttributesService,
  ) {}

  async introspect(realm: Realm, token: string) {
    try {
      const signingKey = await this.prisma.realmSigningKey.findFirst({
        where: { realmId: realm.id, active: true },
        orderBy: { createdAt: 'desc' },
      });

      if (!signingKey) {
        return { active: false };
      }

      const payload = await this.jwkService.verifyJwt(
        token,
        signingKey.publicKey,
      );

      // Check token blacklist
      const jti = payload['jti'];
      if (jti && (await this.blacklist.isBlacklisted(jti))) {
        return { active: false };
      }

      // Check session validity (logout deletes sessions).
      // client_credentials tokens have no session — skip the check when sid
      // is absent so that service-account tokens do not introspect as inactive.
      const sid = payload['sid'] as string | undefined;
      if (sid) {
        const session = await this.prisma.session.findUnique({
          where: { id: sid },
        });
        if (!session) {
          return { active: false };
        }
      }

      // Look up the user identified by `sub` so we can include their current
      // username in the response.  RFC 7662 §2.2 recommends including
      // `username` when the resource server needs it, and many clients rely
      // on it being present even when the claim is not embedded in the JWT.
      const sub = payload.sub;
      let username: string | undefined;
      const active = true;
      if (sub) {
        const user = await this.prisma.user.findUnique({
          where: { id: sub },
          select: { username: true, enabled: true },
        });
        if (!user) {
          // User was deleted after token was issued
          return { active: false };
        }
        if (!user.enabled) {
          // User is disabled
          return { active: false };
        }
        username = user.username;
      }

      // azp (authorized party) identifies the client the token was issued to.
      // RFC 7662 / OIDC clients rely on it (and client_id) to verify audience.
      const azp = payload['azp'] as string | undefined;

      return {
        active,
        sub: payload.sub,
        iss: payload.iss,
        aud: payload.aud,
        exp: payload.exp,
        iat: payload.iat,
        scope: payload['scope'],
        azp,
        client_id: azp,
        username,
        preferred_username: payload['preferred_username'],
        email: payload['email'],
        realm_access: payload['realm_access'],
        resource_access: payload['resource_access'],
      };
    } catch {
      // Not a verifiable JWT (access/id token). Treat it as an opaque refresh
      // token so introspection (RFC 7662) also covers refresh tokens — a valid
      // refresh token must report active:true, not false.
      return this.introspectRefreshToken(realm, token);
    }
  }

  private async introspectRefreshToken(realm: Realm, token: string) {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.crypto.sha256(token) },
      include: { session: { include: { user: true } } },
    });

    if (!stored || stored.revoked || stored.expiresAt < new Date()) {
      return { active: false };
    }

    const user = stored.session?.user;
    if (!user || !user.enabled || user.realmId !== realm.id) {
      return { active: false };
    }

    return {
      active: true,
      token_type: 'refresh_token',
      sub: user.id,
      username: user.username,
      preferred_username: user.username,
      // azp/client_id let the controller's ownership check confirm the caller
      // is the client the token was issued to.
      azp: stored.clientId ?? undefined,
      client_id: stored.clientId ?? undefined,
      scope: stored.scope ?? undefined,
      exp: Math.floor(stored.expiresAt.getTime() / 1000),
      iat: Math.floor(stored.createdAt.getTime() / 1000),
    };
  }

  /**
   * Verify that the given token was issued to `callerClientId`.
   *
   * For refresh tokens the ownership check is done against the stored record's
   * clientId column.  For access tokens (JWTs) the azp / aud claim is used.
   * Throws ForbiddenException when the token belongs to a different client so
   * that a public client cannot revoke another client's tokens.
   */
  async assertTokenBelongsToClient(
    realm: Realm,
    token: string,
    callerClientId: string,
    tokenTypeHint?: string,
  ): Promise<void> {
    // --- Refresh token check ---
    if (tokenTypeHint === 'refresh_token' || !tokenTypeHint) {
      const tokenHash = this.crypto.sha256(token);
      const storedToken = await this.prisma.refreshToken.findUnique({
        where: { tokenHash },
        select: { clientId: true },
      });

      if (storedToken) {
        if (storedToken.clientId && storedToken.clientId !== callerClientId) {
          throw new ForbiddenException({
            error: 'access_denied',
            error_description: 'The token was not issued to this client.',
          });
        }
        // Token belongs to caller (or has no stored clientId) — allow.
        return;
      }
    }

    // --- Access token (JWT) check ---
    if (tokenTypeHint === 'access_token' || !tokenTypeHint) {
      try {
        const signingKey = await this.prisma.realmSigningKey.findFirst({
          where: { realmId: realm.id, active: true },
          orderBy: { createdAt: 'desc' },
        });
        if (signingKey) {
          const payload = await this.jwkService.verifyJwt(
            token,
            signingKey.publicKey,
          );
          const p = payload as Record<string, unknown>;
          const azp = p['azp'] as string | undefined;
          const aud = p['aud'];
          const audiences: string[] = azp
            ? [azp]
            : Array.isArray(aud)
              ? (aud as string[])
              : aud
                ? [aud as string]
                : [];

          if (audiences.length > 0 && !audiences.includes(callerClientId)) {
            throw new ForbiddenException({
              error: 'access_denied',
              error_description: 'The token was not issued to this client.',
            });
          }
        }
      } catch (err) {
        if (err instanceof ForbiddenException) throw err;
        // Expired/invalid JWT — nothing to revoke, fall through silently.
      }
    }
  }

  async revoke(realm: Realm, token: string, tokenTypeHint?: string) {
    if (tokenTypeHint === 'refresh_token' || !tokenTypeHint) {
      const tokenHash = this.crypto.sha256(token);
      const storedToken = await this.prisma.refreshToken.findUnique({
        where: { tokenHash },
      });

      if (storedToken) {
        await this.prisma.refreshToken.update({
          where: { id: storedToken.id },
          data: { revoked: true },
        });
        return;
      }
    }

    // For access tokens (JWTs), blacklist them by jti
    if (tokenTypeHint === 'access_token' || !tokenTypeHint) {
      try {
        const signingKey = await this.prisma.realmSigningKey.findFirst({
          where: { realmId: realm.id, active: true },
          orderBy: { createdAt: 'desc' },
        });
        if (signingKey) {
          const payload = await this.jwkService.verifyJwt(
            token,
            signingKey.publicKey,
          );
          const jti = payload['jti'];
          const exp = payload.exp;
          if (jti && exp) {
            await this.blacklist.blacklistToken(jti, exp);
          }
        }
      } catch {
        // Token is already invalid/expired, nothing to blacklist
      }
    }
  }

  async logout(realm: Realm, ip?: string, refreshToken?: string) {
    if (!refreshToken) {
      // No refresh token provided — nothing to revoke, return gracefully
      return;
    }

    const tokenHash = this.crypto.sha256(refreshToken);
    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { session: true },
    });

    if (!storedToken) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    await this.endSession(
      realm,
      storedToken.sessionId,
      storedToken.session.userId,
      ip,
    );
  }

  async logoutByIdToken(realm: Realm, ip?: string, idTokenHint?: string) {
    if (!idTokenHint) {
      // No id_token_hint — best-effort logout, nothing to revoke
      return;
    }

    try {
      const signingKey = await this.prisma.realmSigningKey.findFirst({
        where: { realmId: realm.id, active: true },
        orderBy: { createdAt: 'desc' },
      });

      if (!signingKey) return;

      const payload = await this.jwkService.verifyJwt(
        idTokenHint,
        signingKey.publicKey,
      );
      const sid = (payload as Record<string, unknown>)['sid'] as
        string | undefined;
      const sub = (payload as Record<string, unknown>)['sub'] as
        string | undefined;

      if (sid) {
        await this.endSession(realm, sid, sub, ip);
      } else if (sub) {
        const sessions = await this.prisma.session.findMany({
          where: { userId: sub },
          select: { id: true },
        });
        await Promise.all(
          sessions.map((session) =>
            this.endSession(realm, session.id, sub, ip),
          ),
        );
      }
    } catch (err) {
      // Invalid or expired id_token — best-effort logout, don't throw
      // Log for debugging purposes
      this.logger.warn(
        `logoutByIdToken failed: ${(err as Error)?.message ?? 'Unknown error'}`,
      );
    }
  }

  /**
   * Validate a post_logout_redirect_uri against the client's registered
   * redirectUris, derived from the id_token_hint (azp / aud claim).
   *
   * Throws BadRequestException if:
   * - no id_token_hint is provided (no client context to validate against)
   * - the client cannot be found in this realm
   * - the URI does not match any of the client's registered redirectUris
   */
  async validatePostLogoutRedirectUri(
    realm: Realm,
    postLogoutRedirectUri: string,
    idTokenHint?: string,
  ): Promise<void> {
    if (!idTokenHint) {
      throw new BadRequestException(
        'id_token_hint is required when post_logout_redirect_uri is specified',
      );
    }

    // Decode the id_token_hint to obtain the client identifier (azp or aud).
    // We do a best-effort decode — if the token is expired but otherwise well-
    // formed we still extract the client id so the redirect can be validated.
    let clientId: string | undefined;
    try {
      const signingKey = await this.prisma.realmSigningKey.findFirst({
        where: { realmId: realm.id, active: true },
        orderBy: { createdAt: 'desc' },
      });
      if (signingKey) {
        const payload = await this.jwkService.verifyJwt(
          idTokenHint,
          signingKey.publicKey,
        );
        const p = payload as Record<string, unknown>;
        // azp (authorized party) is the canonical client identifier in OIDC id_tokens
        clientId =
          (p['azp'] as string | undefined) ??
          (Array.isArray(p['aud'])
            ? (p['aud'] as string[])[0]
            : (p['aud'] as string | undefined));
      }
    } catch {
      // Token may be expired — fall through; clientId stays undefined
    }

    if (!clientId) {
      throw new BadRequestException('Invalid logout request');
    }

    const client = await this.prisma.client.findUnique({
      where: { realmId_clientId: { realmId: realm.id, clientId } },
      select: { redirectUris: true, postLogoutRedirectUris: true },
    });

    if (!client) {
      throw new BadRequestException('Invalid logout request');
    }

    // OIDC RP-Initiated Logout: validate against the client's dedicated
    // post_logout_redirect_uris. Fall back to redirectUris for clients that
    // predate the field so existing integrations keep working.
    const allowed =
      client.postLogoutRedirectUris.length > 0
        ? client.postLogoutRedirectUris
        : client.redirectUris;

    if (!matchesRedirectUri(postLogoutRedirectUri, allowed)) {
      throw new BadRequestException(
        'post_logout_redirect_uri is not valid for this client',
      );
    }
  }

  private async endSession(
    realm: Realm,
    sessionId: string,
    userId?: string | null,
    ip?: string,
  ) {
    // Revoke all non-offline refresh tokens in this session
    await this.prisma.refreshToken.updateMany({
      where: { sessionId, isOffline: false },
      data: { revoked: true },
    });

    // Send backchannel logout notifications
    if (userId) {
      this.backchannelLogout.sendLogoutTokens(realm, userId, sessionId);
    }

    // Record logout event before deleting session
    void this.eventsService.recordLoginEvent({
      realmId: realm.id,
      type: LoginEventType.LOGOUT,
      userId: userId ?? undefined,
      sessionId,
      ipAddress: ip,
    });

    // Delete the session
    await this.prisma.session
      .delete({
        where: { id: sessionId },
      })
      .catch(() => {
        // Session may already be deleted
      });
  }

  /**
   * Invalidate the browser SSO (login) session behind an IDENPLANE_SESSION
   * cookie. RP-initiated logout must call this so a still-valid cookie cannot
   * be replayed to silently re-authenticate at /authorize after sign-out.
   */
  async invalidateLoginSession(sessionToken: string): Promise<void> {
    const tokenHash = this.crypto.sha256(sessionToken);
    await this.prisma.loginSession
      .delete({ where: { tokenHash } })
      .catch(() => {
        // Login session may already be absent/expired — nothing to do.
      });
  }

  async userinfo(realm: Realm, accessToken: string) {
    const signingKey = await this.prisma.realmSigningKey.findFirst({
      where: { realmId: realm.id, active: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!signingKey) {
      throw new UnauthorizedException('No signing key');
    }

    let payload;
    try {
      payload = await this.jwkService.verifyJwt(
        accessToken,
        signingKey.publicKey,
      );
    } catch {
      throw new UnauthorizedException('Invalid access token');
    }

    // Check blacklist
    const jti = payload['jti'];
    if (jti && (await this.blacklist.isBlacklisted(jti))) {
      throw new UnauthorizedException('Token has been revoked');
    }

    // Check session validity (logout revokes sessions)
    const sid = payload['sid'] as string | undefined;
    if (sid) {
      const session = await this.prisma.session.findUnique({
        where: { id: sid },
      });
      if (!session) {
        throw new UnauthorizedException('Session has been revoked');
      }
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub as string },
      select: {
        id: true,
        username: true,
        email: true,
        emailVerified: true,
        firstName: true,
        lastName: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const scopeString = payload['scope'] as string | undefined;
    const scopes = this.scopesService.parseAndValidate(scopeString);
    const effectiveScopes = scopes.length > 0 ? scopes : ['openid'];
    const allowedClaims =
      this.scopesService.getClaimsForScopes(effectiveScopes);
    const customAttrClaims =
      await this.customAttributesService.getOidcClaimsForUser(user.id);

    return resolveUserClaims(user, allowedClaims, customAttrClaims);
  }

  async handleBackchannelLogout(realm: Realm, logoutToken: string) {
    const signingKey = await this.prisma.realmSigningKey.findFirst({
      where: { realmId: realm.id, active: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!signingKey) {
      throw new UnauthorizedException('No signing key');
    }

    const payload = await this.jwkService.verifyJwt(
      logoutToken,
      signingKey.publicKey,
    );
    const p = payload as Record<string, unknown>;

    const events = p['events'] as Record<string, unknown> | undefined;
    if (
      !events ||
      !events['http://schemas.openid.net/event/backchannel-logout']
    ) {
      throw new BadRequestException(
        'Invalid logout token: missing backchannel-logout event',
      );
    }

    const sub = p['sub'] as string | undefined;
    const sid = p['sid'] as string | undefined;

    if (!sub && !sid) {
      throw new BadRequestException('Invalid logout token: missing sub or sid');
    }

    if (sid) {
      await this.endSession(realm, sid, sub, undefined);
    } else if (sub) {
      const sessions = await this.prisma.session.findMany({
        where: { userId: sub },
        select: { id: true },
      });
      await Promise.all(
        sessions.map((session) =>
          this.endSession(realm, session.id, sub, undefined),
        ),
      );
    }
  }
}
