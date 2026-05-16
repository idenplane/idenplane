import type { Params } from 'nestjs-pino';
import { randomUUID } from 'crypto';

export function createLoggerConfig(): Params {
  const isProduction = process.env['NODE_ENV'] === 'production';
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
          'req.body.password',
          'req.body.client_secret',
          'req.body.smtpPassword',
          'req.body.currentPassword',
          'req.body.newPassword',
          'req.body.confirmPassword',
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
          url: req.url,
        }),
        res: (res: { statusCode?: number }) => ({
          statusCode: res.statusCode,
        }),
      },
      autoLogging: {
        ignore: (req: Request & { url?: string }) =>
          req.url?.startsWith('/health') ||
          req.url?.startsWith('/admin/metrics'),
      },
    } as any,
  };
}
