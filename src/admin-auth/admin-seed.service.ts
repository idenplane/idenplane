import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { JwkService } from '../crypto/jwk.service.js';
import { ScopeSeedService } from '../scopes/scope-seed.service.js';

/** The advisory lock first-boot seeding takes (an arbitrary constant). */
const MASTER_SEED_LOCK_KEY = 7_204_311_862;

@Injectable()
export class AdminSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminSeedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly jwkService: JwkService,
    private readonly config: ConfigService,
    private readonly scopeSeedService: ScopeSeedService,
  ) {}

  async onApplicationBootstrap() {
    await this.ensureMasterRealm();
  }

  /**
   * Creates the master realm, its roles and the initial admin on first boot.
   *
   * Several instances can boot on an empty database at once (replicas, a
   * rolling deploy), so the whole seed is one transaction that first takes a
   * PostgreSQL advisory lock and then checks again: one instance seeds, the
   * others find it done. Being one transaction, it can no longer leave a
   * master realm without its admin behind, which every later boot would have
   * taken for done. On other databases the unique realm name decides the
   * race, and the loser treats it as seeded.
   */
  private async ensureMasterRealm() {
    const existing = await this.prisma.realm.findUnique({
      where: { name: 'master' },
    });
    if (existing) {
      this.logger.log('Master realm already exists');
      return;
    }

    this.logger.log('Creating master realm and initial admin user...');

    // The slow parts happen before the lock is taken.
    const keyPair = await this.jwkService.generateRsaKeyPair();
    const adminUsername = this.config.get<string>('ADMIN_USER', 'admin');
    const adminPassword = this.config.get<string>('ADMIN_PASSWORD', 'admin');
    const passwordHash = await this.crypto.hashPassword(adminPassword);
    const isPostgres = /^postgres(ql)?:\/\//i.test(
      process.env['DATABASE_URL'] ?? '',
    );

    let masterRealmId: string | null;
    try {
      masterRealmId = await this.prisma.$transaction(async (tx) => {
        if (isPostgres) {
          await tx.$executeRawUnsafe(
            `SELECT pg_advisory_xact_lock(${MASTER_SEED_LOCK_KEY})`,
          );
          const seeded = await tx.realm.findUnique({
            where: { name: 'master' },
            select: { id: true },
          });
          if (seeded) return null;
        }

        const masterRealm = await tx.realm.create({
          data: {
            name: 'master',
            displayName: 'Master',
            enabled: true,
            signingKeys: {
              create: {
                kid: keyPair.kid,
                algorithm: 'RS256',
                publicKey: keyPair.publicKeyPem,
                privateKey: keyPair.privateKeyPem,
              },
            },
          },
        });

        const superAdmin = await tx.role.create({
          data: {
            realmId: masterRealm.id,
            name: 'super-admin',
            description: 'Full access to all realms and settings',
          },
        });
        await tx.role.create({
          data: {
            realmId: masterRealm.id,
            name: 'realm-admin',
            description: 'Manage specific realms',
          },
        });
        await tx.role.create({
          data: {
            realmId: masterRealm.id,
            name: 'view-only',
            description: 'Read-only access',
          },
        });

        const adminUser = await tx.user.create({
          data: {
            realmId: masterRealm.id,
            username: adminUsername,
            enabled: true,
            passwordHash,
            passwordChangedAt: new Date(),
          },
        });
        await tx.userRole.create({
          data: { userId: adminUser.id, roleId: superAdmin.id },
        });

        return masterRealm.id;
      });
    } catch (err) {
      if ((err as { code?: string }).code !== 'P2002') throw err;
      masterRealmId = null; // another instance created it first
    }

    if (masterRealmId === null) {
      this.logger.log('Master realm was created by another instance');
      return;
    }

    // Idempotent (skips scopes that exist), so it is safe outside the lock.
    await this.scopeSeedService.seedDefaultScopes(masterRealmId);

    this.logger.log(`Master realm created. Admin user: ${adminUsername}`);
  }
}
