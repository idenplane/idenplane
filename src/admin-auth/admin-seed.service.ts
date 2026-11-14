import { randomBytes } from 'node:crypto';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { JwkService } from '../crypto/jwk.service.js';
import { ScopeSeedService } from '../scopes/scope-seed.service.js';
import { signingKeySecrets } from '../crypto/signing-key-secrets.js';

/** The advisory lock first-boot seeding takes (an arbitrary constant). */
const MASTER_SEED_LOCK_KEY = 7_204_311_862;

/** Shortest initial admin password accepted in production. */
const MIN_PRODUCTION_ADMIN_PASSWORD_LENGTH = 12;

/**
 * Documented defaults and placeholders that must never seed an admin: refused
 * in production, and outside it unless ALLOW_INSECURE_ADMIN_PASSWORD=true.
 * Compared case-insensitively.
 */
const INSECURE_ADMIN_PASSWORDS = new Set([
  'admin',
  'password',
  'changeme',
  'change_this_password',
  'replace_me_with_a_strong_password', // .env.example
]);

/** Bytes of randomness in a generated initial admin password. */
const GENERATED_ADMIN_PASSWORD_BYTES = 24;

/** The initial admin password, and whether it was generated (not configured). */
interface InitialAdminPassword {
  password: string;
  generated: boolean;
}

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
    const adminPassword = this.initialAdminPassword();
    const passwordHash = await this.crypto.hashPassword(adminPassword.password);
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
              create: signingKeySecrets.createData(this.crypto, keyPair),
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

    // Only the instance whose seed was committed reports a generated
    // password: the others generated one too, but it was never stored.
    // This is the only time it is ever shown; a configured password is
    // never logged.
    if (adminPassword.generated) {
      this.logger.warn(
        `ADMIN_PASSWORD is not set, so the initial admin '${adminUsername}' ` +
          `was created with this generated password: ${adminPassword.password} ` +
          '-- it is shown once and never logged again. Sign in to the admin ' +
          'console and change it now. Set ADMIN_PASSWORD before the first ' +
          'start to choose it yourself.',
      );
    }
  }

  /**
   * The password the first admin is created with. That account controls
   * every realm, so a known password is never used:
   *
   * - production (`NODE_ENV=production`) refuses a missing, default,
   *   placeholder or shorter-than-12-character `ADMIN_PASSWORD`;
   * - anywhere else, a missing `ADMIN_PASSWORD` gets a strong random
   *   password (logged once after the seed commits), and a default or
   *   placeholder one is refused unless `ALLOW_INSECURE_ADMIN_PASSWORD=true`
   *   says this is a throwaway local instance.
   *
   * `npm run start:prod` does not set NODE_ENV, so a deployment run from
   * source takes the second path: it gets a random password, never `admin`.
   */
  private initialAdminPassword(): InitialAdminPassword {
    const configured = this.config.get<string>('ADMIN_PASSWORD');
    const isInsecure =
      !!configured && INSECURE_ADMIN_PASSWORDS.has(configured.toLowerCase());

    if (this.config.get<string>('NODE_ENV') === 'production') {
      if (
        !configured ||
        isInsecure ||
        configured.length < MIN_PRODUCTION_ADMIN_PASSWORD_LENGTH
      ) {
        throw new Error(
          `ADMIN_PASSWORD must be set to a unique value of at least ${MIN_PRODUCTION_ADMIN_PASSWORD_LENGTH} characters ` +
            'before the first production start (it creates the initial admin). ' +
            'Generate one with: openssl rand -hex 24',
        );
      }
      return { password: configured, generated: false };
    }

    if (!configured) {
      return {
        password: randomBytes(GENERATED_ADMIN_PASSWORD_BYTES).toString(
          'base64url',
        ),
        generated: true,
      };
    }
    if (isInsecure) {
      if (this.config.get<string>('ALLOW_INSECURE_ADMIN_PASSWORD') !== 'true') {
        throw new Error(
          'ADMIN_PASSWORD is set to a default or placeholder value, which ' +
            'would create the initial admin with a known password. Set a ' +
            'unique value (openssl rand -hex 24), or leave it unset to get a ' +
            'generated one. For a throwaway local instance only, ' +
            'ALLOW_INSECURE_ADMIN_PASSWORD=true accepts it.',
        );
      }
      this.logger.warn(
        'ALLOW_INSECURE_ADMIN_PASSWORD=true: creating the initial admin with ' +
          'a default password. Never use this outside a throwaway local instance.',
      );
    }
    return { password: configured, generated: false };
  }
}
