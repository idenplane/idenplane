import {
  Injectable,
  Logger,
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
  codeChallenge?: string;
  codeChallengeMethod?: string;
}

/** A single entry returned by GitHub's `GET /user/emails` endpoint. */
interface GithubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
  visibility: string | null;
}

const GITHUB_API_HOST = 'api.github.com';
/** Sent on every userinfo request — required by GitHub's API, harmless elsewhere. */
const USER_AGENT = 'Idenplane';

/**
 * Coerce a userinfo claim to a non-empty string. Userinfo payloads are
 * untrusted JSON, so only primitive scalars are accepted — objects/arrays/null
 * (and empty strings) collapse to `undefined` rather than `'[object Object]'`.
 */
function toStr(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value.length > 0 ? value : undefined;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
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
  private readonly logger = new Logger(BrokerService.name);

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
      code_challenge?: string;
      code_challenge_method?: string;
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

    // Validate the Idenplane client
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
      codeChallenge: params.code_challenge,
      codeChallengeMethod: params.code_challenge_method,
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
   * Exchange code, fetch user info, link/create user, issue Idenplane auth code.
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

    // Issue Idenplane authorization code
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
        // Carry PKCE from the original client request through the broker so the
        // subsequent code→token exchange enforces it for public clients.
        codeChallenge: brokerState.codeChallenge,
        codeChallengeMethod: brokerState.codeChallengeMethod,
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
      headers: {
        Authorization: `Bearer ${accessToken}`,
        // GitHub's REST API rejects requests without a User-Agent; harmless for
        // every other provider.
        'User-Agent': USER_AGENT,
      },
    });

    if (!response.ok) {
      throw new UnauthorizedException(
        'Failed to fetch user info from external provider',
      );
    }

    const data = (await response.json()) as Record<string, unknown>;

    const subject = toStr(data['sub'] ?? data['id']) ?? '';
    const name = toStr(data['name']);
    let givenName = toStr(data['given_name'] ?? data['first_name']);
    let familyName = toStr(data['family_name'] ?? data['last_name']);
    const preferredUsername = toStr(
      data['preferred_username'] ?? data['login'],
    );

    // Finding #17: providers like GitHub return a single full `name` (e.g.
    // "Islam Awad") rather than OIDC-style given/family names. Derive them by
    // splitting on the first whitespace so the user record gets a name.
    if (givenName === undefined && familyName === undefined && name) {
      const trimmed = name.trim();
      const firstSpace = trimmed.search(/\s/);
      if (firstSpace === -1) {
        givenName = trimmed || undefined;
      } else {
        givenName = trimmed.slice(0, firstSpace);
        familyName = trimmed.slice(firstSpace + 1).trim() || undefined;
      }
    }

    let email = toStr(data['email']);
    let emailVerified =
      data['email_verified'] === true || data['email_verified'] === 'true'
        ? true
        : data['email_verified'] === false || data['email_verified'] === 'false'
          ? false
          : undefined;

    // Finding #16: GitHub's /user endpoint returns email=null for users whose
    // email is private, even when the user:email scope is granted. Fall back to
    // the /user/emails endpoint to resolve their primary (or first verified)
    // address. Scoped to GitHub — the well-known non-OIDC provider.
    if (!email && this.isGithub(idp)) {
      const githubEmail = await this.fetchGithubPrimaryEmail(accessToken);
      if (githubEmail) {
        email = githubEmail.email;
        emailVerified = githubEmail.verified;
      }
    }

    return {
      sub: subject,
      email,
      emailVerified,
      name,
      givenName,
      familyName,
      preferredUsername,
    };
  }

  /** Detect GitHub by its userinfo host so the email fallback stays targeted. */
  private isGithub(idp: IdentityProvider): boolean {
    if (!idp.userinfoUrl) {
      return false;
    }
    try {
      return new URL(idp.userinfoUrl).hostname === GITHUB_API_HOST;
    } catch {
      return false;
    }
  }

  /**
   * Resolve a GitHub user's email via `GET /user/emails`, picking the primary
   * address (falling back to the first verified one, else the first). Returns
   * `undefined` and logs a warning if the request fails — never throws, so a
   * private-email user can still log in (just without an email).
   */
  private async fetchGithubPrimaryEmail(
    accessToken: string,
  ): Promise<GithubEmail | undefined> {
    try {
      const response = await fetch('https://api.github.com/user/emails', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'User-Agent': USER_AGENT,
          Accept: 'application/vnd.github+json',
        },
      });

      if (!response.ok) {
        this.logger.warn(
          `GitHub /user/emails returned ${response.status}; federated user will have no email`,
        );
        return undefined;
      }

      const emails = (await response.json()) as GithubEmail[];
      if (!Array.isArray(emails) || emails.length === 0) {
        return undefined;
      }

      return (
        emails.find((e) => e.primary) ??
        emails.find((e) => e.verified) ??
        emails[0]
      );
    } catch (err) {
      this.logger.warn(
        `Failed to fetch GitHub /user/emails: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return undefined;
    }
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
