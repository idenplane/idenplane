import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import type { Realm } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateIdentityProviderDto } from './dto/create-identity-provider.dto.js';
import type { UpdateIdentityProviderDto } from './dto/update-identity-provider.dto.js';

@Injectable()
export class IdentityProvidersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(realm: Realm, dto: CreateIdentityProviderDto) {
    const existing = await this.prisma.identityProvider.findUnique({
      where: { realmId_alias: { realmId: realm.id, alias: dto.alias } },
    });
    if (existing) {
      throw new ConflictException(
        `Identity provider '${dto.alias}' already exists`,
      );
    }

    return this.prisma.identityProvider.create({
      data: {
        realmId: realm.id,
        alias: dto.alias,
        displayName: dto.displayName,
        enabled: dto.enabled ?? true,
        providerType: dto.providerType ?? 'oidc',
        clientId: dto.clientId,
        clientSecret: dto.clientSecret,
        authorizationUrl: dto.authorizationUrl,
        tokenUrl: dto.tokenUrl,
        userinfoUrl: dto.userinfoUrl,
        jwksUrl: dto.jwksUrl,
        issuer: dto.issuer,
        defaultScopes: dto.defaultScopes ?? 'openid email profile',
        trustEmail: dto.trustEmail ?? false,
        linkOnly: dto.linkOnly ?? false,
        syncUserProfile: dto.syncUserProfile ?? true,
      },
    });
  }

  async findAll(realm: Realm) {
    return this.prisma.identityProvider.findMany({
      where: { realmId: realm.id },
      select: {
        id: true,
        alias: true,
        displayName: true,
        enabled: true,
        providerType: true,
        authorizationUrl: true,
        tokenUrl: true,
        defaultScopes: true,
        trustEmail: true,
        linkOnly: true,
        syncUserProfile: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async findByAlias(realm: Realm, alias: string) {
    const idp = await this.prisma.identityProvider.findUnique({
      where: { realmId_alias: { realmId: realm.id, alias } },
    });
    if (!idp) {
      throw new NotFoundException(`Identity provider '${alias}' not found`);
    }
    return idp;
  }

  async update(realm: Realm, alias: string, dto: UpdateIdentityProviderDto) {
    await this.findByAlias(realm, alias);
    return this.prisma.identityProvider.update({
      where: { realmId_alias: { realmId: realm.id, alias } },
      data: dto,
    });
  }

  async remove(realm: Realm, alias: string) {
    await this.findByAlias(realm, alias);
    return this.prisma.identityProvider.delete({
      where: { realmId_alias: { realmId: realm.id, alias } },
    });
  }
}
