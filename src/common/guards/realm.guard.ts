import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Realm } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CacheService } from '../../cache/cache.service.js';

@Injectable()
export class RealmGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const rawName = request.params['realmName'] ?? request.params['realm'];

    if (!rawName) return true;

    const realmName = Array.isArray(rawName) ? rawName[0] : rawName;

    const realm = await this.findRealmByName(realmName);

    if (!realm) {
      throw new NotFoundException(`Realm '${realmName}' not found`);
    }

    // Block disabled realms for non-admin endpoints
    if (!realm.enabled && !request.path.startsWith('/admin/')) {
      throw new ForbiddenException('Realm is disabled');
    }

    (request as Request & { realm: typeof realm }).realm = realm;
    return true;
  }

  /**
   * Cache-aside lookup mirroring RealmsService.findByNameRaw: this guard
   * runs on almost every request (~35+ controllers), so a cache hit avoids
   * a Postgres round-trip per request. Cache invalidation on realm
   * update/delete already goes through CacheService.invalidateRealmCache.
   */
  private async findRealmByName(name: string): Promise<Realm | null> {
    const cached = await this.cache.getCachedRealmByName<Realm | null>(name);
    if (cached) return cached;

    const realm = await this.prisma.realm.findUnique({ where: { name } });
    if (!realm) return null;

    await Promise.all([
      this.cache.cacheRealmByName(name, realm),
      this.cache.cacheRealmConfig(realm.id, realm),
    ]);

    return realm;
  }
}
