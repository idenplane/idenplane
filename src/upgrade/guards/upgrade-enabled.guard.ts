import {
  CanActivate,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Gates the two destructive upgrade endpoints (POST /admin/upgrade and
 * POST /admin/upgrade/rollback) behind an explicit opt-in.
 *
 * RBAC answers "who may do this"; this answers "is this deployment prepared
 * for it at all". They are independent questions and both need a yes:
 *
 *   - Starting an upgrade shells out to `prisma migrate deploy` against the
 *     live database.
 *   - Rolling back restores a pg_dump over it.
 *
 * Neither is safe on a deployment that has not provisioned a backup volume and
 * verified that pg_dump/pg_restore exist in the image, so the default is off.
 * Read-only upgrade endpoints (status, history, health, pre-validation) are
 * deliberately NOT gated — they are useful precisely when deciding whether to
 * turn this on.
 */
@Injectable()
export class UpgradeEnabledGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(): boolean {
    const enabled = this.config.get<string>('UPGRADE_API_ENABLED');

    if (enabled !== 'true') {
      throw new ServiceUnavailableException(
        'Upgrade execution is disabled. Set UPGRADE_API_ENABLED=true to enable ' +
          'it, and ensure pg_dump/pg_restore are available and BACKUP_DIR points ' +
          'at durable storage before doing so. Read-only upgrade endpoints ' +
          'remain available.',
      );
    }

    return true;
  }
}
