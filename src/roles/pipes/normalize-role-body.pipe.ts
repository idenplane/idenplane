import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';

/**
 * Pre-processes bare-array role-mapping bodies (Keycloak convention) into
 * the canonical `{ roleNames: string[] }` object format before the global
 * ValidationPipe runs.
 *
 * This handles the case where clients send `[{ name: "admin" }]` instead of
 * `{ "roleNames": ["admin"] }`.  Must be applied as the first pipe in @Body()
 * so it runs before the ValidationPipe sees the value.
 */
@Injectable()
export class NormalizeRoleBodyPipe implements PipeTransform {
  transform(value: unknown): unknown {
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
