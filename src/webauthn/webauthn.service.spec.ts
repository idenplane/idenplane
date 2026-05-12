import { WebAuthnService } from './webauthn.service.js';
import {
  createMockPrismaService,
  type MockPrismaService,
} from '../prisma/prisma.mock.js';
import {
  ForbiddenException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';

// ── Module-level mocks ────────────────────────────────────────────────

jest.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: jest.fn(),
  verifyRegistrationResponse: jest.fn(),
  generateAuthenticationOptions: jest.fn(),
  verifyAuthenticationResponse: jest.fn(),
}));

import * as simpleWebAuthn from '@simplewebauthn/server';

// ── Helpers ───────────────────────────────────────────────────────────

function createMockCryptoService() {
  return {
    sha256: jest.fn().mockImplementation((input: string) => `hash:${input}`),
    generateSecret: jest.fn().mockReturnValue('MOCK_SECRET'),
  };
}

function makeRealm(overrides: Record<string, any> = {}) {
  return {
    id: 'realm-1',
    name: 'test-realm',
    displayName: 'Test Realm',
    webAuthnEnabled: true,
    webAuthnRpId: 'localhost',
    webAuthnRpName: 'Test Realm',
    ...overrides,
  } as any;
}

function makeUser(overrides: Record<string, any> = {}) {
  return {
    id: 'user-1',
    username: 'alice',
    firstName: 'Alice',
    lastName: 'Smith',
    email: 'alice@example.com',
    ...overrides,
  } as any;
}

function makeCredential(overrides: Record<string, any> = {}) {
  return {
    id: 'cred-db-1',
    userId: 'user-1',
    realmId: 'realm-1',
    credentialId: 'credId123',
    publicKey: Buffer.from([1, 2, 3]),
    counter: BigInt(5),
    transports: ['internal'],
    deviceType: 'singleDevice',
    backedUp: false,
    friendlyName: 'My Phone',
    createdAt: new Date('2025-01-01'),
    lastUsedAt: null,
    user: makeUser(),
    ...overrides,
  };
}

// ── Test Suite ────────────────────────────────────────────────────────

describe('WebAuthnService', () => {
  let service: WebAuthnService;
  let prisma: MockPrismaService;
  let crypto: ReturnType<typeof createMockCryptoService>;

  beforeEach(() => {
    prisma = createMockPrismaService();
    crypto = createMockCryptoService();
    service = new WebAuthnService(prisma as any, crypto as any);
    jest.clearAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────
  // generateRegistrationOptions
  // ──────────────────────────────────────────────────────────────────────

  describe('generateRegistrationOptions', () => {
    it('should throw ForbiddenException when WebAuthn is disabled', async () => {
      const realm = makeRealm({ webAuthnEnabled: false });

      await expect(
        service.generateRegistrationOptions(makeUser(), realm),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should call generateRegistrationOptions with correct rpId and rpName', async () => {
      const realm = makeRealm();
      prisma.webAuthnCredential.findMany.mockResolvedValue([]);
      prisma.pendingAction.deleteMany.mockResolvedValue({ count: 0 });
      prisma.pendingAction.create.mockResolvedValue({} as any);

      const mockOptions = {
        challenge: 'mock-challenge',
        user: { id: 'user-1' },
      };
      (
        simpleWebAuthn.generateRegistrationOptions as jest.Mock
      ).mockResolvedValue(mockOptions);

      const result = await service.generateRegistrationOptions(
        makeUser(),
        realm,
      );

      expect(simpleWebAuthn.generateRegistrationOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          rpID: 'localhost',
          rpName: 'Test Realm',
        }),
      );
      expect(result).toBe(mockOptions);
    });

    it('should exclude existing credentials', async () => {
      const realm = makeRealm();
      const existingCred = makeCredential();
      prisma.webAuthnCredential.findMany.mockResolvedValue([existingCred]);
      prisma.pendingAction.deleteMany.mockResolvedValue({ count: 0 });
      prisma.pendingAction.create.mockResolvedValue({} as any);

      const mockOptions = { challenge: 'mock-challenge' };
      (
        simpleWebAuthn.generateRegistrationOptions as jest.Mock
      ).mockResolvedValue(mockOptions);

      await service.generateRegistrationOptions(makeUser(), realm);

      expect(simpleWebAuthn.generateRegistrationOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          excludeCredentials: [expect.objectContaining({ id: 'credId123' })],
        }),
      );
    });

    it('should store the challenge in PendingAction', async () => {
      const realm = makeRealm();
      prisma.webAuthnCredential.findMany.mockResolvedValue([]);
      prisma.pendingAction.deleteMany.mockResolvedValue({ count: 0 });
      prisma.pendingAction.create.mockResolvedValue({} as any);

      const mockOptions = { challenge: 'challenge-abc' };
      (
        simpleWebAuthn.generateRegistrationOptions as jest.Mock
      ).mockResolvedValue(mockOptions);

      await service.generateRegistrationOptions(makeUser(), realm);

      expect(prisma.pendingAction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'webauthn_registration_challenge',
            data: expect.objectContaining({ challenge: 'challenge-abc' }),
          }),
        }),
      );
    });

    it('should use realm name as rpName when webAuthnRpName is null', async () => {
      const realm = makeRealm({
        webAuthnRpName: null,
        displayName: null,
        name: 'my-realm',
      });
      prisma.webAuthnCredential.findMany.mockResolvedValue([]);
      prisma.pendingAction.deleteMany.mockResolvedValue({ count: 0 });
      prisma.pendingAction.create.mockResolvedValue({} as any);

      const mockOptions = { challenge: 'c' };
      (
        simpleWebAuthn.generateRegistrationOptions as jest.Mock
      ).mockResolvedValue(mockOptions);

      await service.generateRegistrationOptions(makeUser(), realm);

      expect(simpleWebAuthn.generateRegistrationOptions).toHaveBeenCalledWith(
        expect.objectContaining({ rpName: 'my-realm' }),
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // verifyRegistration
  // ──────────────────────────────────────────────────────────────────────

  describe('verifyRegistration', () => {
    const mockResponse = { id: 'credId-new', rawId: 'credId-new' } as any;

    it('should throw ForbiddenException when WebAuthn is disabled', async () => {
      const realm = makeRealm({ webAuthnEnabled: false });

      await expect(
        service.verifyRegistration(makeUser(), realm, mockResponse),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException when challenge not found', async () => {
      const realm = makeRealm();
      // pendingAction not found
      prisma.pendingAction.findUnique.mockResolvedValue(null);

      await expect(
        service.verifyRegistration(makeUser(), realm, mockResponse),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when verification fails', async () => {
      const realm = makeRealm();

      // Provide a valid pending action
      prisma.pendingAction.findUnique.mockResolvedValue({
        id: 'action-1',
        type: 'webauthn_registration_challenge',
        data: { challenge: 'expected-challenge' } as any,
        expiresAt: new Date(Date.now() + 60_000),
      } as any);
      prisma.pendingAction.delete.mockResolvedValue({} as any);

      (
        simpleWebAuthn.verifyRegistrationResponse as jest.Mock
      ).mockResolvedValue({
        verified: false,
        registrationInfo: null,
      });

      await expect(
        service.verifyRegistration(makeUser(), realm, mockResponse),
      ).rejects.toThrow(BadRequestException);
    });

    it('should store credential and return it on success', async () => {
      const realm = makeRealm();

      prisma.pendingAction.findUnique.mockResolvedValue({
        id: 'action-1',
        type: 'webauthn_registration_challenge',
        data: { challenge: 'expected-challenge' } as any,
        expiresAt: new Date(Date.now() + 60_000),
      } as any);
      prisma.pendingAction.delete.mockResolvedValue({} as any);
      prisma.webAuthnCredential.findUnique.mockResolvedValue(null); // no duplicate
      prisma.webAuthnCredential.create.mockResolvedValue(
        makeCredential() as any,
      );

      (
        simpleWebAuthn.verifyRegistrationResponse as jest.Mock
      ).mockResolvedValue({
        verified: true,
        registrationInfo: {
          credential: {
            id: 'credId-new',
            publicKey: new Uint8Array([1, 2, 3]),
            counter: 0,
            transports: ['internal'],
          },
          credentialDeviceType: 'singleDevice',
          credentialBackedUp: false,
        },
      });

      const result = await service.verifyRegistration(
        makeUser(),
        realm,
        mockResponse,
        'My Phone',
      );

      expect(prisma.webAuthnCredential.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            realmId: 'realm-1',
            credentialId: 'credId-new',
            friendlyName: 'My Phone',
          }),
        }),
      );
      expect(result).toEqual(makeCredential());
    });

    it('should throw BadRequestException when credential is already registered', async () => {
      const realm = makeRealm();

      prisma.pendingAction.findUnique.mockResolvedValue({
        id: 'action-1',
        type: 'webauthn_registration_challenge',
        data: { challenge: 'expected-challenge' } as any,
        expiresAt: new Date(Date.now() + 60_000),
      } as any);
      prisma.pendingAction.delete.mockResolvedValue({} as any);

      (
        simpleWebAuthn.verifyRegistrationResponse as jest.Mock
      ).mockResolvedValue({
        verified: true,
        registrationInfo: {
          credential: {
            id: 'credId-new',
            publicKey: new Uint8Array([1, 2, 3]),
            counter: 0,
            transports: [],
          },
          credentialDeviceType: 'singleDevice',
          credentialBackedUp: false,
        },
      });

      // Duplicate credential
      prisma.webAuthnCredential.findUnique.mockResolvedValue(
        makeCredential() as any,
      );

      await expect(
        service.verifyRegistration(makeUser(), realm, mockResponse),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // generateAuthenticationOptions
  // ──────────────────────────────────────────────────────────────────────

  describe('generateAuthenticationOptions', () => {
    it('should throw ForbiddenException when WebAuthn is disabled', async () => {
      const realm = makeRealm({ webAuthnEnabled: false });

      await expect(
        service.generateAuthenticationOptions(realm),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should generate options without allowCredentials for usernameless flow', async () => {
      const realm = makeRealm();
      const mockOptions = { challenge: 'auth-challenge' };
      (
        simpleWebAuthn.generateAuthenticationOptions as jest.Mock
      ).mockResolvedValue(mockOptions);

      prisma.pendingAction.deleteMany.mockResolvedValue({ count: 0 });
      prisma.pendingAction.create.mockResolvedValue({} as any);

      const result = await service.generateAuthenticationOptions(realm);

      expect(simpleWebAuthn.generateAuthenticationOptions).toHaveBeenCalledWith(
        expect.objectContaining({ rpID: 'localhost' }),
      );
      expect(result).toBe(mockOptions);
    });

    it('should set allowCredentials when userId is provided', async () => {
      const realm = makeRealm();
      const cred = makeCredential();
      prisma.webAuthnCredential.findMany.mockResolvedValue([cred]);

      const mockOptions = { challenge: 'auth-challenge' };
      (
        simpleWebAuthn.generateAuthenticationOptions as jest.Mock
      ).mockResolvedValue(mockOptions);

      prisma.pendingAction.deleteMany.mockResolvedValue({ count: 0 });
      prisma.pendingAction.create.mockResolvedValue({} as any);
      prisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        realmId: 'realm-1',
      });

      await service.generateAuthenticationOptions(realm, 'user-1');

      expect(simpleWebAuthn.generateAuthenticationOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          allowCredentials: [expect.objectContaining({ id: 'credId123' })],
        }),
      );
    });

    it('should store challenge in PendingAction with realm key for usernameless flow', async () => {
      const realm = makeRealm();
      (
        simpleWebAuthn.generateAuthenticationOptions as jest.Mock
      ).mockResolvedValue({ challenge: 'ch' });

      prisma.pendingAction.deleteMany.mockResolvedValue({ count: 0 });
      prisma.pendingAction.create.mockResolvedValue({} as any);

      await service.generateAuthenticationOptions(realm);

      expect(prisma.pendingAction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'webauthn_authentication_challenge',
            data: expect.objectContaining({
              challenge: 'ch',
              key: 'realm:realm-1',
            }),
          }),
        }),
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // verifyAuthentication
  // ──────────────────────────────────────────────────────────────────────

  describe('verifyAuthentication', () => {
    const mockResponse = { id: 'credId123', rawId: 'credId123' } as any;

    it('should throw ForbiddenException when WebAuthn is disabled', async () => {
      const realm = makeRealm({ webAuthnEnabled: false });

      await expect(
        service.verifyAuthentication(realm, mockResponse),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException when credential is not found', async () => {
      const realm = makeRealm();
      prisma.webAuthnCredential.findUnique.mockResolvedValue(null);

      await expect(
        service.verifyAuthentication(realm, mockResponse),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when credential belongs to different realm', async () => {
      const realm = makeRealm();
      prisma.webAuthnCredential.findUnique.mockResolvedValue(
        makeCredential({ realmId: 'other-realm' }) as any,
      );

      await expect(
        service.verifyAuthentication(realm, mockResponse),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException when no challenge found', async () => {
      const realm = makeRealm();
      prisma.webAuthnCredential.findUnique.mockResolvedValue(
        makeCredential() as any,
      );
      // No pending action found
      prisma.pendingAction.findUnique.mockResolvedValue(null);

      await expect(
        service.verifyAuthentication(realm, mockResponse),
      ).rejects.toThrow(BadRequestException);
    });

    it('should verify assertion and update counter on success', async () => {
      const realm = makeRealm();
      const cred = makeCredential();

      prisma.webAuthnCredential.findUnique.mockResolvedValue(cred as any);

      // Provide challenge via pending action
      prisma.pendingAction.findUnique.mockResolvedValue({
        id: 'action-1',
        type: 'webauthn_authentication_challenge',
        data: { challenge: 'expected-challenge' } as any,
        expiresAt: new Date(Date.now() + 60_000),
      } as any);
      prisma.pendingAction.delete.mockResolvedValue({} as any);
      prisma.webAuthnCredential.update.mockResolvedValue(cred as any);

      (
        simpleWebAuthn.verifyAuthenticationResponse as jest.Mock
      ).mockResolvedValue({
        verified: true,
        authenticationInfo: { newCounter: 6 },
      });

      const result = await service.verifyAuthentication(realm, mockResponse);

      expect(result.user).toEqual(cred.user);
      expect(result.credential).toBe(cred);
      expect(prisma.webAuthnCredential.update).toHaveBeenCalledWith({
        where: { id: cred.id },
        data: expect.objectContaining({
          counter: BigInt(6),
          lastUsedAt: expect.any(Date),
        }),
      });
    });

    it('should throw BadRequestException when verification returns verified=false', async () => {
      const realm = makeRealm();
      const cred = makeCredential();

      prisma.webAuthnCredential.findUnique.mockResolvedValue(cred as any);
      prisma.pendingAction.findUnique.mockResolvedValue({
        id: 'action-1',
        type: 'webauthn_authentication_challenge',
        data: { challenge: 'expected-challenge' } as any,
        expiresAt: new Date(Date.now() + 60_000),
      } as any);
      prisma.pendingAction.delete.mockResolvedValue({} as any);

      (
        simpleWebAuthn.verifyAuthenticationResponse as jest.Mock
      ).mockResolvedValue({
        verified: false,
        authenticationInfo: {},
      });

      await expect(
        service.verifyAuthentication(realm, mockResponse),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // getUserCredentials
  // ──────────────────────────────────────────────────────────────────────

  describe('getUserCredentials', () => {
    it('should return credentials ordered by createdAt ascending', async () => {
      const creds = [makeCredential(), makeCredential({ id: 'cred-db-2' })];
      prisma.webAuthnCredential.findMany.mockResolvedValue(creds as any);

      const result = await service.getUserCredentials('user-1');

      expect(prisma.webAuthnCredential.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { createdAt: 'asc' },
      });
      expect(result).toBe(creds);
    });

    it('should return empty array when user has no credentials', async () => {
      prisma.webAuthnCredential.findMany.mockResolvedValue([]);

      const result = await service.getUserCredentials('user-1');

      expect(result).toEqual([]);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // removeCredential
  // ──────────────────────────────────────────────────────────────────────

  describe('removeCredential', () => {
    it('should throw NotFoundException when credential does not exist', async () => {
      prisma.webAuthnCredential.findFirst.mockResolvedValue(null);

      await expect(
        service.removeCredential('user-1', 'realm-1', 'cred-db-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when credential belongs to different user', async () => {
      prisma.webAuthnCredential.findFirst.mockResolvedValue(null);

      await expect(
        service.removeCredential('user-1', 'realm-1', 'cred-db-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when credential belongs to different realm', async () => {
      prisma.webAuthnCredential.findFirst.mockResolvedValue(null);

      await expect(
        service.removeCredential('user-1', 'wrong-realm', 'cred-db-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should delete the credential when it belongs to the user and realm', async () => {
      const cred = makeCredential();
      prisma.webAuthnCredential.findFirst.mockResolvedValue(cred as any);
      prisma.webAuthnCredential.delete.mockResolvedValue(cred as any);

      await service.removeCredential('user-1', 'realm-1', 'cred-db-1');

      expect(prisma.webAuthnCredential.delete).toHaveBeenCalledWith({
        where: { id: 'cred-db-1' },
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // hasCredentials
  // ──────────────────────────────────────────────────────────────────────

  describe('hasCredentials', () => {
    it('should return true when user has credentials', async () => {
      prisma.webAuthnCredential.count.mockResolvedValue(2);

      const result = await service.hasCredentials('user-1', 'realm-1');

      expect(result).toBe(true);
      expect(prisma.webAuthnCredential.count).toHaveBeenCalledWith({
        where: { userId: 'user-1', realmId: 'realm-1' },
      });
    });

    it('should return false when user has no credentials', async () => {
      prisma.webAuthnCredential.count.mockResolvedValue(0);

      const result = await service.hasCredentials('user-1', 'realm-1');

      expect(result).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // challenge TTL / expiry
  // ──────────────────────────────────────────────────────────────────────

  describe('challenge expiry', () => {
    it('should return null and delete the pending action when challenge is expired', async () => {
      const realm = makeRealm();
      const cred = makeCredential();

      prisma.webAuthnCredential.findUnique.mockResolvedValue(cred as any);
      prisma.pendingAction.findUnique.mockResolvedValue({
        id: 'action-1',
        type: 'webauthn_authentication_challenge',
        data: { challenge: 'old-challenge' } as any,
        expiresAt: new Date(Date.now() - 60_000), // expired
      } as any);
      prisma.pendingAction.delete.mockResolvedValue({} as any);

      // Both user-specific and realm-wide lookups return null
      // (second call also returns null because pendingAction.findUnique is called twice)
      prisma.pendingAction.findUnique
        .mockResolvedValueOnce({
          id: 'action-1',
          type: 'webauthn_authentication_challenge',
          data: { challenge: 'old-challenge' } as any,
          expiresAt: new Date(Date.now() - 60_000),
        } as any)
        .mockResolvedValueOnce(null);

      await expect(
        service.verifyAuthentication(realm, { id: 'credId123' } as any),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.pendingAction.delete).toHaveBeenCalled();
    });
  });
});
