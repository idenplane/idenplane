import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { Realm } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateClientScopeDto } from './dto/create-client-scope.dto.js';
import { UpdateClientScopeDto } from './dto/update-client-scope.dto.js';

@Injectable()
export class ClientScopesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(realm: Realm) {
    return this.prisma.clientScope.findMany({
      where: { realmId: realm.id },
      include: { protocolMappers: true },
      orderBy: { name: 'asc' },
    });
  }

  async findById(realm: Realm, scopeId: string) {
    const scope = await this.prisma.clientScope.findFirst({
      where: { id: scopeId, realmId: realm.id },
      include: { protocolMappers: true },
    });
    if (!scope) {
      throw new NotFoundException(`Client scope '${scopeId}' not found`);
    }
    return scope;
  }

  async create(realm: Realm, dto: CreateClientScopeDto) {
    const existing = await this.prisma.clientScope.findUnique({
      where: { realmId_name: { realmId: realm.id, name: dto.name } },
    });
    if (existing) {
      throw new ConflictException(`Scope '${dto.name}' already exists`);
    }

    return this.prisma.clientScope.create({
      data: {
        realmId: realm.id,
        name: dto.name,
        description: dto.description,
        protocol: dto.protocol ?? 'openid-connect',
      },
      include: { protocolMappers: true },
    });
  }

  async update(realm: Realm, scopeId: string, dto: UpdateClientScopeDto) {
    await this.findById(realm, scopeId);
    return this.prisma.clientScope.update({
      where: { id: scopeId },
      data: {
        description: dto.description,
        protocol: dto.protocol,
      },
      include: { protocolMappers: true },
    });
  }

  async remove(realm: Realm, scopeId: string) {
    const scope = await this.findById(realm, scopeId);
    if (scope.builtIn) {
      throw new ConflictException('Cannot delete built-in scopes');
    }
    await this.prisma.clientScope.delete({ where: { id: scopeId } });
  }

  // Protocol mapper management
  async getMappers(realm: Realm, scopeId: string) {
    // Confirm the scope belongs to this realm before returning its mappers.
    await this.findById(realm, scopeId);
    return this.prisma.protocolMapper.findMany({
      where: { clientScopeId: scopeId },
      orderBy: { name: 'asc' },
    });
  }

  async addMapper(
    realm: Realm,
    scopeId: string,
    data: {
      name: string;
      mapperType?: string;
      protocolMapper?: string;
      protocol?: string;
      config?: Record<string, unknown>;
    },
  ) {
    const resolvedMapperType = data.mapperType ?? data.protocolMapper;
    if (!resolvedMapperType) {
      throw new Error('mapperType (or protocolMapper) is required');
    }
    await this.findById(realm, scopeId);
    return this.prisma.protocolMapper.create({
      data: {
        clientScopeId: scopeId,
        name: data.name,
        mapperType: resolvedMapperType,
        protocol: data.protocol ?? 'openid-connect',
        config: (data.config ?? {}) as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async updateMapper(
    realm: Realm,
    scopeId: string,
    mapperId: string,
    data: {
      name?: string;
      config?: Record<string, unknown>;
    },
  ) {
    await this.findById(realm, scopeId);
    return this.prisma.protocolMapper.update({
      where: { id: mapperId },
      data: {
        name: data.name,
        config: data.config as unknown as Prisma.InputJsonValue | undefined,
      },
    });
  }

  async removeMapper(realm: Realm, scopeId: string, mapperId: string) {
    await this.findById(realm, scopeId);
    await this.prisma.protocolMapper.delete({ where: { id: mapperId } });
  }

  // Client scope assignments
  async getDefaultScopes(realm: Realm, clientId: string) {
    const client = await this.prisma.client.findUnique({
      where: { realmId_clientId: { realmId: realm.id, clientId } },
    });
    if (!client) throw new NotFoundException(`Client '${clientId}' not found`);

    return this.prisma.clientDefaultScope.findMany({
      where: { clientId: client.id },
      include: { clientScope: true },
    });
  }

  async assignDefaultScope(
    realm: Realm,
    clientId: string,
    clientScopeId: string,
  ) {
    const client = await this.prisma.client.findUnique({
      where: { realmId_clientId: { realmId: realm.id, clientId } },
    });
    if (!client) throw new NotFoundException(`Client '${clientId}' not found`);
    await this.findById(realm, clientScopeId);

    return this.prisma.clientDefaultScope.create({
      data: { clientId: client.id, clientScopeId },
    });
  }

  async removeDefaultScope(
    realm: Realm,
    clientId: string,
    clientScopeId: string,
  ) {
    const client = await this.prisma.client.findUnique({
      where: { realmId_clientId: { realmId: realm.id, clientId } },
    });
    if (!client) throw new NotFoundException(`Client '${clientId}' not found`);

    await this.prisma.clientDefaultScope.deleteMany({
      where: { clientId: client.id, clientScopeId },
    });
  }

  async getOptionalScopes(realm: Realm, clientId: string) {
    const client = await this.prisma.client.findUnique({
      where: { realmId_clientId: { realmId: realm.id, clientId } },
    });
    if (!client) throw new NotFoundException(`Client '${clientId}' not found`);

    return this.prisma.clientOptionalScope.findMany({
      where: { clientId: client.id },
      include: { clientScope: true },
    });
  }

  async assignOptionalScope(
    realm: Realm,
    clientId: string,
    clientScopeId: string,
  ) {
    const client = await this.prisma.client.findUnique({
      where: { realmId_clientId: { realmId: realm.id, clientId } },
    });
    if (!client) throw new NotFoundException(`Client '${clientId}' not found`);
    await this.findById(realm, clientScopeId);

    return this.prisma.clientOptionalScope.create({
      data: { clientId: client.id, clientScopeId },
    });
  }

  async removeOptionalScope(
    realm: Realm,
    clientId: string,
    clientScopeId: string,
  ) {
    const client = await this.prisma.client.findUnique({
      where: { realmId_clientId: { realmId: realm.id, clientId } },
    });
    if (!client) throw new NotFoundException(`Client '${clientId}' not found`);

    await this.prisma.clientOptionalScope.deleteMany({
      where: { clientId: client.id, clientScopeId },
    });
  }
}
