/**
 * Whether the server publishes Swagger UI (`/api`) and the OpenAPI document
 * (`/api-json`).
 *
 * The document maps every endpoint, parameter and auth scheme; it is no
 * secret (the code is public), but a production server need not hand that map
 * to anyone who asks. So it is on outside production and off in production
 * (`NODE_ENV=production`, as the Docker image sets it) unless
 * `SWAGGER_ENABLED=true`. `SWAGGER_ENABLED=false` turns it off anywhere.
 */
export function swaggerEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const value = (env['SWAGGER_ENABLED'] ?? '').trim().toLowerCase();
  if (value === 'true') return true;
  if (value === 'false') return false;
  return env['NODE_ENV'] !== 'production';
}
