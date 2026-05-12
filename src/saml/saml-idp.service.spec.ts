import { BadRequestException } from '@nestjs/common';
import { generateKeyPairSync } from 'crypto';
import { deflateSync } from 'zlib';
import type { Realm, SamlServiceProvider, User } from '@prisma/client';
import { SignedXml } from 'xml-crypto';
import { SamlIdpService } from './saml-idp.service.js';
import {
  createMockPrismaService,
  type MockPrismaService,
} from '../prisma/prisma.mock.js';

function signXml(xml: string, privateKeyPem: string, refId: string): string {
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

describe('SamlIdpService', () => {
  let service: SamlIdpService;
  let prisma: MockPrismaService;
  let crypto: {
    sha256: jest.Mock;
    generateSecret: jest.Mock;
    hashPassword: jest.Mock;
    verifyPassword: jest.Mock;
  };

  // Real RSA keys for signing tests
  let publicKey: string;
  let privateKey: string;

  beforeAll(() => {
    const keyPair = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    publicKey = keyPair.publicKey;
    privateKey = keyPair.privateKey;
  });

  const mockRealm: Realm = {
    id: 'realm-1',
    name: 'test-realm',
    displayName: 'Test Realm',
    enabled: true,
    accessTokenLifespan: 300,
    refreshTokenLifespan: 1800,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Realm;

  const mockUser: User = {
    id: 'user-1',
    realmId: 'realm-1',
    username: 'jdoe',
    email: 'jdoe@example.com',
    emailVerified: true,
    firstName: 'John',
    lastName: 'Doe',
    enabled: true,
    passwordHash: 'hashed',
    federationLink: null,
    passwordChangedAt: null,
    lockedUntil: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as User;

  const mockSp: SamlServiceProvider = {
    id: 'sp-1',
    realmId: 'realm-1',
    entityId: 'https://sp.example.com',
    name: 'Test SP',
    enabled: true,
    acsUrl: 'https://sp.example.com/acs',
    sloUrl: null,
    certificate: null,
    nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
    signAssertions: false,
    signResponses: false,
    attributeStatements: {},
    validRedirectUris: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockSigningKey = {
    id: 'key-1',
    realmId: 'realm-1',
    kid: 'kid-1',
    algorithm: 'RS256',
    publicKey: '',
    privateKey: '',
    active: true,
    createdAt: new Date(),
  };

  beforeEach(() => {
    prisma = createMockPrismaService();
    crypto = {
      sha256: jest.fn(),
      generateSecret: jest.fn(),
      hashPassword: jest.fn(),
      verifyPassword: jest.fn(),
    };
    service = new SamlIdpService(prisma as any, crypto as any);
  });

  // ─── validateAuthnRequest ──────────────────────────────

  describe('validateAuthnRequest', () => {
    const makeAuthnRequest = (
      issuer: string,
      id: string,
      acsUrl: string,
    ): string =>
      `<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="${id}" AssertionConsumerServiceURL="${acsUrl}" Version="2.0">` +
      `<saml:Issuer xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">${issuer}</saml:Issuer>` +
      `</samlp:AuthnRequest>`;

    it('should parse a valid base64 plain-XML AuthnRequest', async () => {
      const xml = makeAuthnRequest(
        'https://sp.example.com',
        '_req123',
        'https://sp.example.com/acs',
      );
      const encoded = Buffer.from(xml, 'utf-8').toString('base64');

      const result = await service.validateAuthnRequest(encoded);

      expect(result.issuer).toBe('https://sp.example.com');
      expect(result.id).toBe('_req123');
      expect(result.acsUrl).toBe('https://sp.example.com/acs');
    });

    it('should parse a DEFLATE-compressed AuthnRequest', async () => {
      const xml = makeAuthnRequest(
        'https://sp.example.com',
        '_deflated1',
        'https://sp.example.com/acs',
      );
      const compressed = deflateSync(Buffer.from(xml, 'utf-8'));
      const encoded = compressed.toString('base64');

      const result = await service.validateAuthnRequest(encoded);

      expect(result.issuer).toBe('https://sp.example.com');
      expect(result.id).toBe('_deflated1');
      expect(result.acsUrl).toBe('https://sp.example.com/acs');
    });

    it('should throw BadRequestException when Issuer is missing', async () => {
      const xml =
        '<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="_noissuer">' +
        '</samlp:AuthnRequest>';
      const encoded = Buffer.from(xml, 'utf-8').toString('base64');

      await expect(service.validateAuthnRequest(encoded)).rejects.toThrow(
        new BadRequestException('AuthnRequest missing Issuer'),
      );
    });

    it('should throw BadRequestException for invalid base64/garbage input', async () => {
      await expect(
        service.validateAuthnRequest('!!!not-valid-base64!!!'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject unsigned AuthnRequest when SP has certificate', async () => {
      const xml = makeAuthnRequest(
        'https://sp.example.com',
        '_sigtest1',
        'https://sp.example.com/acs',
      );
      const encoded = Buffer.from(xml, 'utf-8').toString('base64');

      await expect(
        service.validateSignature(encoded, publicKey),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject AuthnRequest with wrong signature when SP has certificate', async () => {
      const { generateKeyPairSync } = require('crypto');
      const wrongKey = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });
      const wrongPublicKey = wrongKey.publicKey;

      const xml = makeAuthnRequest(
        'https://sp.example.com',
        '_sigtest2',
        'https://sp.example.com/acs',
      );
      const signed = signXml(xml, privateKey, '_sigtest2');
      const encoded = Buffer.from(signed, 'utf-8').toString('base64');

      await expect(
        service.validateSignature(encoded, wrongPublicKey),
      ).rejects.toThrow(BadRequestException);
    });

    it('should accept AuthnRequest with valid signature when SP has certificate', async () => {
      const xml = makeAuthnRequest(
        'https://sp.example.com',
        '_sigtest3',
        'https://sp.example.com/acs',
      );
      const signed = signXml(xml, privateKey, '_sigtest3');
      const encoded = Buffer.from(signed, 'utf-8').toString('base64');

      await expect(
        service.validateSignature(encoded, publicKey),
      ).resolves.toBeUndefined();
    });

    it('should throw BadRequestException for invalid base64 in validateSignature', async () => {
      await expect(
        service.validateSignature('!!!not-valid-base64!!!', publicKey),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── createSamlResponse ────────────────────────────────

  describe('createSamlResponse', () => {
    beforeEach(() => {
      process.env['BASE_URL'] = 'https://auth.example.com';
    });

    afterEach(() => {
      delete process.env['BASE_URL'];
    });

    it('should return a base64 string with correct Issuer, NameID, and AudienceRestriction', async () => {
      prisma.realmSigningKey.findFirst.mockResolvedValue({
        ...mockSigningKey,
        publicKey,
        privateKey,
      });

      const result = await service.createSamlResponse(
        mockRealm,
        mockSp,
        mockUser,
      );

      expect(typeof result).toBe('string');
      const xml = Buffer.from(result, 'base64').toString('utf-8');
      expect(xml).toContain(
        `https://auth.example.com/realms/${mockRealm.name}`,
      );
      expect(xml).toContain(mockUser.email);
      expect(xml).toContain(mockSp.entityId);
      expect(xml).toContain('AudienceRestriction');
    });

    it('should include InResponseTo when provided', async () => {
      prisma.realmSigningKey.findFirst.mockResolvedValue({
        ...mockSigningKey,
        publicKey,
        privateKey,
      });

      const result = await service.createSamlResponse(
        mockRealm,
        mockSp,
        mockUser,
        '_inresponseto123',
      );

      const xml = Buffer.from(result, 'base64').toString('utf-8');
      expect(xml).toContain('InResponseTo="_inresponseto123"');
    });

    it('should not include InResponseTo when not provided', async () => {
      prisma.realmSigningKey.findFirst.mockResolvedValue({
        ...mockSigningKey,
        publicKey,
        privateKey,
      });

      const result = await service.createSamlResponse(
        mockRealm,
        mockSp,
        mockUser,
      );

      const xml = Buffer.from(result, 'base64').toString('utf-8');
      expect(xml).not.toContain('InResponseTo');
    });

    it('should throw BadRequestException when no signing key exists', async () => {
      prisma.realmSigningKey.findFirst.mockResolvedValue(null);

      await expect(
        service.createSamlResponse(mockRealm, mockSp, mockUser),
      ).rejects.toThrow(
        new BadRequestException('Realm has no active signing key'),
      );
    });

    it('should sign the assertion when signAssertions is true', async () => {
      prisma.realmSigningKey.findFirst.mockResolvedValue({
        ...mockSigningKey,
        publicKey,
        privateKey,
      });

      const sp = { ...mockSp, signAssertions: true, signResponses: false };
      const result = await service.createSamlResponse(mockRealm, sp, mockUser);

      const xml = Buffer.from(result, 'base64').toString('utf-8');
      expect(xml).toContain('Signature');
      expect(xml).toContain('SignatureValue');
    });

    it('should sign the response when signResponses is true', async () => {
      prisma.realmSigningKey.findFirst.mockResolvedValue({
        ...mockSigningKey,
        publicKey,
        privateKey,
      });

      const sp = { ...mockSp, signAssertions: false, signResponses: true };
      const result = await service.createSamlResponse(mockRealm, sp, mockUser);

      const xml = Buffer.from(result, 'base64').toString('utf-8');
      expect(xml).toContain('Signature');
      expect(xml).toContain('SignatureValue');
    });

    it('should use email as NameID for emailAddress nameIdFormat', async () => {
      prisma.realmSigningKey.findFirst.mockResolvedValue({
        ...mockSigningKey,
        publicKey,
        privateKey,
      });

      const sp = {
        ...mockSp,
        nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
      };
      const result = await service.createSamlResponse(mockRealm, sp, mockUser);

      const xml = Buffer.from(result, 'base64').toString('utf-8');
      expect(xml).toContain(`>${mockUser.email}</saml:NameID>`);
    });

    it('should use user id as NameID for persistent nameIdFormat', async () => {
      prisma.realmSigningKey.findFirst.mockResolvedValue({
        ...mockSigningKey,
        publicKey,
        privateKey,
      });

      const sp = {
        ...mockSp,
        nameIdFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent',
      };
      const result = await service.createSamlResponse(mockRealm, sp, mockUser);

      const xml = Buffer.from(result, 'base64').toString('utf-8');
      expect(xml).toContain(`>${mockUser.id}</saml:NameID>`);
    });

    it('should include AttributeStatement with user attributes', async () => {
      prisma.realmSigningKey.findFirst.mockResolvedValue({
        ...mockSigningKey,
        publicKey,
        privateKey,
      });

      const result = await service.createSamlResponse(
        mockRealm,
        mockSp,
        mockUser,
      );

      const xml = Buffer.from(result, 'base64').toString('utf-8');
      expect(xml).toContain('AttributeStatement');
      expect(xml).toContain('Name="email"');
      expect(xml).toContain('Name="firstName"');
      expect(xml).toContain('Name="lastName"');
      expect(xml).toContain('Name="username"');
      expect(xml).toContain('Name="uid"');
      expect(xml).toContain(mockUser.email!);
      expect(xml).toContain(mockUser.firstName!);
      expect(xml).toContain(mockUser.lastName!);
      expect(xml).toContain(mockUser.username);
      expect(xml).toContain(mockUser.id);
    });
  });

  // ─── findSpByEntityId ──────────────────────────────────

  describe('findSpByEntityId', () => {
    it('should return the SP when found', async () => {
      prisma.samlServiceProvider.findUnique.mockResolvedValue(mockSp);

      const result = await service.findSpByEntityId(
        'realm-1',
        'https://sp.example.com',
      );

      expect(result).toEqual(mockSp);
      expect(prisma.samlServiceProvider.findUnique).toHaveBeenCalledWith({
        where: {
          realmId_entityId: {
            realmId: 'realm-1',
            entityId: 'https://sp.example.com',
          },
        },
      });
    });

    it('should return null when SP is not found', async () => {
      prisma.samlServiceProvider.findUnique.mockResolvedValue(null);

      const result = await service.findSpByEntityId(
        'realm-1',
        'https://nonexistent.com',
      );

      expect(result).toBeNull();
    });
  });

  // ─── createSp ──────────────────────────────────────────

  describe('createSp', () => {
    it('should create and return a SAML service provider', async () => {
      prisma.samlServiceProvider.create.mockResolvedValue(mockSp);

      const data = {
        entityId: 'https://sp.example.com',
        name: 'Test SP',
        acsUrl: 'https://sp.example.com/acs',
        sloUrl: null,
        certificate: null,
        nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
        signAssertions: false,
        signResponses: false,
        validRedirectUris: [],
      };

      const result = await service.createSp(mockRealm, data);

      expect(result).toEqual(mockSp);
      expect(prisma.samlServiceProvider.create).toHaveBeenCalledWith({
        data: {
          realmId: mockRealm.id,
          entityId: data.entityId,
          name: data.name,
          acsUrl: data.acsUrl,
          sloUrl: data.sloUrl,
          certificate: data.certificate,
          nameIdFormat: data.nameIdFormat,
          signAssertions: data.signAssertions,
          signResponses: data.signResponses,
          validRedirectUris: data.validRedirectUris,
        },
      });
    });
  });

  // ─── findAllSps ────────────────────────────────────────

  describe('findAllSps', () => {
    it('should return all SPs for a realm ordered by createdAt', async () => {
      const sps = [mockSp, { ...mockSp, id: 'sp-2', name: 'Other SP' }];
      prisma.samlServiceProvider.findMany.mockResolvedValue(sps);

      const result = await service.findAllSps(mockRealm);

      expect(result).toEqual(sps);
      expect(prisma.samlServiceProvider.findMany).toHaveBeenCalledWith({
        where: { realmId: mockRealm.id },
        orderBy: { createdAt: 'asc' },
      });
    });
  });

  // ─── findSpById ────────────────────────────────────────

  describe('findSpById', () => {
    it('should return SP when found', async () => {
      prisma.samlServiceProvider.findFirst.mockResolvedValue(mockSp);

      const result = await service.findSpById(mockRealm, 'sp-1');

      expect(result).toEqual(mockSp);
      expect(prisma.samlServiceProvider.findFirst).toHaveBeenCalledWith({
        where: { id: 'sp-1', realmId: mockRealm.id },
      });
    });

    it('should return null when SP is not found', async () => {
      prisma.samlServiceProvider.findFirst.mockResolvedValue(null);

      const result = await service.findSpById(mockRealm, 'nonexistent');

      expect(result).toBeNull();
    });
  });

  // ─── updateSp ──────────────────────────────────────────

  describe('updateSp', () => {
    it('should update and return the SP', async () => {
      prisma.samlServiceProvider.findFirst.mockResolvedValue(mockSp);
      const updated = { ...mockSp, name: 'Updated SP' };
      prisma.samlServiceProvider.update.mockResolvedValue(updated);

      const result = await service.updateSp(mockRealm, 'sp-1', {
        name: 'Updated SP',
      });

      expect(result).toEqual(updated);
      expect(prisma.samlServiceProvider.update).toHaveBeenCalledWith({
        where: { id: 'sp-1' },
        data: { name: 'Updated SP' },
      });
    });

    it('should throw BadRequestException when SP is not found', async () => {
      prisma.samlServiceProvider.findFirst.mockResolvedValue(null);

      await expect(
        service.updateSp(mockRealm, 'nonexistent', { name: 'X' }),
      ).rejects.toThrow(
        new BadRequestException('SAML service provider not found'),
      );
    });
  });

  // ─── deleteSp ──────────────────────────────────────────

  describe('deleteSp', () => {
    it('should delete the SP', async () => {
      prisma.samlServiceProvider.findFirst.mockResolvedValue(mockSp);
      prisma.samlServiceProvider.delete.mockResolvedValue(mockSp);

      const result = await service.deleteSp(mockRealm, 'sp-1');

      expect(result).toEqual(mockSp);
      expect(prisma.samlServiceProvider.delete).toHaveBeenCalledWith({
        where: { id: 'sp-1' },
      });
    });

    it('should throw BadRequestException when SP is not found', async () => {
      prisma.samlServiceProvider.findFirst.mockResolvedValue(null);

      await expect(service.deleteSp(mockRealm, 'nonexistent')).rejects.toThrow(
        new BadRequestException('SAML service provider not found'),
      );
    });
  });
});
