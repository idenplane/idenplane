import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import type { Realm, IdentityProvider } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { JwkService } from '../crypto/jwk.service.js';
import { IdentityProvidersService } from '../identity-providers/identity-providers.service.js';
import { matchesRedirectUri } from '../common/redirect-uri.utils.js';

interface BrokerState {
  realmId: string;
  realmName: string;
  alias: string;
  clientId: string;
  redirectUri: string;
  scope?: string;
  state?: string;
  nonce?: string;
}

interface ExternalUserInfo {
  sub: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
  givenName?: string;
  familyName?: string;
  preferredUsername?: string;
}

@Injectable()
export class BrokerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwkService: JwkService,
    private readonly idpService: IdentityProvidersService,
  ) {}

  /**
   * Build the external provider's authorization URL and a signed broker state.
   */
  async initiateLogin(
    realm: Realm,
    alias: string,
    params: {
      client_id: string;
      redirect_uri: string;
      scope?: string;
      state?: string;
      nonce?: string;
    },
  ): Promise<string> {
    if (!params.client_id) {
      throw new BadRequestException('client_id is required');
    }
    if (!params.redirect_uri) {
      throw new BadRequestException('redirect_uri is required');
    }

    const idp = await this.idpService.findByAlias(realm, alias);
    if (!idp.enabled) {
      throw new BadRequestException(`Identity provider '${alias}' is disabled`);
    }

    // Validate the Authme client
    const client = await this.prisma.client.findUnique({
      where: {
        realmId_clientId: { realmId: realm.id, clientId: params.client_id },
      },
    });
    if (!client || !client.enabled) {
      throw new BadRequestException('Invalid client_id');
    }
    if (!matchesRedirectUri(params.redirect_uri, client.redirectUris)) {
      throw new BadRequestException('Invalid redirect_uri');
    }

    // Build broker state as signed JWT
    const signingKey = await this.getActiveSigningKey(realm.id);
    const brokerState: BrokerState = {
      realmId: realm.id,
      realmName: realm.name,
      alias,
      clientId: params.client_id,
      redirectUri: params.redirect_uri,
      scope: params.scope,
      state: params.state,
      nonce: params.nonce,
    };

    const stateJwt = await this.jwkService.signJwt(
      { ...brokerState, typ: 'broker_state' },
      signingKey.privateKey,
      signingKey.kid,
      600, // 10 minutes
    );

    // Build external authorization URL
    const baseUrl = process.env['BASE_URL'] ?? 'http://localhost:3000';
    const callbackUrl = `${baseUrl}/realms/${realm.name}/broker/${alias}/callback`;

    const authUrl = new URL(idp.authorizationUrl);
    authUrl.searchParams.set('client_id', idp.clientId);
    authUrl.searchParams.set('redirect_uri', callbackUrl);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', idp.defaultScopes);
    authUrl.searchParams.set('state', stateJwt);

    return authUrl.toString();
  }

  /**
   * Handle the callback from the external provider.
   * Exchange code, fetch user info, link/create user, issue Authme auth code.
   */
  async handleCallback(
    realm: Realm,
    alias: string,
    code: string,
    stateJwt: string,
  ): Promise<{ redirectUrl: string }> {
    // Verify broker state
    const signingKey = await this.getActiveSigningKey(realm.id);
    let brokerState: BrokerState;
    try {
      const payload = await this.jwkService.verifyJwt(
        stateJwt,
        signingKey.publicKey,
      );
      brokerState = payload as unknown as BrokerState;
    } catch {
      throw new UnauthorizedException('Invalid or expired broker state');
    }

    if (brokerState.alias !== alias || brokerState.realmId !== realm.id) {
      throw new BadRequestException('Broker state mismatch');
    }

    const idp = await this.idpService.findByAlias(realm, alias);

    // Exchange code for tokens at external provider
    const baseUrl = process.env['BASE_URL'] ?? 'http://localhost:3000';
    const callbackUrl = `${baseUrl}/realms/${realm.name}/broker/${alias}/callback`;

    const tokenResponse = await this.exchangeCode(idp, code, callbackUrl);

    // Fetch user info from external provider
    const externalUser = await this.fetchExternalUserInfo(
      idp,
      tokenResponse.access_token,
    );

    // Link or create local user
    const user = await this.linkOrCreateUser(realm, idp, externalUser);

    // Issue Authme authorization code
    const client = await this.prisma.client.findUnique({
      where: {
        realmId_clientId: { realmId: realm.id, clientId: brokerState.clientId },
      },
    });
    if (!client) {
      throw new BadRequestException('Client not found');
    }

    const authCode = randomBytes(32).toString('hex');
    await this.prisma.authorizationCode.create({
      data: {
        code: authCode,
        clientId: client.id,
        userId: user.id,
        redirectUri: brokerState.redirectUri,
        scope: brokerState.scope,
        nonce: brokerState.nonce,
        expiresAt: new Date(Date.now() + 60 * 1000),
      },
    });

    const redirectUrl = new URL(brokerState.redirectUri);
    redirectUrl.searchParams.set('code', authCode);
    if (brokerState.state) {
      redirectUrl.searchParams.set('state', brokerState.state);
    }

    return { redirectUrl: redirectUrl.toString() };
  }

  private async exchangeCode(
    idp: IdentityProvider,
    code: string,
    redirectUri: string,
  ): Promise<{ access_token: string; id_token?: string }> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: idp.clientId,
      client_secret: idp.clientSecret,
    });

    const response = await fetch(idp.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      throw new UnauthorizedException(
        'Failed to exchange code with external provider',
      );
    }

    return (await response.json()) as {
      access_token: string;
      id_token?: string;
    };
  }

  private async fetchExternalUserInfo(
    idp: IdentityProvider,
    accessToken: string,
  ): Promise<ExternalUserInfo> {
    const url = idp.userinfoUrl ?? idp.tokenUrl.replace('/token', '/userinfo');

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      throw new UnauthorizedException(
        'Failed to fetch user info from external provider',
      );
    }

    const data = (await response.json()) as Record<string, string | undefined>;

    const subject = String(data['sub'] ?? data['id'] ?? '');
    const rawGivenName = data['given_name'] ?? data['first_name'];
    const rawFamilyName = data['family_name'] ?? data['last_name'];
    const rawPreferredUsername = data['preferred_username'] ?? data['login'];
    const givenName =
      rawGivenName !== undefined ? String(rawGivenName) : undefined;
    const familyName =
      rawFamilyName !== undefined ? String(rawFamilyName) : undefined;
    const preferredUsername =
      rawPreferredUsername !== undefined
        ? String(rawPreferredUsername)
        : undefined;

    return {
      sub: subject,
      email: data['email'],
      emailVerified:
        data['email_verified'] === 'true'
          ? true
          : data['email_verified'] === 'false'
            ? false
            : undefined,
      name: data['name'],
      givenName: givenName,
      familyName: familyName,
      preferredUsername: preferredUsername,
    };
  }

  private async linkOrCreateUser(
    realm: Realm,
    idp: IdentityProvider,
    external: ExternalUserInfo,
  ) {
    // Case A: Existing federated identity
    const existingLink = await this.prisma.federatedIdentity.findUnique({
      where: {
        identityProviderId_externalUserId: {
          identityProviderId: idp.id,
          externalUserId: external.sub,
        },
      },
      include: { user: true },
    });

    if (existingLink) {
      // Optionally sync profile
      if (idp.syncUserProfile) {
        await this.prisma.user.update({
          where: { id: existingLink.userId },
          data: {
            email: external.email ?? undefined,
            firstName: external.givenName ?? undefined,
            lastName: external.familyName ?? undefined,
          },
        });
      }
      return existingLink.user;
    }

    // Case B: Match by email
    if (external.email && idp.trustEmail) {
      const existingUser = await this.prisma.user.findFirst({
        where: { realmId: realm.id, email: external.email },
      });

      if (existingUser) {
        // Link existing user
        await this.prisma.federatedIdentity.create({
          data: {
            userId: existingUser.id,
            identityProviderId: idp.id,
            externalUserId: external.sub,
            externalUsername: external.preferredUsername,
            externalEmail: external.email,
          },
        });
        return existingUser;
      }
    }

    // Case C: Create new user
    if (idp.linkOnly) {
      throw new UnauthorizedException(
        'No matching user found and identity provider is configured as link-only',
      );
    }

    const username =
      external.preferredUsername ??
      external.email?.split('@')[0] ??
      `${idp.alias}-${external.sub}`;

    const user = await this.prisma.user.create({
      data: {
        realmId: realm.id,
        username,
        email: external.email,
        emailVerified: idp.trustEmail && (external.emailVerified ?? false),
        firstName: external.givenName,
        lastName: external.familyName,
        enabled: true,
      },
    });

    await this.prisma.federatedIdentity.create({
      data: {
        userId: user.id,
        identityProviderId: idp.id,
        externalUserId: external.sub,
        externalUsername: external.preferredUsername,
        externalEmail: external.email,
      },
    });

    return user;
  }

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
}
