import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';

@Injectable()
export class VerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async createToken(
    userId: string,
    type: string,
    expiresInSeconds: number,
  ): Promise<string> {
    // Delete existing tokens of the same type for this user
    await this.prisma.verificationToken.deleteMany({
      where: { userId, type },
    });

    const rawToken = this.crypto.generateSecret(32);
    const tokenHash = this.crypto.sha256(rawToken);

    await this.prisma.verificationToken.create({
      data: {
        tokenHash,
        userId,
        type,
        expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
      },
    });

    return rawToken;
  }

  /**
   * Like createToken, for a token that is emailed on request (verification
   * resends, password resets): null, and nothing sent, if one of this type
   * was issued to the user less than `cooldownSeconds` ago. Without it,
   * anyone could have any address flooded with mail by repeating the
   * request. Only one token of a type exists at a time, so its creation
   * time is when the last one was sent.
   */
  async createTokenUnlessRecent(
    userId: string,
    type: string,
    expiresInSeconds: number,
    cooldownSeconds = 60,
  ): Promise<string | null> {
    const recent = await this.prisma.verificationToken.findFirst({
      where: {
        userId,
        type,
        createdAt: { gt: new Date(Date.now() - cooldownSeconds * 1000) },
      },
      select: { id: true },
    });
    if (recent) return null;
    return this.createToken(userId, type, expiresInSeconds);
  }

  async createTokenWithHash(
    userId: string,
    type: string,
    expiresInSeconds: number,
    tokenHash: string,
  ): Promise<void> {
    await this.prisma.verificationToken.deleteMany({
      where: { userId, type },
    });

    await this.prisma.verificationToken.create({
      data: {
        tokenHash,
        userId,
        type,
        expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
      },
    });
  }

  async validateToken(
    rawToken: string,
    type: string,
  ): Promise<{ userId: string } | null> {
    const tokenHash = this.crypto.sha256(rawToken);

    const record = await this.prisma.verificationToken.findUnique({
      where: { tokenHash },
    });

    if (!record || record.type !== type || record.expiresAt < new Date()) {
      // Clean up expired token if found
      if (record) {
        await this.prisma.verificationToken.delete({
          where: { id: record.id },
        });
      }
      return null;
    }

    // One-time use: delete the token
    await this.prisma.verificationToken.delete({ where: { id: record.id } });

    return { userId: record.userId };
  }
}
