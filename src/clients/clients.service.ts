import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { Realm } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { ScopeSeedService } from '../scopes/scope-seed.service.js';
import { CacheService } from '../cache/cache.service.js';
import { CorsOriginService } from '../cors/cors-origin.service.js';
import { CreateClientDto } from './dto/create-client.dto.js';
import { UpdateClientDto } from './dto/update-client.dto.js';

const CLIENT_SELECT = {
  id: true,
  realmId: true,
  clientId: true,
  clientType: true,
  name: true,
  description: true,
  enabled: true,
  redirectUris: true,
  webOrigins: true,
  grantTypes: true,
  requireConsent: true,
  backchannelLogoutUri: true,
  backchannelLogoutSessionRequired: true,
  serviceAccountUserId: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly scopeSeedService: ScopeSeedService,
    private readonly cache: CacheService,
    private readonly corsOriginService: CorsOriginService,
  ) {}

  async create(realm: Realm, dto: CreateClientDto) {
    this.rejectWildcardOrigins(dto.webOrigins);
    const existing = await this.prisma.client.findUnique({
      where: {
        realmId_clientId: { realmId: realm.id, clientId: dto.clientId },
      },
    });
    if (existing) {
      throw new ConflictException(
        `Client '${dto.clientId}' already exists in realm '${realm.name}'`,
      );
    }

    // Resolve clientType: explicit field takes precedence, then the publicClient
    // convenience alias, then the default of CONFIDENTIAL.
    const clientType =
      dto.clientType ?? (dto.publicClient === true ? 'PUBLIC' : 'CONFIDENTIAL');
    let rawSecret: string | undefined;
    let secretHash: string | undefined;

    if (clientType === 'CONFIDENTIAL') {
      rawSecret = this.crypto.generateSecret();
      secretHash = await this.crypto.hashPassword(rawSecret);
    }

    const grantTypes = dto.grantTypes ?? ['authorization_code'];

    // Create service account user if client_credentials grant is enabled
    let serviceAccountUserId: string | undefined;
    if (
      grantTypes.includes('client_credentials') &&
      clientType === 'CONFIDENTIAL'
    ) {
      const saUsername = `service-account-${dto.clientId}`;
      const saUser = await this.prisma.user.create({
        data: {
          realmId: realm.id,
          username: saUsername,
          enabled: true,
        },
      });
      serviceAccountUserId = saUser.id;
    }

    const client = await this.prisma.client.create({
      data: {
        realmId: realm.id,
        clientId: dto.clientId,
        clientSecret: secretHash,
        clientType,
        name: dto.name,
        description: dto.description,
        enabled: dto.enabled,
        redirectUris: dto.redirectUris ?? [],
        webOrigins: dto.webOrigins ?? [],
        grantTypes,
        requireConsent: dto.requireConsent ?? false,
        backchannelLogoutUri: dto.backchannelLogoutUri,
        backchannelLogoutSessionRequired: dto.backchannelLogoutSessionRequired,
        serviceAccountUserId,
      },
      select: CLIENT_SELECT,
    });

    // Assign default and optional scopes to the new client
    await this.assignBuiltInScopes(realm.id, client.id);

    // A new client may introduce additional allowed origins — bust the CORS cache.
    await this.cache.invalidateCorsOrigins();
    this.corsOriginService.invalidateLocalCache();

    return {
      ...client,
      ...(rawSecret
        ? {
            clientSecret: rawSecret,
            secretDisplayedOnce: true,
            secretWarning:
              'This is the only time the client secret will be shown. Store it securely — it cannot be retrieved again.',
          }
        : {}),
    };
  }

  async findAll(realm: Realm) {
    return this.prisma.client.findMany({
      where: { realmId: realm.id },
      select: CLIENT_SELECT,
      orderBy: { createdAt: 'asc' },
    });
  }

  async findByClientId(realm: Realm, clientId: string) {
    const cacheKey = `${realm.id}:${clientId}`;
    const cached =
      await this.cache.getCachedClientConfig<typeof CLIENT_SELECT>(cacheKey);
    if (cached)
      return cached as unknown as Prisma.ClientGetPayload<{
        select: typeof CLIENT_SELECT;
      }>;

    let client = await this.prisma.client.findUnique({
      where: {
        realmId_clientId: { realmId: realm.id, clientId },
      },
      select: CLIENT_SELECT,
    });

    // Fallback: if the identifier looks like a UUID, try the primary key (id column)
    if (
      !client &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        clientId,
      )
    ) {
      client =
        (await this.prisma.client.findUnique({
          where: { id: clientId },
          select: CLIENT_SELECT,
        })) ?? null;
      // Ensure the found client belongs to this realm
      if (client && client.realmId !== realm.id) {
        client = null;
      }
    }

    if (!client) {
      throw new NotFoundException(`Client '${clientId}' not found`);
    }

    await this.cache.cacheClientConfig(cacheKey, client);

    return client;
  }

  async update(realm: Realm, clientIdOrUuid: string, dto: UpdateClientDto) {
    this.rejectWildcardOrigins(dto.webOrigins);
    // Resolve the identifier (may be clientId string OR UUID)
    const existing = await this.findByClientId(realm, clientIdOrUuid);
    const resolvedClientId = existing.clientId;

    const updated = await this.prisma.client.update({
      where: {
        realmId_clientId: { realmId: realm.id, clientId: resolvedClientId },
      },
      data: {
        name: dto.name,
        description: dto.description,
        clientType: dto.clientType,
        enabled: dto.enabled,
        redirectUris: dto.redirectUris,
        webOrigins: dto.webOrigins,
        grantTypes: dto.grantTypes,
        requireConsent: dto.requireConsent,
        backchannelLogoutUri: dto.backchannelLogoutUri,
        backchannelLogoutSessionRequired: dto.backchannelLogoutSessionRequired,
      },
      select: CLIENT_SELECT,
    });

    await this.cache.invalidateClientCache(`${realm.id}:${resolvedClientId}`);

    // webOrigins may have changed — bust the CORS cache so new origins take effect
    // and revoked ones are no longer accepted.
    await this.cache.invalidateCorsOrigins();
    this.corsOriginService.invalidateLocalCache();

    return updated;
  }

  async remove(realm: Realm, clientIdOrUuid: string) {
    const client = await this.findByClientId(realm, clientIdOrUuid);
    const resolvedClientId = client.clientId;

    // Delete service account user if it exists
    if (client.serviceAccountUserId) {
      await this.prisma.user
        .delete({
          where: { id: client.serviceAccountUserId },
        })
        .catch(() => {
          /* user may already be deleted */
        });
    }

    await this.prisma.client.delete({
      where: {
        realmId_clientId: { realmId: realm.id, clientId: resolvedClientId },
      },
    });

    await this.cache.invalidateClientCache(`${realm.id}:${resolvedClientId}`);

    // Deleted client's origins should no longer be accepted — bust the CORS cache.
    await this.cache.invalidateCorsOrigins();
    this.corsOriginService.invalidateLocalCache();
  }

  async getServiceAccount(realm: Realm, clientId: string) {
    const client = await this.findByClientId(realm, clientId);
    if (!client.serviceAccountUserId) {
      throw new NotFoundException('Client does not have a service account');
    }
    return this.prisma.user.findUnique({
      where: { id: client.serviceAccountUserId },
      select: {
        id: true,
        username: true,
        enabled: true,
        createdAt: true,
        userRoles: { include: { role: true } },
      },
    });
  }

  async regenerateSecret(realm: Realm, clientId: string) {
    const client = await this.findByClientId(realm, clientId);
    if (client.clientType !== 'CONFIDENTIAL') {
      throw new ConflictException('Cannot generate secret for a PUBLIC client');
    }

    const rawSecret = this.crypto.generateSecret();
    const secretHash = await this.crypto.hashPassword(rawSecret);

    await this.prisma.client.update({
      where: {
        realmId_clientId: { realmId: realm.id, clientId },
      },
      data: { clientSecret: secretHash },
    });

    // Secret changed — invalidate so the next lookup re-fetches the updated record
    await this.cache.invalidateClientCache(`${realm.id}:${clientId}`);

    return {
      clientId,
      clientSecret: rawSecret,
      secretWarning: 'Store this secret securely. It will not be shown again.',
    };
  }

  /**
   * Defense-in-depth guard: reject '*' as a webOrigin even if the DTO
   * validation layer was somehow bypassed (e.g. direct service calls in tests,
   * seeding scripts, or future programmatic callers that skip the HTTP stack).
   *
   * The primary rejection point is the @IsNoWildcardOrigin() decorator on
   * CreateClientDto / UpdateClientDto, which catches this at request-validation
   * time and returns a structured 400 before we ever reach the service layer.
   */
  private rejectWildcardOrigins(webOrigins: string[] | undefined): void {
    if (webOrigins?.includes('*')) {
      throw new BadRequestException(
        'webOrigins must not contain the wildcard "*". ' +
          'Specify explicit origins (e.g. "https://app.example.com") instead.',
      );
    }
  }

  private async assignBuiltInScopes(realmId: string, clientDbId: string) {
    const defaultNames = this.scopeSeedService.getDefaultScopeNames();
    const optionalNames = this.scopeSeedService.getOptionalScopeNames();

    const allScopes = await this.prisma.clientScope.findMany({
      where: { realmId, name: { in: [...defaultNames, ...optionalNames] } },
    });

    const defaultScopeIds = allScopes
      .filter((s) => defaultNames.includes(s.name))
      .map((s) => s.id);
    const optionalScopeIds = allScopes
      .filter((s) => optionalNames.includes(s.name))
      .map((s) => s.id);

    if (defaultScopeIds.length > 0) {
      await this.prisma.clientDefaultScope.createMany({
        data: defaultScopeIds.map((csId) => ({
          clientId: clientDbId,
          clientScopeId: csId,
        })),
      });
    }

    if (optionalScopeIds.length > 0) {
      await this.prisma.clientOptionalScope.createMany({
        data: optionalScopeIds.map((csId) => ({
          clientId: clientDbId,
          clientScopeId: csId,
        })),
      });
    }
  }
}
