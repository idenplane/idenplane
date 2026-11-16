import { CachedLookupsService } from '../cache/cached-lookups.service.js';
import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { inflate, inflateRaw } from 'zlib';
import { promisify } from 'util';
import { SignedXml } from 'xml-crypto';
import type { Realm, SamlServiceProvider, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { CreateSamlSpDto } from './dto/create-saml-sp.dto.js';
import { UpdateSamlSpDto } from './dto/update-saml-sp.dto.js';
import { LeaderService } from '../cache/leader.service.js';
import {
  SamlRequestError,
  assertNoXmlSignature,
  parseAuthnRequest,
  spVerificationKey,
  verifyEnvelopedSignature,
  verifyRedirectSignature,
  type ParsedSamlRequest,
  type RedirectQuery,
  type SamlAuthnRequest,
} from './saml-request-verifier.js';

const inflateAsync = promisify(inflate);
const inflateRawAsync = promisify(inflateRaw);

const MAX_XML_SIZE = 256 * 1024; // 256 KB max to prevent XML bomb

/**
 * Decodes a SAMLRequest: inflated when it is compressed, as is otherwise.
 * The HTTP-Redirect binding compresses with raw DEFLATE (RFC 1951, SAML
 * bindings §3.4.4.1); a zlib-wrapped stream is accepted too. Inflation stops
 * at MAX_XML_SIZE, so a small compressed request cannot expand into a huge
 * buffer before the size check (a decompression bomb, ASVS 5.0 V5.2.3).
 */
async function decodeSamlRequest(samlRequest: string): Promise<string> {
  const decoded = Buffer.from(samlRequest, 'base64');
  for (const inflateFn of [inflateRawAsync, inflateAsync]) {
    try {
      const inflated = await inflateFn(decoded, {
        maxOutputLength: MAX_XML_SIZE + 1,
      });
      return inflated.toString('utf-8');
    } catch (err) {
      if ((err as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') {
        throw new BadRequestException(
          'SAMLRequest exceeds maximum allowed size',
        );
      }
    }
  }
  return decoded.toString('utf-8');
}

/** How far apart the SP's clock and ours may be (seconds). */
const DEFAULT_CLOCK_SKEW_SECONDS = 180;
/** How old an AuthnRequest may be when it arrives (seconds). */
const DEFAULT_REQUEST_MAX_AGE_SECONDS = 300;

/** xs:dateTime as SAML uses it (UTC, `Z`; an offset or none tolerated). */
const XS_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;

function secondsFromEnv(name: string, fallback: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 && value <= max
    ? value
    : fallback;
}

/** The SAMLRequest as it arrived, per binding. */
export type SamlInboundRequest =
  | { binding: 'redirect'; query: RedirectQuery }
  | { binding: 'post'; samlRequest?: string; relayState?: string };

/** An AuthnRequest that passed every check but the ACS URL and replay ones. */
export interface AcceptedAuthnRequest {
  sp: SamlServiceProvider;
  request: SamlAuthnRequest;
  relayState: string;
  /** Whether the request was signed and its signature verified. */
  signed: boolean;
}

@Injectable()
export class SamlIdpService {
  private readonly logger = new Logger(SamlIdpService.name);

  constructor(
    private readonly lookups: CachedLookupsService,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly leader: LeaderService,
  ) {}

  // ─── AUTHN REQUEST VALIDATION ──────────────────────────

  /**
   * Decodes and strictly parses a SAMLRequest. What it returns is unsigned
   * data: it is good for finding the service provider, nothing else.
   */
  async validateAuthnRequest(samlRequest: string): Promise<SamlAuthnRequest> {
    return (await this.parse(samlRequest)).request;
  }

  private async parse(samlRequest: string): Promise<ParsedSamlRequest> {
    try {
      const xml = await decodeSamlRequest(samlRequest);
      if (xml.length > MAX_XML_SIZE) {
        throw new BadRequestException(
          'SAMLRequest exceeds maximum allowed size',
        );
      }
      return parseAuthnRequest(xml);
    } catch (err) {
      throw this.refusal(err);
    }
  }

  /** A BadRequestException for any failure; the details are logged. */
  private refusal(err: unknown): BadRequestException {
    if (err instanceof BadRequestException) return err;
    if (err instanceof SamlRequestError) {
      this.logger.warn(`SAMLRequest refused: ${err.reason}`);
      return new BadRequestException(err.publicMessage);
    }
    this.logger.error('Failed to parse AuthnRequest', (err as Error).stack);
    return new BadRequestException('Invalid SAMLRequest');
  }

  /**
   * Everything the IdP checks on an AuthnRequest before it acts on it,
   * except the ACS URL (the controller's) and the replay check
   * (`claimRequestId`, once every other check has passed):
   *
   * - the service provider named by the Issuer exists and is enabled;
   * - when the SP has a certificate, the request is signed with it (an
   *   unsigned request is refused), and every field is read from what the
   *   signature covers; the signed Issuer must still be that SP;
   * - IssueInstant is within the allowed age and clock skew;
   * - Destination, when present, is this endpoint.
   */
  async receiveAuthnRequest(
    realm: Realm,
    inbound: SamlInboundRequest,
  ): Promise<AcceptedAuthnRequest> {
    const samlRequest =
      inbound.binding === 'redirect'
        ? inbound.query.samlRequest
        : inbound.samlRequest;
    if (!samlRequest) {
      throw new BadRequestException('Missing SAMLRequest parameter');
    }
    const parsed = await this.parse(samlRequest);

    const sp = await this.findSpByEntityId(realm.id, parsed.request.issuer);
    if (!sp || !sp.enabled) {
      throw new BadRequestException(
        `Unknown or disabled SAML service provider: ${parsed.request.issuer}`,
      );
    }

    try {
      let request = parsed.request;
      const signed = !!sp.certificate;
      if (inbound.binding === 'redirect') {
        // The signature travels in the query string; an XML one left in the
        // message is refused so nothing mistakes it for the one checked.
        assertNoXmlSignature(parsed.root);
        if (sp.certificate) {
          verifyRedirectSignature(
            inbound.query,
            spVerificationKey(sp.certificate),
          );
        }
      } else if (sp.certificate) {
        request = verifyEnvelopedSignature(
          parsed,
          spVerificationKey(sp.certificate),
        );
      }
      if (request.issuer !== sp.entityId) {
        throw new SamlRequestError(
          'the signed Issuer is not the service provider the request named',
          'AuthnRequest signature validation failed',
        );
      }
      this.checkIssueInstant(request);
      this.checkDestination(realm, request);

      const relayState =
        inbound.binding === 'redirect'
          ? (inbound.query.relayState ?? '')
          : (inbound.relayState ?? '');
      return { sp, request, relayState, signed };
    } catch (err) {
      throw this.refusal(err);
    }
  }

  /** Allowed clock skew between the SP and the IdP, in seconds. */
  clockSkewSeconds(): number {
    return secondsFromEnv(
      'SAML_CLOCK_SKEW_SECONDS',
      DEFAULT_CLOCK_SKEW_SECONDS,
      900,
    );
  }

  /** Maximum age of an AuthnRequest when it arrives, in seconds. */
  requestMaxAgeSeconds(): number {
    return secondsFromEnv(
      'SAML_REQUEST_MAX_AGE_SECONDS',
      DEFAULT_REQUEST_MAX_AGE_SECONDS,
      3600,
    );
  }

  /** IssueInstant as a time, or a refusal. */
  private issueInstantOf(request: SamlAuthnRequest): number {
    const value = request.issueInstant;
    if (!value || !XS_DATE_TIME.test(value)) {
      throw new SamlRequestError(
        `IssueInstant "${value ?? ''}" is missing or not an xs:dateTime`,
        'AuthnRequest IssueInstant is missing or invalid',
      );
    }
    const zoned = /(Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}Z`;
    const time = Date.parse(zoned);
    if (Number.isNaN(time)) {
      throw new SamlRequestError(
        `IssueInstant "${value}" is not a date`,
        'AuthnRequest IssueInstant is missing or invalid',
      );
    }
    return time;
  }

  private checkIssueInstant(request: SamlAuthnRequest): void {
    const issued = this.issueInstantOf(request);
    const skew = this.clockSkewSeconds() * 1000;
    const maxAge = this.requestMaxAgeSeconds() * 1000;
    const now = Date.now();
    if (issued > now + skew || issued < now - maxAge - skew) {
      throw new SamlRequestError(
        `IssueInstant ${request.issueInstant} is outside the accepted window`,
        'AuthnRequest has expired or is not yet valid',
      );
    }
  }

  /** The SSO endpoint of a realm, as its metadata publishes it. */
  ssoEndpoint(realm: Realm): string {
    const baseUrl = (
      process.env['BASE_URL'] ?? 'http://localhost:3000'
    ).replace(/\/+$/, '');
    return `${baseUrl}/realms/${realm.name}/protocol/saml`;
  }

  private checkDestination(realm: Realm, request: SamlAuthnRequest): void {
    if (request.destination === null) return;
    if (request.destination !== this.ssoEndpoint(realm)) {
      throw new SamlRequestError(
        `Destination ${request.destination} is not ${this.ssoEndpoint(realm)}`,
        'AuthnRequest Destination does not match this endpoint',
      );
    }
  }

  /**
   * Records the request's ID for its service provider; refuses an ID that
   * was already accepted and could still pass the IssueInstant check.
   *
   * The insert on the unique (SP, request ID) index is the check itself, so
   * two copies of a request arriving at once (on one process or on several
   * replicas and workers) cannot both pass. A row whose window has passed but
   * that the clean-up has not deleted yet is taken over by a conditional
   * update.
   */
  async claimRequestId(
    sp: SamlServiceProvider,
    request: SamlAuthnRequest,
  ): Promise<void> {
    const issued = this.issueInstantOf(request);
    const now = new Date();
    // The last moment a copy of this request could pass checkIssueInstant.
    const expiresAt = new Date(
      issued + (this.requestMaxAgeSeconds() + this.clockSkewSeconds()) * 1000,
    );
    try {
      await this.prisma.samlRequestId.create({
        data: { spId: sp.id, requestId: request.id, expiresAt },
      });
      return;
    } catch (err) {
      if ((err as { code?: string }).code !== 'P2002') throw err;
    }
    const { count } = await this.prisma.samlRequestId.updateMany({
      where: { spId: sp.id, requestId: request.id, expiresAt: { lte: now } },
      data: { expiresAt, createdAt: now },
    });
    if (count === 0) {
      this.logger.warn(
        `SAMLRequest refused: request ID ${request.id} from ${sp.entityId} was already used`,
      );
      throw new BadRequestException('AuthnRequest has already been used');
    }
  }

  /** Deletes request IDs whose requests can no longer pass the time check. */
  @Interval(300_000) // every 5 minutes
  async cleanupExpiredRequestIds(): Promise<void> {
    // Once per cluster, not once per process (see LeaderService).
    if (!this.leader.isLeader()) return;
    const { count } = await this.prisma.samlRequestId.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (count > 0) {
      this.logger.debug(`Cleaned up ${count} expired SAML request ID(s)`);
    }
  }

  // ─── SAML RESPONSE CREATION ────────────────────────────

  async createSamlResponse(
    realm: Realm,
    sp: SamlServiceProvider,
    user: User,
    inResponseTo?: string,
    /**
     * The ACS URL the response is posted to: the request's (already checked
     * against the SP's allowed URLs) or the SP's default. Recipient and
     * Destination must name it, or the SP rejects the response.
     */
    acsUrl: string = sp.acsUrl,
  ): Promise<string> {
    const signingKey = await this.lookups.activeSigningKey(realm.id);

    if (!signingKey) {
      throw new BadRequestException('Realm has no active signing key');
    }

    const baseUrl = process.env['BASE_URL'] ?? 'http://localhost:3000';
    const issuer = `${baseUrl}/realms/${realm.name}`;
    const now = new Date();
    const notBefore = new Date(now.getTime() - 60_000); // 1 min clock skew
    const notOnOrAfter = new Date(now.getTime() + 5 * 60_000); // 5 min validity
    const sessionNotOnOrAfter = new Date(now.getTime() + 8 * 3600_000); // 8h session
    const responseId = `_${randomUUID()}`;
    const assertionId = `_${randomUUID()}`;

    const nameId = this.resolveNameId(sp, user);

    const attributeStatement = this.buildAttributeStatement(user);

    const assertion = `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${assertionId}" IssueInstant="${now.toISOString()}" Version="2.0">
  <saml:Issuer>${this.escapeXml(issuer)}</saml:Issuer>
  <saml:Subject>
    <saml:NameID Format="${this.escapeXml(sp.nameIdFormat)}">${this.escapeXml(nameId)}</saml:NameID>
    <saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">
      <saml:SubjectConfirmationData${inResponseTo ? ` InResponseTo="${this.escapeXml(inResponseTo)}"` : ''} NotOnOrAfter="${notOnOrAfter.toISOString()}" Recipient="${this.escapeXml(acsUrl)}" />
    </saml:SubjectConfirmation>
  </saml:Subject>
  <saml:Conditions NotBefore="${notBefore.toISOString()}" NotOnOrAfter="${notOnOrAfter.toISOString()}">
    <saml:AudienceRestriction>
      <saml:Audience>${this.escapeXml(sp.entityId)}</saml:Audience>
    </saml:AudienceRestriction>
  </saml:Conditions>
  <saml:AuthnStatement AuthnInstant="${now.toISOString()}" SessionIndex="${assertionId}" SessionNotOnOrAfter="${sessionNotOnOrAfter.toISOString()}">
    <saml:AuthnContext>
      <saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef>
    </saml:AuthnContext>
  </saml:AuthnStatement>
  ${attributeStatement}
</saml:Assertion>`;

    // Sign the assertion if configured
    let signedAssertion = assertion;
    if (sp.signAssertions) {
      signedAssertion = this.signXml(
        assertion,
        signingKey.privateKey,
        assertionId,
      );
    }

    const response = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" Destination="${this.escapeXml(acsUrl)}" ID="${responseId}"${inResponseTo ? ` InResponseTo="${this.escapeXml(inResponseTo)}"` : ''} IssueInstant="${now.toISOString()}" Version="2.0">
  <saml:Issuer xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">${this.escapeXml(issuer)}</saml:Issuer>
  <samlp:Status>
    <samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success" />
  </samlp:Status>
  ${signedAssertion}
</samlp:Response>`;

    // Optionally sign the entire response
    let finalResponse = response;
    if (sp.signResponses) {
      finalResponse = this.signXml(response, signingKey.privateKey, responseId);
    }

    return Buffer.from(finalResponse, 'utf-8').toString('base64');
  }

  // ─── FIND SP ───────────────────────────────────────────

  async findSpByEntityId(
    realmId: string,
    entityId: string,
  ): Promise<SamlServiceProvider | null> {
    return this.prisma.samlServiceProvider.findUnique({
      where: { realmId_entityId: { realmId, entityId } },
    });
  }

  // ─── CRUD (called by admin controller) ─────────────────

  async createSp(realm: Realm, data: CreateSamlSpDto) {
    return this.prisma.samlServiceProvider.create({
      data: {
        realmId: realm.id,
        entityId: data.entityId,
        name: data.name,
        acsUrl: data.acsUrl,
        sloUrl: data.sloUrl ?? null,
        certificate: data.certificate ?? null,
        nameIdFormat:
          data.nameIdFormat ??
          'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
        signAssertions: data.signAssertions ?? true,
        signResponses: data.signResponses ?? true,
        validRedirectUris: data.validRedirectUris ?? [],
      },
    });
  }

  async findAllSps(realm: Realm) {
    return this.prisma.samlServiceProvider.findMany({
      where: { realmId: realm.id },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findSpById(realm: Realm, id: string) {
    return this.prisma.samlServiceProvider.findFirst({
      where: { id, realmId: realm.id },
    });
  }

  async updateSp(realm: Realm, id: string, data: UpdateSamlSpDto) {
    // Ensure the SP belongs to this realm
    const existing = await this.prisma.samlServiceProvider.findFirst({
      where: { id, realmId: realm.id },
    });
    if (!existing) {
      throw new BadRequestException('SAML service provider not found');
    }

    const updateData: Record<string, unknown> = {};
    if (data.entityId !== undefined) updateData['entityId'] = data.entityId;
    if (data.name !== undefined) updateData['name'] = data.name;
    if (data.acsUrl !== undefined) updateData['acsUrl'] = data.acsUrl;
    if (data.sloUrl !== undefined) updateData['sloUrl'] = data.sloUrl;
    if (data.certificate !== undefined)
      updateData['certificate'] = data.certificate;
    if (data.nameIdFormat !== undefined)
      updateData['nameIdFormat'] = data.nameIdFormat;
    if (data.signAssertions !== undefined)
      updateData['signAssertions'] = data.signAssertions;
    if (data.signResponses !== undefined)
      updateData['signResponses'] = data.signResponses;
    if (data.validRedirectUris !== undefined)
      updateData['validRedirectUris'] = data.validRedirectUris;

    return this.prisma.samlServiceProvider.update({
      where: { id },
      data: updateData,
    });
  }

  async deleteSp(realm: Realm, id: string) {
    const existing = await this.prisma.samlServiceProvider.findFirst({
      where: { id, realmId: realm.id },
    });
    if (!existing) {
      throw new BadRequestException('SAML service provider not found');
    }

    return this.prisma.samlServiceProvider.delete({ where: { id } });
  }

  // ─── PRIVATE HELPERS ───────────────────────────────────

  private resolveNameId(sp: SamlServiceProvider, user: User): string {
    switch (sp.nameIdFormat) {
      case 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress':
        return user.email ?? user.username;
      case 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent':
        return user.id;
      case 'urn:oasis:names:tc:SAML:2.0:nameid-format:transient':
        return `_${randomUUID()}`;
      case 'urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified':
      default:
        return user.username;
    }
  }

  private buildAttributeStatement(user: User): string {
    const attrs: { name: string; value: string }[] = [];

    if (user.email) {
      attrs.push({ name: 'email', value: user.email });
    }
    if (user.firstName) {
      attrs.push({ name: 'firstName', value: user.firstName });
    }
    if (user.lastName) {
      attrs.push({ name: 'lastName', value: user.lastName });
    }
    attrs.push({ name: 'username', value: user.username });
    attrs.push({ name: 'uid', value: user.id });

    if (attrs.length === 0) return '';

    const attrXml = attrs
      .map(
        (a) =>
          `    <saml:Attribute Name="${this.escapeXml(a.name)}" NameFormat="urn:oasis:names:tc:SAML:2.0:attrname-format:basic">
      <saml:AttributeValue xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="xs:string">${this.escapeXml(a.value)}</saml:AttributeValue>
    </saml:Attribute>`,
      )
      .join('\n');

    return `<saml:AttributeStatement>
${attrXml}
  </saml:AttributeStatement>`;
  }

  private signXml(xml: string, privateKeyPem: string, refId: string): string {
    const sig = new SignedXml({
      privateKey: privateKeyPem,
      signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
      canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
    });
    sig.addReference({
      xpath: `//*[@ID='${refId}']`,
      digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
      transforms: [
        'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
        'http://www.w3.org/2001/10/xml-exc-c14n#',
      ],
    });
    sig.computeSignature(xml, {
      location: { reference: `//*[@ID='${refId}']`, action: 'append' },
    });
    return sig.getSignedXml();
  }

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
