import { SetMetadata } from '@nestjs/common';

export const REQUIRE_ADMIN_AUTH_KEY = 'requireAdminAuth';

/**
 * Makes AdminApiKeyGuard demand admin credentials (an admin JWT or the static
 * admin API key) on a controller or handler that is not mounted under
 * `/admin`. Routes under `/admin` are always enforced; this only adds routes,
 * it never exempts one. `@Public()` still wins, so never combine the two.
 */
export const RequireAdminAuth = () => SetMetadata(REQUIRE_ADMIN_AUTH_KEY, true);
