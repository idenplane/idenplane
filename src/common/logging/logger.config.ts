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
      genReqId: (req: any) => req.headers['x-request-id'] ?? randomUUID(),
      serializers: {
        req: (req: any) => ({
          id: req.id,
          method: req.method,
          url: req.url,
        }),
        res: (res: any) => ({
          statusCode: res.statusCode,
        }),
      },
      autoLogging: {
        ignore: (req: any) =>
          req.url?.startsWith('/health') ||
          req.url?.startsWith('/admin/metrics'),
      },
    },
  };
}
