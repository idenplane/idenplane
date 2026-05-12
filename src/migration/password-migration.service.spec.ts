import { Test } from '@nestjs/testing';
import { PasswordMigrationService } from './password-migration.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import * as bcryptjs from 'bcryptjs';
import { pbkdf2Sync, randomBytes } from 'crypto';

describe('PasswordMigrationService', () => {
  let service: PasswordMigrationService;
  let cryptoService: CryptoService;
  let prisma: any;

  beforeEach(async () => {
    prisma = { user: { update: jest.fn() } };
    const module = await Test.createTestingModule({
      providers: [
        PasswordMigrationService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: CryptoService,
          useValue: {
            verifyPassword: jest.fn(),
            hashPassword: jest.fn().mockResolvedValue('$argon2id$new-hash'),
          },
        },
      ],
    }).compile();

    service = module.get(PasswordMigrationService);
    cryptoService = module.get(CryptoService);
  });

  describe('verifyMigratedPassword', () => {
    it('should delegate argon2 to CryptoService', async () => {
      (cryptoService.verifyPassword as jest.Mock).mockResolvedValue(true);
      const result = await service.verifyMigratedPassword(
        'pass',
        'hash',
        'argon2',
      );
      expect(result).toBe(true);
      expect(cryptoService.verifyPassword).toHaveBeenCalledWith('hash', 'pass');
    });

    it('should verify bcrypt hashes', async () => {
      const hash = bcryptjs.hashSync('mypassword', 10);
      const result = await service.verifyMigratedPassword(
        'mypassword',
        hash,
        'bcrypt',
      );
      expect(result).toBe(true);
    });

    it('should reject wrong bcrypt password', async () => {
      const hash = bcryptjs.hashSync('correct', 10);
      const result = await service.verifyMigratedPassword(
        'wrong',
        hash,
        'bcrypt',
      );
      expect(result).toBe(false);
    });

    it('should verify pbkdf2-sha256 hashes', async () => {
      const salt = randomBytes(16);
      const iterations = 27500;
      const derived = pbkdf2Sync('mypassword', salt, iterations, 32, 'sha256');
      const storedHash = `${iterations}$${salt.toString('base64')}$${derived.toString('base64')}`;
      const result = await service.verifyMigratedPassword(
        'mypassword',
        storedHash,
        'pbkdf2-sha256',
      );
      expect(result).toBe(true);
    });

    it('should reject wrong pbkdf2 password', async () => {
      const salt = randomBytes(16);
      const derived = pbkdf2Sync('correct', salt, 27500, 32, 'sha256');
      const storedHash = `27500$${salt.toString('base64')}$${derived.toString('base64')}`;
      const result = await service.verifyMigratedPassword(
        'wrong',
        storedHash,
        'pbkdf2-sha256',
      );
      expect(result).toBe(false);
    });

    it('should return false for unknown algorithm', async () => {
      const result = await service.verifyMigratedPassword(
        'pass',
        'hash',
        'unknown',
      );
      expect(result).toBe(false);
    });
  });

  describe('rehashToArgon2', () => {
    it('should re-hash and update user', async () => {
      prisma.user.update.mockResolvedValue({});
      await service.rehashToArgon2('user-1', 'mypassword');
      expect(cryptoService.hashPassword).toHaveBeenCalledWith('mypassword');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          passwordHash: '$argon2id$new-hash',
          passwordAlgorithm: 'argon2',
        },
      });
    });
  });
});
