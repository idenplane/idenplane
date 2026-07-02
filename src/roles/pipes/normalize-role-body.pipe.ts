import {
  PipeTransform,
  Injectable,
  BadRequestException,
  ArgumentMetadata,
} from '@nestjs/common';
import { AssignRolesDto } from '../dto/assign-role.dto.js';

/**
 * Global pipe that normalizes bare-array role-mapping bodies (Keycloak convention)
 * into the canonical `{ roleNames: string[] }` object format before the global
 * ValidationPipe sees the value.
 *
 * This handles the case where clients send `[{ name: "admin" }]` instead of
 * `{ "roleNames": ["admin"] }`.
 *
 * Registration: must be added via `app.useGlobalPipes()` BEFORE ValidationPipe
 * (global pipes run in registration order). Do NOT use as a param-level pipe
 * with @Body(NormalizeRoleBodyPipe) — param-level pipes run AFTER global pipes,
 * which means ValidationPipe would reject the bare array first.
 *
 * The metatype guard ensures this pipe is a no-op for every endpoint except those
 * that accept AssignRolesDto, so it cannot accidentally mangle other array bodies.
 */
@Injectable()
export class NormalizeRoleBodyPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    // Only activate for AssignRolesDto parameters — no-op for everything else.
    if (metadata.metatype !== AssignRolesDto) {
      return value;
    }

    if (!Array.isArray(value)) {
      return value;
    }

    if (value.length === 0) {
      throw new BadRequestException('Provide at least one role');
    }

    const names = value
      .map((r: unknown) => {
        if (r && typeof r === 'object' && 'name' in r) {
          return (r as Record<string, unknown>)['name'];
        }
        return undefined;
      })
      .filter((n): n is string => typeof n === 'string' && n.length > 0);

    if (names.length === 0) {
      throw new BadRequestException('Each role entry must have a name');
    }

    return { roleNames: names };
  }
}
