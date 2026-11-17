import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { createHash, randomBytes } from 'node:crypto';
import type { Response } from 'express';
import type { IdentityProvider, Prisma, Realm } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CachedLookupsService } from '../../cache/cached-lookups.service.js';
import { LeaderService } from '../../cache/leader.service.js';
import {
  storedSamlConfig,
  type SamlIdpConfig,
} from '../../identity-providers/saml-config.js';
import type {
  BrokerState,
  ExternalIdentity,
  ExternalUserInfo,
} from '../broker.service.js';
import {
  SamlResponseError,
  SamlStatusError,
  decodeSamlResponse,
  verifySamlResponse,
} from './saml-response-verifier.js';
import {
  buildAuthnRequest,
  buildSpMetadata,
  newRequestId,
  postBindingCsp,
  postBindingPage,
  redirectBindingUrl,
  signAuthnRequestXml,
  spEndpoints,
  type SpEndpoints,
} from './saml-sp-messages.js';
import {
  UnsupportedSpKeyError,
  assertRsaKey,
  spCertificatePem,
} from './saml-sp-credentials.js';
import { externalUserFromAssertion } from './saml-attribute-mapping.js';

/** The browser-binding cookie of a SAML sign-in in progress. */
export const SAML_BROKER_COOKIE = 'IDENPLANE_SAML_BROKER';

/** How long a SAML sign-in may take, from the start link to `/complete`. */
export const SAML_BROKER_TTL_MS = 10 * 60 * 1000;

/** What `/complete` hands back: the sign-in's broker state and its outcome. */
export interface SamlCompletion {
  state: BrokerState;
  /** Null when the IdP answered with a non-Success status. */
  identity: ExternalIdentity | null;
}

/** What the ACS stores in the row for `/complete`. */
type StoredResult =
  | { kind: 'identity'; external: ExternalUserInfo }
  | { kind: 'cancelled'; status: string };

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const token = (bytes: number) => randomBytes(bytes).toString('base64url');

/**
 * Idenplane as a SAML 2.0 service provider for a `saml` identity provider:
 * the AuthnRequest, the Assertion Consumer Service and the hand-off back to
 * the browser that started the sign-in.
 *
 * A sign-in is one `saml_broker_requests` row, which moves forward once per
 * step, each step a conditional update (or delete) that only one request
 * can win:
 *
 * 1. {@link createStart}: the row, with the broker state and a one-time
 *    start handle; the browser is sent to `/saml/start?h=…`.
 * 2. {@link start}: claims the handle, binds the row to this browser (a
 *    random cookie, its hash in the row), and sends the AuthnRequest with
 *    a new ID and a short random RelayState (the bindings spec caps it at
 *    80 bytes, so the state itself stays here).
 * 3. {@link acs}: the IdP's POST. The response must answer this row's
 *    AuthnRequest (InResponseTo) and pass every check in
 *    saml-response-verifier.ts; its assertion ID is claimed (replay
 *    check), and the verified identity is stored in the row.
 * 4. {@link complete}: a top-level GET, so the browser's Lax cookies (the
 *    binding cookie, a login transaction's) come along, unlike on the
 *    IdP's cross-site POST. Only the browser holding the binding cookie can
 *    take the identity, once.
 */
@Injectable()
export class SamlBrokerService {
  private readonly logger = new Logger(SamlBrokerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lookups: CachedLookupsService,
    private readonly leader: LeaderService,
  ) {}

  /** The BASE_URL the ACS URL and entity ID are built on. */
  private baseUrl(): string {
    return process.env['BASE_URL'] ?? 'http://localhost:3000';
  }

  endpoints(realm: Realm, alias: string): SpEndpoints {
    return spEndpoints(this.baseUrl(), realm.name, alias);
  }

  /** The provider's config, or a refusal if it is not a usable `saml` one. */
  configOf(idp: IdentityProvider): SamlIdpConfig {
    if (idp.providerType !== 'saml') {
      throw new NotFoundException(
        `Identity provider '${idp.alias}' is not a SAML identity provider`,
      );
    }
    const config = storedSamlConfig(idp.samlConfig);
    if (!config) {
      throw new BadRequestException(
        `Identity provider '${idp.alias}' has an incomplete SAML configuration`,
      );
    }
    return config;
  }

  /** An enabled `saml` provider of the realm, with its config. */
  private async provider(
    realm: Realm,
    alias: string,
  ): Promise<{ idp: IdentityProvider; config: SamlIdpConfig }> {
    const idp = await this.prisma.identityProvider.findUnique({
      where: { realmId_alias: { realmId: realm.id, alias } },
    });
    if (!idp) {
      throw new NotFoundException(`Identity provider '${alias}' not found`);
    }
    const config = this.configOf(idp);
    if (!idp.enabled) {
      throw new BadRequestException(`Identity provider '${alias}' is disabled`);
    }
    return { idp, config };
  }

  private async signingKey(realm: Realm) {
    const key = await this.lookups.activeSigningKey(realm.id);
    if (!key) throw new BadRequestException('Realm has no active signing key');
    try {
      assertRsaKey(key);
    } catch (err) {
      if (err instanceof UnsupportedSpKeyError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
    return key;
  }

  // ─── METADATA ──────────────────────────────────────────

  /** The SP metadata the IdP is configured with. */
  async metadata(realm: Realm, alias: string): Promise<string> {
    const idp = await this.prisma.identityProvider.findUnique({
      where: { realmId_alias: { realmId: realm.id, alias } },
    });
    if (!idp || idp.providerType !== 'saml') {
      throw new NotFoundException(
        `SAML identity provider '${alias}' not found`,
      );
    }
    // Published while the config is still being completed, so the admin
    // can register the SP at the IdP first: defaults fill what is missing.
    const config = storedSamlConfig(idp.samlConfig);
    const key = await this.signingKey(realm);
    return buildSpMetadata({
      sp: this.endpoints(realm, alias),
      certificatePem: await spCertificatePem(key, realm.name),
      config: {
        signAuthnRequests: config?.signAuthnRequests ?? false,
        wantAssertionsSigned: config?.wantAssertionsSigned ?? true,
        nameIdFormat:
          config?.nameIdFormat ??
          'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent',
      },
    });
  }

  // ─── 1. THE START LINK ─────────────────────────────────

  /**
   * Records a SAML sign-in for `state` and returns the link that starts it
   * in the browser (relative to this server).
   */
  async createStart(
    realm: Realm,
    idp: IdentityProvider,
    state: BrokerState,
  ): Promise<string> {
    this.configOf(idp);
    const startHandle = token(32);
    await this.prisma.samlBrokerRequest.create({
      data: {
        identityProviderId: idp.id,
        startHandle,
        state: state as unknown as Prisma.InputJsonValue,
        expiresAt: new Date(Date.now() + SAML_BROKER_TTL_MS),
      },
    });
    return `/realms/${encodeURIComponent(realm.name)}/broker/${encodeURIComponent(idp.alias)}/saml/start?h=${startHandle}`;
  }

  // ─── 2. THE AUTHNREQUEST ───────────────────────────────

  /** The binding cookie's options: Lax, this provider's SAML paths only. */
  cookieOptions(realm: Realm, alias: string) {
    return {
      httpOnly: true,
      secure: true, // localhost is a secure context
      // Lax: it must come along on the top-level GET to /complete.
      sameSite: 'lax' as const,
      path: `/realms/${realm.name}/broker/${alias}/saml`,
    };
  }

  /**
   * `GET /saml/start?h=…`: claims the start handle (once), binds the
   * sign-in to this browser, and sends the AuthnRequest.
   */
  async start(
    realm: Realm,
    alias: string,
    handle: unknown,
    res: Response,
  ): Promise<void> {
    const { idp, config } = await this.provider(realm, alias);
    if (typeof handle !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(handle)) {
      throw new BadRequestException('Invalid sign-in link');
    }
    const key = config.signAuthnRequests ? await this.signingKey(realm) : null;
    const requestId = newRequestId();
    const relayState = token(24);
    const binding = token(32);
    const now = new Date();
    const { count } = await this.prisma.samlBrokerRequest.updateMany({
      where: {
        startHandle: handle,
        identityProviderId: idp.id,
        startedAt: null,
        expiresAt: { gt: now },
      },
      data: {
        startedAt: now,
        requestId,
        relayState,
        bindingHash: sha256(binding),
      },
    });
    if (count !== 1) {
      throw new BadRequestException(
        'This sign-in link has expired or was already used. Please sign in again.',
      );
    }
    res.cookie(SAML_BROKER_COOKIE, binding, {
      ...this.cookieOptions(realm, alias),
      maxAge: SAML_BROKER_TTL_MS,
    });

    const sp = this.endpoints(realm, alias);
    let xml = buildAuthnRequest({
      id: requestId,
      issueInstant: now,
      sp,
      config,
    });
    if (config.ssoBinding === 'redirect') {
      res.redirect(
        302,
        redirectBindingUrl(
          config.ssoUrl,
          xml,
          relayState,
          key?.privateKey ?? null,
        ),
      );
      return;
    }
    if (key) xml = signAuthnRequestXml(xml, requestId, key.privateKey);
    const nonce = token(16);
    res.setHeader(
      'Content-Security-Policy',
      postBindingCsp(config.ssoUrl, nonce),
    );
    res.setHeader('Cache-Control', 'no-store');
    res
      .type('html')
      .send(postBindingPage(config.ssoUrl, xml, relayState, nonce));
  }

  // ─── 3. THE ASSERTION CONSUMER SERVICE ─────────────────

  /**
   * `POST /saml/acs`: verifies the IdP's response for the sign-in its
   * RelayState names and stores the outcome. Returns the `/complete` URL
   * (relative) the browser is sent to.
   */
  async acs(
    realm: Realm,
    alias: string,
    samlResponse: unknown,
    relayState: unknown,
  ): Promise<string> {
    const { idp, config } = await this.provider(realm, alias);
    if (typeof relayState !== 'string' || !relayState) {
      this.logger.warn(
        `SAML response for '${alias}' without RelayState refused (IdP-initiated sign-in is not supported)`,
      );
      throw new BadRequestException(
        'Sign-in must start at Idenplane: sign-in started at the identity provider (IdP-initiated SSO) is not supported.',
      );
    }
    const now = new Date();
    const row = await this.prisma.samlBrokerRequest.findUnique({
      where: { relayState },
    });
    if (
      !row ||
      row.identityProviderId !== idp.id ||
      !row.requestId ||
      !row.startedAt ||
      row.verifiedAt ||
      row.expiresAt <= now
    ) {
      throw new BadRequestException(
        'This sign-in has expired or was already completed. Please sign in again.',
      );
    }
    const sp = this.endpoints(realm, alias);

    let result: StoredResult;
    let replay: { assertionId: string; until: Date } | null = null;
    try {
      const xml = decodeSamlResponse(samlResponse);
      const assertion = verifySamlResponse(xml, {
        idpEntityId: config.entityId,
        spEntityId: sp.entityId,
        acsUrl: sp.acsUrl,
        requestId: row.requestId,
        certificates: config.signingCertificates,
        wantAssertionsSigned: config.wantAssertionsSigned,
        wantResponseSigned: config.wantResponseSigned,
        allowSha1: config.allowSha1,
        clockSkewSeconds: config.clockSkewSeconds,
        nameIdFormat: config.nameIdFormat,
      });
      const external = externalUserFromAssertion(
        assertion,
        config,
        idp.trustEmail,
      );
      result = { kind: 'identity', external };
      replay = {
        assertionId: assertion.assertionId,
        until: new Date(assertion.replayUntil),
      };
    } catch (err) {
      if (err instanceof SamlStatusError) {
        // Destination, InResponseTo and Issuer matched; the IdP did not
        // sign the user in. Only the bound browser can act on this, and
        // all it does is end the attempt.
        this.logger.warn(
          `SAML sign-in at '${alias}' refused by the IdP: ${err.reason}`,
        );
        result = { kind: 'cancelled', status: err.statusCode };
      } else if (err instanceof SamlResponseError) {
        this.logger.warn(
          `SAML response for '${alias}' in realm '${realm.name}' refused: ${err.reason}`,
        );
        throw new UnauthorizedException(err.publicMessage);
      } else {
        throw err;
      }
    }

    if (replay)
      await this.claimAssertionId(idp, replay.assertionId, replay.until);

    const { count } = await this.prisma.samlBrokerRequest.updateMany({
      where: { id: row.id, verifiedAt: null, expiresAt: { gt: now } },
      data: {
        verifiedAt: now,
        result: result as unknown as Prisma.InputJsonValue,
      },
    });
    if (count !== 1) {
      throw new BadRequestException(
        'This sign-in has expired or was already completed. Please sign in again.',
      );
    }
    return `/realms/${encodeURIComponent(realm.name)}/broker/${encodeURIComponent(alias)}/saml/complete?id=${encodeURIComponent(row.id)}`;
  }

  /**
   * Records the assertion ID; refuses one already accepted that could still
   * pass the time checks. The insert on the unique (provider, assertion ID)
   * index is the check, so two copies arriving at once (on any process)
   * cannot both pass; a row past its time is taken over.
   */
  async claimAssertionId(
    idp: IdentityProvider,
    assertionId: string,
    until: Date,
  ): Promise<void> {
    try {
      await this.prisma.samlBrokerAssertionId.create({
        data: { identityProviderId: idp.id, assertionId, expiresAt: until },
      });
      return;
    } catch (err) {
      if ((err as { code?: string }).code !== 'P2002') throw err;
    }
    const now = new Date();
    const { count } = await this.prisma.samlBrokerAssertionId.updateMany({
      where: {
        identityProviderId: idp.id,
        assertionId,
        expiresAt: { lte: now },
      },
      data: { expiresAt: until, createdAt: now },
    });
    if (count === 0) {
      this.logger.warn(
        `SAML assertion ${JSON.stringify(assertionId)} from '${idp.alias}' was replayed`,
      );
      throw new UnauthorizedException(
        'This SAML response was already used. Please sign in again.',
      );
    }
  }

  // ─── 4. BACK IN THE BROWSER THAT STARTED ───────────────

  /**
   * `GET /saml/complete?id=…`: the outcome the ACS stored, for the browser
   * holding the binding cookie only, once.
   */
  async complete(
    realm: Realm,
    alias: string,
    id: unknown,
    bindingCookie: unknown,
  ): Promise<SamlCompletion> {
    const { idp } = await this.provider(realm, alias);
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) {
      throw new BadRequestException('Invalid sign-in');
    }
    if (typeof bindingCookie !== 'string' || !bindingCookie) {
      throw new ForbiddenException(
        'This sign-in can only be finished in the browser where it started. Please sign in again.',
      );
    }
    const now = new Date();
    const row = await this.prisma.samlBrokerRequest.findUnique({
      where: { id },
    });
    if (
      !row ||
      row.identityProviderId !== idp.id ||
      !row.verifiedAt ||
      !row.result ||
      row.expiresAt <= now
    ) {
      throw new BadRequestException(
        'This sign-in has expired or was already completed. Please sign in again.',
      );
    }
    if (row.bindingHash !== sha256(bindingCookie)) {
      this.logger.warn(
        `SAML sign-in ${id} at '${alias}' was finished in another browser; refused`,
      );
      throw new ForbiddenException(
        'This sign-in can only be finished in the browser where it started. Please sign in again.',
      );
    }
    // The delete is the claim: only one request takes the outcome.
    const { count } = await this.prisma.samlBrokerRequest.deleteMany({
      where: { id, bindingHash: row.bindingHash, verifiedAt: { not: null } },
    });
    if (count !== 1) {
      throw new BadRequestException(
        'This sign-in has expired or was already completed. Please sign in again.',
      );
    }
    const state = row.state as unknown as BrokerState;
    if (state.realmId !== realm.id || state.alias !== alias) {
      throw new BadRequestException('Broker state mismatch');
    }
    const result = row.result as unknown as StoredResult;
    return {
      state,
      identity:
        result.kind === 'identity' ? { idp, external: result.external } : null,
    };
  }

  /** Deletes sign-ins and assertion IDs whose time has passed. */
  @Interval(300_000) // every 5 minutes
  async cleanupExpired(): Promise<void> {
    if (!this.leader.isLeader()) return;
    const now = new Date();
    const requests = await this.prisma.samlBrokerRequest.deleteMany({
      where: { expiresAt: { lt: now } },
    });
    const ids = await this.prisma.samlBrokerAssertionId.deleteMany({
      where: { expiresAt: { lt: now } },
    });
    if (requests.count + ids.count > 0) {
      this.logger.debug(
        `Cleaned up ${requests.count} SAML sign-in(s) and ${ids.count} assertion ID(s)`,
      );
    }
  }
}
