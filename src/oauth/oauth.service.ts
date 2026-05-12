import {
  Injectable,
  BadRequestException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { randomBytes } from 'crypto';
import type { Realm, User, Client } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { ScopesService } from '../scopes/scopes.service.js';
import { matchesRedirectUri } from '../common/redirect-uri.utils.js';

export interface AuthorizeParams {
  response_type: string;
  client_id: string;
  redirect_uri: string;
  scope?: string;
  state?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  nonce?: string;
  /** Space-separated list of requested ACR values (highest preference first). */
  acr_values?: string;
}

@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scopesService: ScopesService,
  ) {}

  /**
   * Validate the OAuth authorization request parameters and return the client.
   * Does NOT authenticate the user — that's the login page's job.
   */
  async validateAuthRequest(
    realm: Realm,
    params: AuthorizeParams,
  ): Promise<Client> {
    if (params.response_type !== 'code') {
      throw new BadRequestException('Only response_type=code is supported');
    }

    if (!params.client_id || !params.redirect_uri) {
      throw new BadRequestException('client_id and redirect_uri are required');
    }

    const client = await this.prisma.client.findUnique({
      where: {
        realmId_clientId: { realmId: realm.id, clientId: params.client_id },
      },
    });

    if (!client || !client.enabled) {
      throw new NotFoundException('Client not found');
    }

    if (!matchesRedirectUri(params.redirect_uri, client.redirectUris)) {
      throw new BadRequestException('Invalid redirect_uri');
    }

    if (!client.grantTypes.includes('authorization_code')) {
      throw new BadRequestException(
        'Client does not support authorization_code grant',
      );
    }

    if (
      params.code_challenge_method &&
      params.code_challenge_method !== 'S256'
    ) {
      throw new BadRequestException(
        'Only S256 code_challenge_method is supported',
      );
    }

    // PKCE is required for all client types (OAuth 2.1 / RFC 7636)
    if (!params.code_challenge) {
      throw new BadRequestException(
        'PKCE (code_challenge) is required for all client types',
      );
    }

    return client;
  }

  /**
   * Generate an authorization code for an already-authenticated user.
   * Called after the login page validates credentials.
   */
  async authorizeWithUser(
    realm: Realm,
    user: User,
    params: AuthorizeParams,
  ): Promise<{ redirectUrl: string }> {
    const client = await this.validateAuthRequest(realm, params);

    // Resolve effective scopes: merge client default scopes with requested scopes
    const requestedScopes = this.scopesService.parseAndValidate(params.scope);
    const effectiveScopes = await this.scopesService.getClientEffectiveScopes(
      client.id,
      realm.id,
      requestedScopes,
    );
    const effectiveScope =
      effectiveScopes.length > 0
        ? this.scopesService.toString(effectiveScopes)
        : params.scope;

    const code = randomBytes(32).toString('hex');

    await this.prisma.authorizationCode.create({
      data: {
        code,
        clientId: client.id,
        userId: user.id,
        redirectUri: params.redirect_uri,
        scope: effectiveScope,
        codeChallenge: params.code_challenge,
        codeChallengeMethod: params.code_challenge_method,
        nonce: params.nonce,
        acrValues: params.acr_values ?? null,
        expiresAt: new Date(Date.now() + 60 * 1000),
      },
    });

    const redirectUrl = new URL(params.redirect_uri);
    redirectUrl.searchParams.set('code', code);
    if (params.state) {
      redirectUrl.searchParams.set('state', params.state);
    }

    return { redirectUrl: redirectUrl.toString() };
  }

  @Interval(300_000) // every 5 minutes
  async cleanupExpiredCodes(): Promise<void> {
    const { count } = await this.prisma.authorizationCode.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (count > 0) {
      this.logger.debug(`Cleaned up ${count} expired authorization code(s)`);
    }
  }
}
