import type { Params } from 'nestjs-pino';
import { randomUUID } from 'crypto';
import { SENSITIVE_BODY_FIELDS } from '../security/sensitive-body-fields.js';
import { redactUrl } from './redact-url.js';

/**
 * Which requests get an access-log line (LOG_ACCESS):
 * - `errors` (default): requests that failed, 4xx as warn and 5xx as error;
 * - `all`: every request, successful ones at info;
 * - `off`: none. Application logs are not affected by any of these.
 */
export type AccessLogMode = 'errors' | 'all' | 'off';

export function accessLogMode(
  value = process.env['LOG_ACCESS'],
): AccessLogMode {
  const mode = (value ?? '').trim().toLowerCase();
  return mode === 'all' || mode === 'off' ? mode : 'errors';
}

/** The level of a request's access-log line, or 'silent' for none. */
export function accessLogLevel(
  mode: AccessLogMode,
  statusCode: number,
  err?: Error,
): 'error' | 'warn' | 'info' | 'silent' {
  if (err || statusCode >= 500) return 'error';
  if (statusCode >= 400) return 'warn';
  return mode === 'all' ? 'info' : 'silent';
}

export function createLoggerConfig(): Params {
  const isProduction = process.env['NODE_ENV'] === 'production';
  const accessLog = accessLogMode();
  const logLevel =
    process.env['LOG_LEVEL'] ?? (isProduction ? 'info' : 'debug');

  return {
    pinoHttp: {
      level: logLevel,
      transport: isProduction
        ? undefined
        : {
            target: 'pino-pretty',
            options: { colorize: true, singleLine: true },
          },
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers["x-admin-api-key"]',
          ...SENSITIVE_BODY_FIELDS.map((field) => `req.body.${field}`),
        ],
        censor: '[REDACTED]',
      },
      genReqId: (
        req: Request & { headers?: Record<string, string | undefined> } & {
          id?: string;
          method?: string;
          url?: string;
        },
      ) => req.headers?.['x-request-id'] ?? randomUUID(),
      serializers: {
        req: (
          req: Request & { id?: string; method?: string; url?: string },
        ) => ({
          id: req.id,
          method: req.method,
          // Tokens, codes and secrets in the URL never reach the log.
          url: redactUrl(req.url),
        }),
        res: (res: { statusCode?: number }) => ({
          statusCode: res.statusCode,
        }),
      },
      autoLogging:
        accessLog === 'off'
          ? false
          : {
              ignore: (req: Request & { url?: string }) =>
                req.url?.startsWith('/health') ||
                req.url?.startsWith('/admin/metrics'),
            },
      // One line per request costs measurable throughput on the hottest
      // endpoints, so by default only failed requests are logged.
      customLogLevel: (
        _req: unknown,
        res: { statusCode: number },
        err?: Error,
      ) => accessLogLevel(accessLog, res.statusCode, err),
    } as unknown as Params['pinoHttp'],
  };
}
