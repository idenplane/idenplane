import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { JwkService } from '../crypto/jwk.service.js';
import { ScopeSeedService } from '../scopes/scope-seed.service.js';

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

  private async ensureMasterRealm() {
    const existing = await this.prisma.realm.findUnique({
      where: { name: 'master' },
    });

    if (existing) {
      this.logger.log('Master realm already exists');
      return;
    }

    this.logger.log('Creating master realm and initial admin user...');

    // Create master realm with signing key
    const keyPair = await this.jwkService.generateRsaKeyPair();

    const masterRealm = await this.prisma.realm.create({
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

    // Create admin roles
    const superAdmin = await this.prisma.role.create({
      data: {
        realmId: masterRealm.id,
        name: 'super-admin',
        description: 'Full access to all realms and settings',
      },
    });

    await this.prisma.role.create({
      data: {
        realmId: masterRealm.id,
        name: 'realm-admin',
        description: 'Manage specific realms',
      },
    });

    await this.prisma.role.create({
      data: {
        realmId: masterRealm.id,
        name: 'view-only',
        description: 'Read-only access',
      },
    });

    // Create initial admin user
    const adminUsername = this.config.get<string>('ADMIN_USER', 'admin');
    const adminPassword = this.config.get<string>('ADMIN_PASSWORD', 'admin');

    const passwordHash = await this.crypto.hashPassword(adminPassword);

    const adminUser = await this.prisma.user.create({
      data: {
        realmId: masterRealm.id,
        username: adminUsername,
        enabled: true,
        passwordHash,
        passwordChangedAt: new Date(),
      },
    });

    // Assign super-admin role
    await this.prisma.userRole.create({
      data: { userId: adminUser.id, roleId: superAdmin.id },
    });

    // Seed default scopes for the master realm
    await this.scopeSeedService.seedDefaultScopes(masterRealm.id);

    this.logger.log(`Master realm created. Admin user: ${adminUsername}`);
  }
}
