import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { inflate } from 'zlib';
import { promisify } from 'util';
import { XMLParser } from 'fast-xml-parser';
import { SignedXml } from 'xml-crypto';
import type { Realm, SamlServiceProvider, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';

const inflateAsync = promisify(inflate);

const MAX_XML_SIZE = 256 * 1024; // 256 KB max to prevent XML bomb

interface ParsedAuthnRequest {
  id: string;
  issuer: string;
  acsUrl: string | null;
  nameIdPolicy: string | null;
}

@Injectable()
export class SamlIdpService {
  private readonly logger = new Logger(SamlIdpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  // ─── AUTHN REQUEST VALIDATION ──────────────────────────

  async validateAuthnRequest(samlRequest: string): Promise<ParsedAuthnRequest> {
    try {
      const decoded = Buffer.from(samlRequest, 'base64');

      let xml: string;
      try {
        const inflated = await inflateAsync(decoded);
        xml = inflated.toString('utf-8');
      } catch {
        xml = decoded.toString('utf-8');
      }

      if (xml.length > MAX_XML_SIZE) {
        throw new BadRequestException('SAMLRequest exceeds maximum allowed size');
      }

      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        removeNSPrefix: true,
      });

      const doc = parser.parse(xml);
      const authnRequest = doc['AuthnRequest'];
      if (!authnRequest) {
        throw new BadRequestException('Invalid AuthnRequest: root element not found');
      }

      const id = authnRequest['@_ID'] ?? randomUUID();
      const issuer =
        typeof authnRequest['Issuer'] === 'string'
          ? authnRequest['Issuer']
          : authnRequest['Issuer']?.['#text'] ?? '';
      const acsUrl =
        authnRequest['@_AssertionConsumerServiceURL'] ?? null;
      const nameIdPolicy = authnRequest['NameIDPolicy']?.['@_Format'] ?? null;

      if (!issuer) {
        throw new BadRequestException('AuthnRequest missing Issuer');
      }

      return { id, issuer, acsUrl, nameIdPolicy };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error('Failed to parse AuthnRequest', (err as Error).stack);
      throw new BadRequestException('Invalid SAMLRequest');
    }
  }

  async validateSignature(samlRequest: string, certificate: string): Promise<void> {
    const decoded = Buffer.from(samlRequest, 'base64');

    let xml: string;
    try {
      const inflated = await inflateAsync(decoded);
      xml = inflated.toString('utf-8');
    } catch {
      xml = decoded.toString('utf-8');
    }

    const { DOMParser } = require('@xmldom/xmldom') as any;
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const signatures = doc.getElementsByTagName('Signature');
    if (!signatures || signatures.length === 0) {
      throw new BadRequestException('AuthnRequest is not signed');
    }

    const sig = new SignedXml({ publicCert: certificate });
    sig.loadSignature(signatures[0]);
    let valid = false;
    try {
      valid = sig.checkSignature(xml);
    } catch (err) {
      this.logger.error('Signature validation threw error', (err as Error).stack);
      throw new BadRequestException('AuthnRequest signature validation failed');
    }
    if (!valid) {
      const errors = (sig as any).errors;
      if (errors) {
        this.logger.error(
          `Signature validation errors: ${errors.map((e: any) => e.message).join(', ')}`,
        );
      }
      throw new BadRequestException('AuthnRequest signature validation failed');
    }
  }

  // ─── SAML RESPONSE CREATION ────────────────────────────

  async createSamlResponse(
    realm: Realm,
    sp: SamlServiceProvider,
    user: User,
    inResponseTo?: string,
  ): Promise<string> {
    const signingKey = await this.prisma.realmSigningKey.findFirst({
      where: { realmId: realm.id, active: true },
    });

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
      <saml:SubjectConfirmationData${inResponseTo ? ` InResponseTo="${this.escapeXml(inResponseTo)}"` : ''} NotOnOrAfter="${notOnOrAfter.toISOString()}" Recipient="${this.escapeXml(sp.acsUrl)}" />
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
      signedAssertion = this.signXml(assertion, signingKey.privateKey, assertionId);
    }

    const response = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" Destination="${this.escapeXml(sp.acsUrl)}" ID="${responseId}"${inResponseTo ? ` InResponseTo="${this.escapeXml(inResponseTo)}"` : ''} IssueInstant="${now.toISOString()}" Version="2.0">
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

  async createSp(realm: Realm, data: any) {
    return this.prisma.samlServiceProvider.create({
      data: {
        realmId: realm.id,
        entityId: data.entityId,
        name: data.name,
        acsUrl: data.acsUrl,
        sloUrl: data.sloUrl,
        certificate: data.certificate,
        nameIdFormat: data.nameIdFormat,
        signAssertions: data.signAssertions,
        signResponses: data.signResponses,
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

  async updateSp(realm: Realm, id: string, data: any) {
    // Ensure the SP belongs to this realm
    const existing = await this.prisma.samlServiceProvider.findFirst({
      where: { id, realmId: realm.id },
    });
    if (!existing) {
      throw new BadRequestException('SAML service provider not found');
    }

    return this.prisma.samlServiceProvider.update({
      where: { id },
      data,
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
