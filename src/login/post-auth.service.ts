import { Injectable } from '@nestjs/common';
import type { Client, Realm, User } from '@prisma/client';
import { OAuthService } from '../oauth/oauth.service.js';
import { ConsentService } from '../consent/consent.service.js';
import { ACR_PASSWORD, satisfiesAcr } from '../authn-core/acr.js';
import type { AuthContext } from '../authn-core/auth-context.js';
import type { AuthorizeParams } from '../authn-core/oauth-params.js';

/** The redirect_uri with an OAuth error, as an authorization response. */
export function authorizationError(
  oauthParams: Record<string, string>,
  error: string,
  description: string,
): string {
  const url = new URL(oauthParams['redirect_uri']);
  url.searchParams.set('error', error);
  url.searchParams.set('error_description', description);
  if (oauthParams['state']) url.searchParams.set('state', oauthParams['state']);
  return url.toString();
}

/**
 * What a completed sign-in leads to once its session exists: the account
 * page, an error for a client whose required ACR was not met, the consent
 * screen, or the authorization code.
 */
@Injectable()
export class PostAuthService {
  constructor(
    private readonly oauthService: OAuthService,
    private readonly consentService: ConsentService,
  ) {}

  /**
   * Where to send the browser after a sign-in that satisfied `authContext`.
   *
   * @param client the client of the OAuth request, already validated against
   *   `oauthParams`, or null when the sign-in was not for a client.
   * @returns the URL to redirect to (302).
   */
  async continueAuthorization(
    realm: Realm,
    user: User,
    client: Client | null | undefined,
    oauthParams: Record<string, string>,
    authContext: AuthContext,
  ): Promise<string> {
    if (!client) {
      return `/realms/${realm.name}/account`;
    }

    // Fix auth_time now, when the user has just authenticated, so a consent
    // screen in between does not move it to the moment they click Allow.
    const authTime = authContext.authTime ?? new Date();
    const context: AuthContext = { ...authContext, authTime };

    // The client's own policy: a sign-in weaker than its required ACR never
    // yields a code for it (the session still exists for other clients).
    if (
      client.requiredAcr &&
      !satisfiesAcr(authContext.acr ?? ACR_PASSWORD, client.requiredAcr)
    ) {
      return authorizationError(
        oauthParams,
        'access_denied',
        'This application requires a stronger sign-in method',
      );
    }

    // prompt=consent asks again even when consent was given before.
    const forceConsent = (oauthParams['prompt'] ?? '')
      .split(' ')
      .includes('consent');
    if (client.requireConsent || forceConsent) {
      const scopes = (oauthParams['scope'] ?? 'openid')
        .split(' ')
        .filter(Boolean);
      const hasConsent =
        !forceConsent &&
        (await this.consentService.hasConsent(user.id, client.id, scopes));

      if (!hasConsent) {
        const reqId = await this.consentService.storeConsentRequest({
          userId: user.id,
          clientId: client.id,
          clientName: client.name ?? client.clientId,
          realmName: realm.name,
          scopes,
          oauthParams,
          // Carry the satisfied auth context across the consent round-trip so
          // the code issued after consent reflects the real acr/amr.
          satisfiedAcr: context.acr,
          amr: context.amr,
          authTime: authTime.toISOString(),
        });
        return `/realms/${realm.name}/consent?req=${reqId}`;
      }
    }

    const result = await this.oauthService.authorizeWithUser(
      realm,
      user,
      oauthParams as unknown as AuthorizeParams,
      context,
    );
    return result.redirectUrl;
  }
}
