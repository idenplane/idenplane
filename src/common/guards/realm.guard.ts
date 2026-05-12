import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service.js';

@Injectable()
export class RealmGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const rawName = request.params['realmName'] ?? request.params['realm'];

    if (!rawName) return true;

    const realmName = Array.isArray(rawName) ? rawName[0] : rawName;

    const realm = await this.prisma.realm.findUnique({
      where: { name: realmName },
    });

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
}
