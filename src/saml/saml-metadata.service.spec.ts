import { generateKeyPairSync } from 'crypto';
import type { Realm } from '@prisma/client';
import { SamlMetadataService } from './saml-metadata.service.js';
import {
  createMockPrismaService,
  type MockPrismaService,
} from '../prisma/prisma.mock.js';

describe('SamlMetadataService', () => {
  let service: SamlMetadataService;
  let prisma: MockPrismaService;

  // Real RSA key pair for signing key tests
  let publicKey: string;

  beforeAll(() => {
    const keyPair = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    publicKey = keyPair.publicKey;
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

  const baseUrl = 'https://auth.example.com';

  beforeEach(() => {
    prisma = createMockPrismaService();
    service = new SamlMetadataService(prisma as any);
  });

  describe('generateMetadata', () => {
    it('should generate valid IdP metadata XML with signing key certificate', async () => {
      prisma.realmSigningKey.findFirst.mockResolvedValue({
        id: 'key-1',
        realmId: 'realm-1',
        kid: 'kid-1',
        algorithm: 'RS256',
        publicKey,
        privateKey: 'unused',
        active: true,
        createdAt: new Date(),
      });

      const xml = await service.generateMetadata(mockRealm, baseUrl);

      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xml).toContain('EntityDescriptor');
      expect(xml).toContain('IDPSSODescriptor');
      expect(xml).toContain('ds:X509Certificate');
      // The certificate body should be the PEM content without headers
      const certBody = publicKey
        .replace(/-----BEGIN [A-Z ]+-----/g, '')
        .replace(/-----END [A-Z ]+-----/g, '')
        .replace(/\s+/g, '');
      expect(xml).toContain(certBody);
    });

    it('should produce empty certificate body when no signing key exists', async () => {
      prisma.realmSigningKey.findFirst.mockResolvedValue(null);

      const xml = await service.generateMetadata(mockRealm, baseUrl);

      expect(xml).toContain('<ds:X509Certificate></ds:X509Certificate>');
    });

    it('should contain correct NameIDFormat entries', async () => {
      prisma.realmSigningKey.findFirst.mockResolvedValue(null);

      const xml = await service.generateMetadata(mockRealm, baseUrl);

      expect(xml).toContain(
        '<NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</NameIDFormat>',
      );
      expect(xml).toContain(
        '<NameIDFormat>urn:oasis:names:tc:SAML:2.0:nameid-format:persistent</NameIDFormat>',
      );
      expect(xml).toContain(
        '<NameIDFormat>urn:oasis:names:tc:SAML:2.0:nameid-format:transient</NameIDFormat>',
      );
    });

    it('should set entityID to ${baseUrl}/realms/${realm.name}', async () => {
      prisma.realmSigningKey.findFirst.mockResolvedValue(null);

      const xml = await service.generateMetadata(mockRealm, baseUrl);

      expect(xml).toContain(`entityID="${baseUrl}/realms/${mockRealm.name}"`);
    });

    it('should set SSO Location to ${baseUrl}/realms/${realm.name}/protocol/saml', async () => {
      prisma.realmSigningKey.findFirst.mockResolvedValue(null);

      const xml = await service.generateMetadata(mockRealm, baseUrl);

      const expectedLocation = `${baseUrl}/realms/${mockRealm.name}/protocol/saml`;
      expect(xml).toContain(`Location="${expectedLocation}"`);
    });

    it('should contain both HTTP-POST and HTTP-Redirect bindings', async () => {
      prisma.realmSigningKey.findFirst.mockResolvedValue(null);

      const xml = await service.generateMetadata(mockRealm, baseUrl);

      expect(xml).toContain(
        'Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"',
      );
      expect(xml).toContain(
        'Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect"',
      );
    });

    it('should query for the active signing key of the realm', async () => {
      prisma.realmSigningKey.findFirst.mockResolvedValue(null);

      await service.generateMetadata(mockRealm, baseUrl);

      expect(prisma.realmSigningKey.findFirst).toHaveBeenCalledWith({
        where: { realmId: mockRealm.id, active: true },
      });
    });
  });
});
