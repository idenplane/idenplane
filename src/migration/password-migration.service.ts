import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import * as bcryptjs from 'bcryptjs';
import { pbkdf2Sync } from 'crypto';

@Injectable()
export class PasswordMigrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async verifyMigratedPassword(
    plaintext: string,
    storedHash: string,
    algorithm: string,
  ): Promise<boolean> {
    switch (algorithm) {
      case 'argon2':
        return this.crypto.verifyPassword(storedHash, plaintext);
      case 'bcrypt':
        return this.verifyBcrypt(plaintext, storedHash);
      case 'pbkdf2-sha256':
        return this.verifyPbkdf2(plaintext, storedHash);
      default:
        return false;
    }
  }

  private async verifyBcrypt(
    plaintext: string,
    hash: string,
  ): Promise<boolean> {
    return bcryptjs.compare(plaintext, hash);
  }

  private verifyPbkdf2(plaintext: string, storedHash: string): boolean {
    // Keycloak PBKDF2 format: iterations are stored separately
    // Format variations: base64(salt):base64(hash) with iterations in credential metadata
    // Or: iterations$base64(salt)$base64(hash)
    try {
      const parts = storedHash.split('$');
      if (parts.length === 3) {
        const iterations = parseInt(parts[0], 10);
        const salt = Buffer.from(parts[1], 'base64');
        const hash = Buffer.from(parts[2], 'base64');
        const derived = pbkdf2Sync(
          plaintext,
          salt,
          iterations,
          hash.length,
          'sha256',
        );
        return derived.equals(hash);
      }

      // Alternative format: base64(salt):base64(hash) with default 27500 iterations
      const colonParts = storedHash.split(':');
      if (colonParts.length === 2) {
        const salt = Buffer.from(colonParts[0], 'base64');
        const hash = Buffer.from(colonParts[1], 'base64');
        const derived = pbkdf2Sync(
          plaintext,
          salt,
          27500,
          hash.length,
          'sha256',
        );
        return derived.equals(hash);
      }

      return false;
    } catch {
      return false;
    }
  }

  async rehashToArgon2(userId: string, plaintext: string): Promise<void> {
    const newHash = await this.crypto.hashPassword(plaintext);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newHash, passwordAlgorithm: 'argon2' },
    });
  }
}
