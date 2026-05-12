import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { LdapClientWrapper } from './ldap.client.js';
import { CreateUserFederationDto } from './dto/create-user-federation.dto.js';
import { UpdateUserFederationDto } from './dto/update-user-federation.dto.js';

@Injectable()
export class UserFederationService {
  constructor(private readonly prisma: PrismaService) {}

  async create(realmName: string, dto: CreateUserFederationDto) {
    const realm = await this.prisma.realm.findUnique({
      where: { name: realmName },
    });
    if (!realm) throw new NotFoundException(`Realm '${realmName}' not found`);

    const existing = await this.prisma.userFederation.findUnique({
      where: { realmId_name: { realmId: realm.id, name: dto.name } },
    });
    if (existing)
      throw new ConflictException(`Federation '${dto.name}' already exists`);

    return this.prisma.userFederation.create({
      data: {
        realmId: realm.id,
        name: dto.name,
        providerType: dto.providerType ?? 'ldap',
        enabled: dto.enabled ?? true,
        priority: dto.priority ?? 0,
        connectionUrl: dto.connectionUrl,
        bindDn: dto.bindDn,
        bindCredential: dto.bindCredential,
        startTls: dto.startTls ?? false,
        connectionTimeout: dto.connectionTimeout ?? 5000,
        usersDn: dto.usersDn,
        userObjectClass: dto.userObjectClass ?? 'inetOrgPerson',
        usernameLdapAttr: dto.usernameLdapAttr ?? 'uid',
        rdnLdapAttr: dto.rdnLdapAttr ?? 'uid',
        uuidLdapAttr: dto.uuidLdapAttr ?? 'entryUUID',
        searchFilter: dto.searchFilter ?? null,
        syncMode: dto.syncMode ?? 'on_demand',
        syncPeriod: dto.syncPeriod ?? 3600,
        importEnabled: dto.importEnabled ?? true,
        editMode: dto.editMode ?? 'READ_ONLY',
      },
    });
  }

  async findAll(realmName: string) {
    const realm = await this.prisma.realm.findUnique({
      where: { name: realmName },
    });
    if (!realm) throw new NotFoundException(`Realm '${realmName}' not found`);

    return this.prisma.userFederation.findMany({
      where: { realmId: realm.id },
      orderBy: { priority: 'asc' },
    });
  }

  async findById(realmName: string, id: string) {
    const federation = await this.prisma.userFederation.findUnique({
      where: { id },
      include: { realm: true, mappers: true },
    });
    if (!federation || federation.realm.name !== realmName) {
      throw new NotFoundException('User federation not found');
    }
    return federation;
  }

  async update(realmName: string, id: string, dto: UpdateUserFederationDto) {
    const federation = await this.findById(realmName, id);

    return this.prisma.userFederation.update({
      where: { id: federation.id },
      data: {
        name: dto.name,
        providerType: dto.providerType,
        enabled: dto.enabled,
        priority: dto.priority,
        connectionUrl: dto.connectionUrl,
        bindDn: dto.bindDn,
        bindCredential: dto.bindCredential,
        startTls: dto.startTls,
        connectionTimeout: dto.connectionTimeout,
        usersDn: dto.usersDn,
        userObjectClass: dto.userObjectClass,
        usernameLdapAttr: dto.usernameLdapAttr,
        rdnLdapAttr: dto.rdnLdapAttr,
        uuidLdapAttr: dto.uuidLdapAttr,
        searchFilter: dto.searchFilter,
        syncMode: dto.syncMode,
        syncPeriod: dto.syncPeriod,
        importEnabled: dto.importEnabled,
        editMode: dto.editMode,
      },
    });
  }

  async remove(realmName: string, id: string) {
    const federation = await this.findById(realmName, id);
    return this.prisma.userFederation.delete({ where: { id: federation.id } });
  }

  async testConnection(realmName: string, id: string) {
    const federation = await this.findById(realmName, id);
    const client = this.createLdapClient(federation);
    return client.testConnection();
  }

  async syncUsers(realmName: string, id: string) {
    const federation = await this.findById(realmName, id);
    if (!federation.importEnabled) {
      return { synced: 0, message: 'Import is disabled for this federation' };
    }

    const client = this.createLdapClient(federation);
    const ldapUsers = await client.searchAllUsers();

    let synced = 0;
    for (const ldapUser of ldapUsers) {
      if (!ldapUser.uid) continue;

      const existing = await this.prisma.user.findUnique({
        where: {
          realmId_username: {
            realmId: federation.realmId,
            username: ldapUser.uid,
          },
        },
      });

      if (!existing) {
        await this.prisma.user.create({
          data: {
            realmId: federation.realmId,
            username: ldapUser.uid,
            email: ldapUser.email ?? null,
            firstName: ldapUser.firstName ?? null,
            lastName: ldapUser.lastName ?? null,
            enabled: true,
            emailVerified: !!ldapUser.email,
            federationLink: federation.id,
          },
        });
        synced++;
      }
    }

    await this.prisma.userFederation.update({
      where: { id: federation.id },
      data: {
        lastSyncAt: new Date(),
        lastSyncStatus: `Synced ${synced} new users (${ldapUsers.length} total in LDAP)`,
      },
    });

    return { synced, total: ldapUsers.length };
  }

  /**
   * Called during login to verify LDAP credentials and optionally import the user.
   */
  async authenticateViaFederation(
    realmId: string,
    username: string,
    password: string,
  ): Promise<{ authenticated: boolean; userId?: string }> {
    const federations = await this.prisma.userFederation.findMany({
      where: { realmId, enabled: true },
      orderBy: { priority: 'asc' },
    });

    for (const federation of federations) {
      const client = this.createLdapClient(federation);
      const authenticated = await client.authenticate(username, password);

      if (authenticated) {
        // Find or import the user
        let user = await this.prisma.user.findUnique({
          where: { realmId_username: { realmId, username } },
        });

        if (!user && federation.importEnabled) {
          const ldapUser = await client.searchUser(username);
          if (ldapUser) {
            user = await this.prisma.user.create({
              data: {
                realmId,
                username: ldapUser.uid,
                email: ldapUser.email ?? null,
                firstName: ldapUser.firstName ?? null,
                lastName: ldapUser.lastName ?? null,
                enabled: true,
                emailVerified: !!ldapUser.email,
                federationLink: federation.id,
              },
            });
          }
        }

        if (user) {
          return { authenticated: true, userId: user.id };
        }
      }
    }

    return { authenticated: false };
  }

  private createLdapClient(federation: any): LdapClientWrapper {
    return new LdapClientWrapper(
      {
        connectionUrl: federation.connectionUrl,
        bindDn: federation.bindDn,
        bindCredential: federation.bindCredential,
        startTls: federation.startTls,
        connectionTimeout: federation.connectionTimeout,
      },
      {
        usersDn: federation.usersDn,
        userObjectClass: federation.userObjectClass,
        usernameLdapAttr: federation.usernameLdapAttr,
        uuidLdapAttr: federation.uuidLdapAttr,
        searchFilter: federation.searchFilter ?? undefined,
      },
    );
  }
}
