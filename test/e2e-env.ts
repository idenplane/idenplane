/**
 * E2E environment bootstrap.
 *
 * Runs (via jest `setupFiles`) before any spec — and therefore before
 * `test/setup.ts` statically imports `AppModule` — so the values below are
 * already in `process.env` when `ThrottlerModule.forRoot([...])` reads them.
 *
 * The global @nestjs/throttler guard defaults to 100 requests / 60s per IP.
 * The E2E suite runs single-worker and issues thousands of requests from one
 * loopback IP, which would otherwise trip the limiter and return 429 for most
 * tests. Rate limiting itself is exercised by dedicated specs that configure
 * per-realm limits explicitly; the global guard must not throttle the harness.
 *
 * Production is unaffected — these only apply when the E2E config loads.
 */
process.env['THROTTLE_LIMIT'] = process.env['THROTTLE_LIMIT'] ?? '1000000';
process.env['THROTTLE_TTL'] = process.env['THROTTLE_TTL'] ?? '1000';
process.env['NODE_ENV'] = process.env['NODE_ENV'] ?? 'test';

// The admin guards enforce per-IP limits on the static admin API key
// (prod defaults 15/min, 100/hour). The single-IP E2E harness issues far
// more than that; raise them for the test run only. Prod is unaffected.
process.env['ADMIN_API_KEY_RL_PER_MINUTE'] =
  process.env['ADMIN_API_KEY_RL_PER_MINUTE'] ?? '1000000';
process.env['ADMIN_API_KEY_RL_PER_HOUR'] =
  process.env['ADMIN_API_KEY_RL_PER_HOUR'] ?? '1000000';
process.env['ADMIN_IP_RL_PER_MINUTE'] =
  process.env['ADMIN_IP_RL_PER_MINUTE'] ?? '1000000';
process.env['ADMIN_IP_RL_PER_HOUR'] =
  process.env['ADMIN_IP_RL_PER_HOUR'] ?? '1000000';
