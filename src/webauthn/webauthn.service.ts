import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from '@simplewebauthn/server';
import type { Realm, User, WebAuthnCredential } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';

export interface WebAuthnRegistrationChallenge {
  options: PublicKeyCredentialCreationOptionsJSON;
}

export interface WebAuthnAuthenticationChallenge {
  options: PublicKeyCredentialRequestOptionsJSON;
}

@Injectable()
export class WebAuthnService {
  private readonly logger = new Logger(WebAuthnService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  // ─── Helpers ──────────────────────────────────────────────────────────

  private getRpId(realm: Realm): string {
    return realm.webAuthnRpId ?? 'localhost';
  }

  private getRpName(realm: Realm): string {
    return realm.webAuthnRpName ?? realm.displayName ?? realm.name;
  }

  private getOrigin(rpId: string): string {
    const baseUrl = process.env['BASE_URL'] ?? 'http://localhost:3000';
    try {
      const url = new URL(baseUrl);
      // Use rpId with protocol from BASE_URL
      return `${url.protocol}//${rpId}${url.port && url.port !== '80' && url.port !== '443' ? ':' + url.port : ''}`;
    } catch {
      return `https://${rpId}`;
    }
  }

  // ─── Registration ─────────────────────────────────────────────────────

  async generateRegistrationOptions(
    user: User,
    realm: Realm,
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
    if (!realm.webAuthnEnabled) {
      throw new ForbiddenException('WebAuthn is not enabled for this realm');
    }

    const rpId = this.getRpId(realm);
    const rpName = this.getRpName(realm);

    // Get existing credentials to exclude
    const existingCredentials = await this.prisma.webAuthnCredential.findMany({
      where: { userId: user.id },
    });

    const options = await generateRegistrationOptions({
      rpName,
      rpID: rpId,
      userID: Buffer.from(user.id),
      userName: user.username,
      userDisplayName:
        [user.firstName, user.lastName].filter(Boolean).join(' ') ||
        user.username,
      attestationType: 'none',
      excludeCredentials: existingCredentials.map((cred) => ({
        id: cred.credentialId,
        transports: cred.transports as AuthenticatorTransportFuture[],
      })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });

    // Store challenge in PendingAction for later verification
    await this.storeWebAuthnChallenge(
      user.id,
      realm.id,
      'registration',
      options.challenge,
    );

    return options;
  }

  async verifyRegistration(
    user: User,
    realm: Realm,
    response: RegistrationResponseJSON,
    friendlyName?: string,
  ): Promise<WebAuthnCredential> {
    if (!realm.webAuthnEnabled) {
      throw new ForbiddenException('WebAuthn is not enabled for this realm');
    }

    const rpId = this.getRpId(realm);
    const expectedChallenge = await this.consumeWebAuthnChallenge(
      user.id,
      realm.id,
      'registration',
    );

    if (!expectedChallenge) {
      throw new BadRequestException(
        'Registration challenge expired or not found. Please try again.',
      );
    }

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge,
        expectedOrigin: this.getOrigin(rpId),
        expectedRPID: rpId,
        requireUserVerification: false,
      });
    } catch (err: any) {
      this.logger.warn(
        `WebAuthn registration verification failed: ${err.message}`,
      );
      throw new BadRequestException(
        'Registration verification failed: ' + err.message,
      );
    }

    if (!verification.verified || !verification.registrationInfo) {
      throw new BadRequestException('Registration verification failed');
    }

    const { credential, credentialDeviceType, credentialBackedUp } =
      verification.registrationInfo;

    // Check for duplicate credential
    const existing = await this.prisma.webAuthnCredential.findUnique({
      where: { credentialId: credential.id },
    });
    if (existing) {
      throw new BadRequestException('This passkey is already registered');
    }

    const stored = await this.prisma.webAuthnCredential.create({
      data: {
        userId: user.id,
        realmId: realm.id,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports ?? [],
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
        friendlyName: friendlyName ?? null,
      },
    });

    this.logger.log(
      `WebAuthn credential registered for user ${user.id} in realm ${realm.id}`,
    );
    return stored;
  }

  // ─── Authentication ────────────────────────────────────────────────────

  async generateAuthenticationOptions(
    realm: Realm,
    userId?: string,
  ): Promise<PublicKeyCredentialRequestOptionsJSON> {
    if (!realm.webAuthnEnabled) {
      throw new ForbiddenException('WebAuthn is not enabled for this realm');
    }

    const rpId = this.getRpId(realm);

    let allowCredentials:
      | { id: string; transports: AuthenticatorTransportFuture[] }[]
      | undefined;
    if (userId) {
      const user = await this.prisma.user.findFirst({
        where: { id: userId, realmId: realm.id },
      });
      if (!user) {
        throw new NotFoundException(`User '${userId}' not found in realm`);
      }
      const credentials = await this.prisma.webAuthnCredential.findMany({
        where: { userId, realmId: realm.id },
      });
      if (credentials.length > 0) {
        allowCredentials = credentials.map((c) => ({
          id: c.credentialId,
          transports: c.transports as AuthenticatorTransportFuture[],
        }));
      }
    }

    const options = await generateAuthenticationOptions({
      rpID: rpId,
      allowCredentials,
      userVerification: 'preferred',
    });

    // Store challenge — keyed by realm for usernameless flow, or by user for user-specific
    const challengeKey = userId ?? `realm:${realm.id}`;
    await this.storeWebAuthnChallenge(
      challengeKey,
      realm.id,
      'authentication',
      options.challenge,
    );

    return options;
  }

  async verifyAuthentication(
    realm: Realm,
    response: AuthenticationResponseJSON,
  ): Promise<{ user: User; credential: WebAuthnCredential }> {
    if (!realm.webAuthnEnabled) {
      throw new ForbiddenException('WebAuthn is not enabled for this realm');
    }

    const rpId = this.getRpId(realm);

    // Find the credential being used
    const credential = await this.prisma.webAuthnCredential.findUnique({
      where: { credentialId: response.id },
      include: { user: true },
    });

    if (!credential) {
      throw new NotFoundException('Passkey not found');
    }

    if (credential.realmId !== realm.id) {
      throw new ForbiddenException('Passkey does not belong to this realm');
    }

    // Try user-specific challenge first, then realm-level (usernameless)
    let expectedChallenge = await this.consumeWebAuthnChallenge(
      credential.userId,
      realm.id,
      'authentication',
    );

    if (!expectedChallenge) {
      expectedChallenge = await this.consumeWebAuthnChallenge(
        `realm:${realm.id}`,
        realm.id,
        'authentication',
      );
    }

    if (!expectedChallenge) {
      throw new BadRequestException(
        'Authentication challenge expired or not found. Please try again.',
      );
    }

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: this.getOrigin(rpId),
        expectedRPID: rpId,
        credential: {
          id: credential.credentialId,
          publicKey: new Uint8Array(credential.publicKey),
          counter: Number(credential.counter),
          transports: credential.transports as AuthenticatorTransportFuture[],
        },
        requireUserVerification: false,
      });
    } catch (err: any) {
      this.logger.warn(
        `WebAuthn authentication verification failed: ${err.message}`,
      );
      throw new BadRequestException(
        'Authentication verification failed: ' + err.message,
      );
    }

    if (!verification.verified) {
      throw new BadRequestException('Authentication verification failed');
    }

    const newCounter = verification.authenticationInfo.newCounter;
    if (newCounter <= credential.counter) {
      throw new BadRequestException('Counter rollback detected');
    }

    // Update counter and lastUsedAt
    await this.prisma.webAuthnCredential.update({
      where: { id: credential.id },
      data: {
        counter: BigInt(newCounter),
        lastUsedAt: new Date(),
      },
    });

    return { user: credential.user, credential };
  }

  // ─── Credential management ────────────────────────────────────────────

  async getUserCredentials(userId: string): Promise<WebAuthnCredential[]> {
    return this.prisma.webAuthnCredential.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async removeCredential(
    userId: string,
    realmId: string,
    credentialId: string,
  ): Promise<void> {
    const credential = await this.prisma.webAuthnCredential.findFirst({
      where: { id: credentialId, userId, realmId },
    });

    if (!credential) {
      throw new NotFoundException('Credential not found');
    }

    await this.prisma.webAuthnCredential.delete({
      where: { id: credentialId },
    });
    this.logger.log(
      `WebAuthn credential ${credentialId} removed for user ${userId}`,
    );
  }

  async hasCredentials(userId: string, realmId: string): Promise<boolean> {
    const count = await this.prisma.webAuthnCredential.count({
      where: { userId, realmId },
    });
    return count > 0;
  }

  // ─── Challenge store (via PendingAction) ──────────────────────────────

  private async storeWebAuthnChallenge(
    key: string,
    realmId: string,
    type: 'registration' | 'authentication',
    challenge: string,
  ): Promise<void> {
    const actionType = `webauthn_${type}_challenge`;
    const tokenHash = this.crypto.sha256(`${key}:${realmId}:${actionType}`);

    // Upsert (delete old, create new) to handle repeated requests
    await this.prisma.pendingAction.deleteMany({
      where: { tokenHash },
    });

    await this.prisma.pendingAction.create({
      data: {
        tokenHash,
        type: actionType,
        data: { key, realmId, challenge },
        expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5-minute TTL
      },
    });
  }

  private async consumeWebAuthnChallenge(
    key: string,
    realmId: string,
    type: 'registration' | 'authentication',
  ): Promise<string | null> {
    const actionType = `webauthn_${type}_challenge`;
    const tokenHash = this.crypto.sha256(`${key}:${realmId}:${actionType}`);

    const action = await this.prisma.pendingAction.findUnique({
      where: { tokenHash },
    });

    if (!action || action.type !== actionType) return null;
    if (action.expiresAt < new Date()) {
      await this.prisma.pendingAction.delete({ where: { id: action.id } });
      return null;
    }

    await this.prisma.pendingAction.delete({ where: { id: action.id } });

    const data = action.data as Record<string, unknown>;
    return data['challenge'] as string;
  }
}
