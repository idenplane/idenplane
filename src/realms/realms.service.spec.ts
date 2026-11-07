import { ConflictException, NotFoundException } from '@nestjs/common';

// Mock JwkService module to avoid importing jose (ESM-only)
jest.mock('../crypto/jwk.service.js', () => ({
  JwkService: jest.fn(),
}));

import { RealmsService } from './realms.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { SmsProviderType } from '../sms/dto/sms-config.dto.js';
import { SECRET_PLACEHOLDER } from './realm-secrets.util.js';
import {
  createMockPrismaService,
  MockPrismaService,
} from '../prisma/prisma.mock.js';

function createMockCacheService() {
  return {
    getCachedClientConfig: jest.fn().mockResolvedValue(null),
    cacheClientConfig: jest.fn().mockResolvedValue(undefined),
    invalidateClientCache: jest.fn().mockResolvedValue(undefined),
    getCachedRealmConfig: jest.fn().mockResolvedValue(null),
    cacheRealmConfig: jest.fn().mockResolvedValue(undefined),
    invalidateRealmCache: jest.fn().mockResolvedValue(undefined),
    getCachedRealmByName: jest.fn().mockResolvedValue(null),
    cacheRealmByName: jest.fn().mockResolvedValue(undefined),
    getCachedJWKS: jest.fn().mockResolvedValue(null),
    cacheJWKS: jest.fn().mockResolvedValue(undefined),
  };
}

function createMockThemeService() {
  return {
    getAvailableThemes: jest.fn().mockReturnValue([]),
    getTheme: jest.fn().mockReturnValue(null),
  };
}

describe('RealmsService', () => {
  let service: RealmsService;
  let prisma: MockPrismaService;
  let jwkService: { generateRsaKeyPair: jest.Mock };
  let cacheService: ReturnType<typeof createMockCacheService>;
  let themeService: ReturnType<typeof createMockThemeService>;

  const mockRealm = {
    id: 'realm-1',
    name: 'test-realm',
    displayName: 'Test Realm',
    enabled: true,
    accessTokenLifespan: 300,
    refreshTokenLifespan: 1800,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockKeyPair = {
    kid: 'kid-1',
    publicKeyPem: '-----BEGIN PUBLIC KEY-----\nfake\n-----END PUBLIC KEY-----',
    privateKeyPem:
      '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----',
  };

  beforeEach(() => {
    prisma = createMockPrismaService();
    jwkService = {
      generateRsaKeyPair: jest.fn(),
    };
    cacheService = createMockCacheService();
    themeService = createMockThemeService();
    const scopeSeedService = {
      seedDefaultScopes: jest.fn().mockResolvedValue(undefined),
      getDefaultScopeNames: jest
        .fn()
        .mockReturnValue(['openid', 'profile', 'email', 'roles']),
      getOptionalScopeNames: jest
        .fn()
        .mockReturnValue(['web-origins', 'offline_access']),
    };
    service = new RealmsService(
      prisma as any,
      jwkService as any,
      scopeSeedService as any,
      themeService as any,
      cacheService as any,
      new CryptoService(),
    );
  });

  describe('create', () => {
    it('should create a realm with a signing key', async () => {
      prisma.realm.findUnique.mockResolvedValue(null);
      jwkService.generateRsaKeyPair.mockResolvedValue(mockKeyPair);
      prisma.realm.create.mockResolvedValue(mockRealm);

      const result = await service.create({
        name: 'test-realm',
        displayName: 'Test Realm',
      });

      expect(result).toEqual(mockRealm);
      expect(jwkService.generateRsaKeyPair).toHaveBeenCalled();
      expect(prisma.realm.create).toHaveBeenCalledWith({
        data: {
          name: 'test-realm',
          displayName: 'Test Realm',
          enabled: undefined,
          accessTokenLifespan: undefined,
          refreshTokenLifespan: undefined,
          signingKeys: {
            create: {
              kid: 'kid-1',
              algorithm: 'RS256',
              publicKey: mockKeyPair.publicKeyPem,
              privateKey: mockKeyPair.privateKeyPem,
            },
          },
        },
      });
    });

    it('should throw ConflictException when realm name already exists', async () => {
      prisma.realm.findUnique.mockResolvedValue(mockRealm);

      await expect(service.create({ name: 'test-realm' })).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('secret encryption', () => {
    const crypto = new CryptoService();

    beforeEach(() => {
      prisma.realm.findUnique.mockResolvedValue(null);
      jwkService.generateRsaKeyPair.mockResolvedValue(mockKeyPair);
      prisma.realm.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ ...mockRealm, ...data }),
      );
    });

    it('should encrypt smtpPassword, recaptchaSecretKey, and hcaptchaSecretKey on create', async () => {
      await service.create({
        name: 'test-realm',
        smtpPassword: 'plain-smtp-pass',
        recaptchaSecretKey: 'plain-recaptcha-secret',
        hcaptchaSecretKey: 'plain-hcaptcha-secret',
      });

      const { data } = prisma.realm.create.mock.calls[0][0];
      expect(data.smtpPassword).not.toBe('plain-smtp-pass');
      expect(crypto.decrypt(data.smtpPassword)).toBe('plain-smtp-pass');
      expect(data.recaptchaSecretKey).not.toBe('plain-recaptcha-secret');
      expect(crypto.decrypt(data.recaptchaSecretKey)).toBe(
        'plain-recaptcha-secret',
      );
      expect(data.hcaptchaSecretKey).not.toBe('plain-hcaptcha-secret');
      expect(crypto.decrypt(data.hcaptchaSecretKey)).toBe(
        'plain-hcaptcha-secret',
      );
    });

    it('should encrypt nested emailProviderConfig secrets but not the from/domain/region fields', async () => {
      await service.create({
        name: 'test-realm',
        emailProviderConfig: {
          resend: { apiKey: 're_plain', from: 'hello@example.com' },
          postmark: { serverToken: 'tok_plain', from: 'hello@example.com' },
        },
      });

      const { data } = prisma.realm.create.mock.calls[0][0];
      const config = data.emailProviderConfig as any;
      expect(config.resend.apiKey).not.toBe('re_plain');
      expect(crypto.decrypt(config.resend.apiKey)).toBe('re_plain');
      expect(config.resend.from).toBe('hello@example.com');
      expect(config.postmark.serverToken).not.toBe('tok_plain');
      expect(crypto.decrypt(config.postmark.serverToken)).toBe('tok_plain');
      expect(config.postmark.from).toBe('hello@example.com');
    });

    it('should not double-encrypt a smtpPassword that round-trips through update unchanged', async () => {
      const encryptedOnce = crypto.encrypt('plain-smtp-pass');
      prisma.realm.findUnique.mockResolvedValue({
        ...mockRealm,
        smtpPassword: encryptedOnce,
      });
      prisma.realm.update.mockImplementation(({ data }: any) =>
        Promise.resolve({ ...mockRealm, ...data }),
      );

      await service.update('test-realm', { smtpPassword: encryptedOnce });

      const { data } = prisma.realm.update.mock.calls[0][0];
      expect(data.smtpPassword).toBe(encryptedOnce);
      expect(crypto.decrypt(data.smtpPassword)).toBe('plain-smtp-pass');
    });

    it('should not touch smtpPassword on update when the redacted placeholder is sent back', async () => {
      prisma.realm.findUnique.mockResolvedValue(mockRealm);
      prisma.realm.update.mockImplementation(({ data }: any) =>
        Promise.resolve({ ...mockRealm, ...data }),
      );

      await service.update('test-realm', { smtpPassword: '••••••' });

      const { data } = prisma.realm.update.mock.calls[0][0];
      expect(data.smtpPassword).toBeUndefined();
    });

    it('should persist the SMS settings and encrypt the provider credentials', async () => {
      prisma.realm.findUnique.mockResolvedValue(mockRealm);
      prisma.realm.update.mockImplementation(({ data }: any) =>
        Promise.resolve({ ...mockRealm, ...data }),
      );

      await service.update('test-realm', {
        smsMfaEnabled: true,
        smsProvider: SmsProviderType.TWILIO,
        smsFrom: '+15550001111',
        smsProviderConfig: {
          twilioAccountSid: 'AC123',
          twilioAuthToken: 'tw-secret',
        },
        otpLength: 8,
        otpExpirySeconds: 120,
        smsMaxRequestsPerUser: 5,
        smsRateLimitWindow: 600,
      });

      const { data } = prisma.realm.update.mock.calls[0][0];
      expect(data).toMatchObject({
        smsMfaEnabled: true,
        smsProvider: 'twilio',
        smsFrom: '+15550001111',
        otpLength: 8,
        otpExpirySeconds: 120,
        smsMaxRequestsPerUser: 5,
        smsRateLimitWindow: 600,
      });
      expect(data.smsProviderConfig.twilioAccountSid).toBe('AC123');
      expect(data.smsProviderConfig.twilioAuthToken).not.toBe('tw-secret');
      expect(crypto.decrypt(data.smsProviderConfig.twilioAuthToken)).toBe(
        'tw-secret',
      );
    });

    it('should keep the stored SMS secret when the placeholder is sent back', async () => {
      const stored = crypto.encrypt('tw-secret');
      prisma.realm.findUnique.mockResolvedValue({
        ...mockRealm,
        smsProviderConfig: {
          twilioAccountSid: 'AC123',
          twilioAuthToken: stored,
        },
      });
      prisma.realm.update.mockImplementation(({ data }: any) =>
        Promise.resolve({ ...mockRealm, ...data }),
      );

      const result = await service.update('test-realm', {
        smsProviderConfig: {
          twilioAccountSid: 'AC999',
          twilioAuthToken: SECRET_PLACEHOLDER,
        },
      });

      const { data } = prisma.realm.update.mock.calls[0][0];
      expect(data.smsProviderConfig).toEqual({
        twilioAccountSid: 'AC999',
        twilioAuthToken: stored,
      });
      // ...and the response never carries the ciphertext
      expect((result as any).smsProviderConfig.twilioAuthToken).toBe(
        SECRET_PLACEHOLDER,
      );
    });

    it('should not return stored secrets in the delete response', async () => {
      const row = {
        ...mockRealm,
        smtpPassword: crypto.encrypt('smtp'),
        smsProviderConfig: { twilioAuthToken: crypto.encrypt('tw-secret') },
      };
      prisma.realm.findUnique.mockResolvedValue(row);
      prisma.realm.delete.mockResolvedValue(row);

      const deleted = (await service.remove('test-realm')) as any;

      expect(deleted.smtpPassword).toBe(SECRET_PLACEHOLDER);
      expect(deleted.smsProviderConfig.twilioAuthToken).toBe(
        SECRET_PLACEHOLDER,
      );
    });

    it('should never return SMS secrets from findByName', async () => {
      cacheService.getCachedRealmByName.mockResolvedValue(null);
      prisma.realm.findUnique.mockResolvedValue({
        ...mockRealm,
        smsProviderConfig: {
          twilioAccountSid: 'AC123',
          twilioAuthToken: crypto.encrypt('tw-secret'),
        },
      });

      const realm = (await service.findByName('test-realm')) as any;

      expect(realm.smsProviderConfig).toEqual({
        twilioAccountSid: 'AC123',
        twilioAuthToken: SECRET_PLACEHOLDER,
      });
    });

    it('should keep the stored email API key when the placeholder is sent back, and never return it', async () => {
      const stored = crypto.encrypt('SG.original');
      prisma.realm.findUnique.mockResolvedValue({
        ...mockRealm,
        emailProviderConfig: {
          sendgrid: { apiKey: stored, from: 'old@x.test' },
        },
      });
      prisma.realm.update.mockImplementation(({ data }: any) =>
        Promise.resolve({ ...mockRealm, ...data }),
      );

      const result = (await service.update('test-realm', {
        emailProviderConfig: {
          sendgrid: { apiKey: SECRET_PLACEHOLDER, from: 'new@x.test' },
        },
      })) as any;

      const { data } = prisma.realm.update.mock.calls[0][0];
      expect(data.emailProviderConfig.sendgrid).toEqual({
        apiKey: stored,
        from: 'new@x.test',
      });
      expect(result.emailProviderConfig.sendgrid).toEqual({
        apiKey: SECRET_PLACEHOLDER,
        from: 'new@x.test',
      });
    });

    it('should never return email provider secrets from findByName', async () => {
      cacheService.getCachedRealmByName.mockResolvedValue(null);
      prisma.realm.findUnique.mockResolvedValue({
        ...mockRealm,
        emailProviderConfig: {
          postmark: { serverToken: crypto.encrypt('pm'), from: 'a@x.test' },
        },
      });

      const realm = (await service.findByName('test-realm')) as any;

      expect(realm.emailProviderConfig.postmark).toEqual({
        serverToken: SECRET_PLACEHOLDER,
        from: 'a@x.test',
      });
    });
  });

  describe('findAll', () => {
    it('should return all realms ordered by createdAt', async () => {
      const realms = [
        mockRealm,
        { ...mockRealm, id: 'realm-2', name: 'other' },
      ];
      prisma.realm.findMany.mockResolvedValue(realms);

      const result = await service.findAll();

      expect(result).toEqual(realms);
      expect(prisma.realm.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'asc' },
      });
    });

    it('should return an empty array when no realms exist', async () => {
      prisma.realm.findMany.mockResolvedValue([]);

      const result = await service.findAll();

      expect(result).toEqual([]);
    });
  });

  describe('findByName', () => {
    it('should return the realm when found', async () => {
      prisma.realm.findUnique.mockResolvedValue(mockRealm);

      const result = await service.findByName('test-realm');

      expect(result).toEqual(mockRealm);
      expect(prisma.realm.findUnique).toHaveBeenCalledWith({
        where: { name: 'test-realm' },
      });
    });

    it('should throw NotFoundException when realm does not exist', async () => {
      prisma.realm.findUnique.mockResolvedValue(null);

      await expect(service.findByName('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('should update and return the realm', async () => {
      prisma.realm.findUnique.mockResolvedValue(mockRealm);
      const updatedRealm = { ...mockRealm, displayName: 'Updated Realm' };
      prisma.realm.update.mockResolvedValue(updatedRealm);

      const result = await service.update('test-realm', {
        displayName: 'Updated Realm',
      });

      expect(result).toEqual(updatedRealm);
      expect(prisma.realm.update).toHaveBeenCalledWith({
        where: { name: 'test-realm' },
        data: {
          displayName: 'Updated Realm',
          enabled: undefined,
          accessTokenLifespan: undefined,
          refreshTokenLifespan: undefined,
        },
      });
    });

    it('should throw NotFoundException when realm does not exist', async () => {
      prisma.realm.findUnique.mockResolvedValue(null);

      await expect(
        service.update('nonexistent', { displayName: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });

    // idenplane#1558: the flag was accepted nowhere, so it could never be saved.
    it('should persist the WebAuthn settings, including user verification', async () => {
      prisma.realm.findUnique.mockResolvedValue(mockRealm);
      prisma.realm.update.mockResolvedValue(mockRealm);

      await service.update('test-realm', {
        webAuthnEnabled: true,
        webAuthnRpName: 'Homelab',
        webAuthnRpId: 'auth.example.com',
        webAuthnUserVerificationRequired: true,
      });

      const { data } = prisma.realm.update.mock.calls[0][0];
      expect(data).toMatchObject({
        webAuthnEnabled: true,
        webAuthnRpName: 'Homelab',
        webAuthnRpId: 'auth.example.com',
        webAuthnUserVerificationRequired: true,
      });
    });
  });

  describe('remove', () => {
    it('should delete the realm', async () => {
      prisma.realm.findUnique.mockResolvedValue(mockRealm);
      prisma.realm.delete.mockResolvedValue(mockRealm);

      const result = await service.remove('test-realm');

      expect(result).toEqual(mockRealm);
      expect(prisma.realm.delete).toHaveBeenCalledWith({
        where: { name: 'test-realm' },
      });
    });

    it('should throw NotFoundException when realm does not exist', async () => {
      prisma.realm.findUnique.mockResolvedValue(null);

      await expect(service.remove('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
