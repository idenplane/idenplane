import { NestFactory } from '@nestjs/core';
import {
  Logger as NestLogger,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { swaggerEnabled } from './common/swagger-enabled.js';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import cookieParser from 'cookie-parser';
import { join } from 'path';
import { AppModule } from './app.module.js';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter.js';
import { registerHandlebarsHelpers } from './theme/handlebars-helpers.js';
import { createThemeViewEngine } from './theme/theme-view-engine.js';
import { CorsOriginService } from './cors/cors-origin.service.js';
import { NormalizeRoleBodyPipe } from './roles/pipes/normalize-role-body.pipe.js';
import { SessionEventsGateway } from './realtime/session-events.gateway.js';
import {
  MtlsConfigError,
  validateMtlsConfig,
  type MtlsConfig,
} from './mtls/mtls-config.js';
import { createTrustedProxyCertHeaderMiddleware } from './mtls/trusted-proxy-cert-header.middleware.js';
import {
  loadUsageRetention,
  UsageRetentionConfigError,
} from './usage/usage-retention.config.js';
import { startCertificateListener } from './realtime/certificate-listener.js';
import { APP_VERSION } from './versioning/app-version.js';
import {
  exitOnStartupFailure,
  startupLogger,
} from './common/logging/startup-logger.js';
import {
  registerBodyParsers,
  registerFormBodyParser,
} from './common/http/body-parsers.js';
import { applySecurityHeaders } from './common/security/http-security-headers.js';
import { RequestInputPipe } from './common/pipes/request-input.pipe.js';

/** Known-insecure / placeholder values that must never reach production. */
const INSECURE_ADMIN_API_KEY_VALUES = new Set([
  'REPLACE_ME_WITH_A_STRONG_RANDOM_SECRET',
  'dev-admin-key-change-in-production',
  'changeme',
  'secret',
  'admin',
  'password',
]);

const MIN_ADMIN_API_KEY_LENGTH = 32;

function validateAdminApiKey(): void {
  const isProduction = process.env['NODE_ENV'] === 'production';
  const key = process.env['ADMIN_API_KEY'];

  // Absent key — guard falls back to JWT-only mode; warn in production.
  if (!key) {
    if (isProduction) {
      startupLogger().warn(
        '[SECURITY] ADMIN_API_KEY is not set. ' +
          'The static API-key authentication path is disabled. ' +
          'Ensure admin JWT authentication is properly configured.',
        'Startup',
      );
    }
    return;
  }

  const isInsecureValue = INSECURE_ADMIN_API_KEY_VALUES.has(key);
  const isTooShort = key.length < MIN_ADMIN_API_KEY_LENGTH;

  if (isProduction) {
    // Thrown, so the reason is logged like every other startup failure.
    if (isInsecureValue) {
      throw new Error(
        '[SECURITY] FATAL: ADMIN_API_KEY is set to a known placeholder or insecure value. ' +
          'Set a strong, randomly generated secret (e.g. `openssl rand -hex 32`) ' +
          'before running in production.',
      );
    }

    if (isTooShort) {
      throw new Error(
        `[SECURITY] FATAL: ADMIN_API_KEY must be at least ${MIN_ADMIN_API_KEY_LENGTH} characters long in production. ` +
          'Generate one with: openssl rand -hex 32',
      );
    }
  } else {
    // Development / test: warn but do not block startup.
    if (isInsecureValue || isTooShort) {
      startupLogger().warn(
        '[SECURITY] WARNING: ADMIN_API_KEY is weak or a placeholder. ' +
          'This is acceptable in development but MUST be replaced before deploying to production.',
        'Startup',
      );
    }
  }
}

/**
 * Client-certificate (mTLS) settings: refuse to start on an unsafe or
 * incomplete one, such as a certificate header without trusted proxies.
 */
function checkMtlsConfig(): MtlsConfig {
  try {
    return validateMtlsConfig(process.env);
  } catch (err) {
    if (err instanceof MtlsConfigError) {
      throw new Error(`[SECURITY] FATAL: ${err.message}`, { cause: err });
    }
    throw err;
  }
}

/**
 * USAGE_ACTIVITY_RETENTION_MONTHS: refuse to start on a value that is not a
 * number of months or `off`, rather than prune billing data by mistake.
 */
function checkUsageRetentionConfig(): void {
  try {
    loadUsageRetention(process.env);
  } catch (err) {
    if (err instanceof UsageRetentionConfigError) {
      // Thrown, so the reason is logged like every other startup failure.
      throw new Error(`FATAL: ${err.message}`, { cause: err });
    }
    throw err;
  }
}

async function bootstrap() {
  validateAdminApiKey();
  const mtlsConfig = checkMtlsConfig();
  checkUsageRetentionConfig();

  // The application's own logger from the first line on (startup-logger.ts),
  // so a start that fails still reports why, in the usual format. A module
  // that cannot be created is logged by Nest and rethrown (abortOnError:
  // false) instead of aborting the process.
  let app: NestExpressApplication;
  try {
    app = await NestFactory.create<NestExpressApplication>(AppModule, {
      logger: startupLogger(),
      abortOnError: false,
    });
  } catch (err) {
    return exitOnStartupFailure(err, { alreadyLogged: true });
  }

  app.useLogger(app.get(Logger));

  // ── CORS — must be enabled before any other middleware so that OPTIONS
  // preflight requests are handled immediately and never fall through to
  // route-matching (which would produce a 404).
  // The origin callback echoes the request Origin back on success so that
  // browsers receive the concrete `Access-Control-Allow-Origin` value they
  // need (passing `true` to the callback only works for simple string origins,
  // not for the async/callback form used here).
  const corsOriginService = app.get(CorsOriginService);
  // Build the set of same-origin URLs so the admin console always works.
  const serverPort = process.env['PORT'] ?? '3000';
  const sameOrigins = new Set<string>([
    `http://localhost:${serverPort}`,
    `http://127.0.0.1:${serverPort}`,
    `http://0.0.0.0:${serverPort}`,
  ]);
  if (process.env['BASE_URL']) {
    try {
      sameOrigins.add(new URL(process.env['BASE_URL']).origin);
    } catch {
      startupLogger().warn(
        `Invalid BASE_URL: ${process.env['BASE_URL']} — skipping origin allowlist`,
        'Startup',
      );
    }
  }

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: string | false) => void,
    ) => {
      // No Origin header = server-to-server or same-origin navigation.
      if (!origin) {
        callback(null, false);
        return;
      }

      // Always allow the server's own origins (admin console, dev tools).
      if (sameOrigins.has(origin)) {
        callback(null, origin);
        return;
      }

      // Check client webOrigins from the database using synchronous local cache.
      // The local cache is populated at startup and refreshed every 5 min.
      // This avoids async callback issues with Express CORS.
      const allowedOrigins = corsOriginService.getCachedOrigins();
      if (allowedOrigins !== null) {
        callback(null, allowedOrigins.has(origin) ? origin : false);
        return;
      }

      // Cache should always be populated at this point since we preload at startup.
      // If somehow it's not, deny for safety.
      callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-api-key'],
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });

  // Catch-all OPTIONS handler: when a disallowed origin sends a preflight,
  // the CORS middleware passes it through (callback(null, false) calls next()).
  // Without this handler the request would reach Express's default 404 handler.
  // Return 204 with no body — the absence of ACAO tells the browser the
  // request is blocked, which is the correct CORS rejection behaviour.
  // Express 5 uses path-to-regexp v8 which requires '{*path}' syntax
  // instead of the old '*' wildcard. This catches all OPTIONS preflight
  // requests that weren't handled by the CORS middleware (disallowed origins).
  const httpAdapter = app.getHttpAdapter();
  httpAdapter
    .getInstance()
    .options('{*path}', (_req: unknown, res: unknown) => {
      (res as { status: (code: number) => { end: () => void } })
        .status(204)
        .end();
    });

  // A client-certificate header counts only from a trusted proxy (the TCP
  // peer, never X-Forwarded-For); from any other peer it is rejected, or
  // stripped, before any route sees it.
  if (mtlsConfig.proxy) {
    const proxyHeaderLogger = new NestLogger('MtlsProxyHeader');
    app.use(
      createTrustedProxyCertHeaderMiddleware(mtlsConfig.proxy, {
        warn: (message) => proxyHeaderLogger.warn(message),
      }),
    );
  }

  // ── Reverse-proxy trust configuration ──────────────────────────────────────
  // Configure Express's built-in "trust proxy" setting to match the
  // TRUSTED_PROXIES environment variable.  Express uses this to populate
  // req.ip / req.ips from X-Forwarded-For, but our own resolveClientIp()
  // utility performs the same check independently and is the authoritative
  // source for all rate-limiting decisions.
  //
  // Setting trust proxy here ensures that other Express-level code (e.g.
  // session middleware) that reads req.ip also behaves correctly.
  const trustedProxiesEnv = process.env['TRUSTED_PROXIES'];
  if (trustedProxiesEnv && trustedProxiesEnv.trim() !== '') {
    if (trustedProxiesEnv.trim() === '*') {
      app.set('trust proxy', true);
    } else {
      // Provide the list directly; Express accepts a comma-separated string.
      app.set('trust proxy', trustedProxiesEnv);
    }
  }
  // When TRUSTED_PROXIES is not set we leave "trust proxy" at its default
  // (false), so Express never touches X-Forwarded-For.

  // Enable URI-based versioning: versioned routes are accessible at /api/v{N}/...
  // Unversioned routes continue to work (backward-compatible) but carry
  // Deprecation + Sunset headers injected by DeprecationInterceptor.
  app.enableVersioning({ type: VersioningType.URI, prefix: 'api/v' });

  // helmet (CSP, HSTS, COOP, CORP, ...) and Permissions-Policy; shared with
  // the e2e test application so the suite sees what production sends.
  applySecurityHeaders(app);

  // JSON and SCIM's application/scim+json. After the security headers, so a
  // body the parser rejects (malformed JSON) is answered with them too.
  registerBodyParsers(app);
  registerFormBodyParser(app);
  app.use(cookieParser());

  // Backward compatibility: the SSO session cookie used to be AUTHME_SESSION
  // before the rebrand to Idenplane. Users who were logged in at upgrade time
  // still send the legacy cookie; alias it to the new name so every controller
  // can read IDENPLANE_SESSION without caring about the history. This fallback
  // should be removed one release cycle after the rename.
  type CookieRequest = { cookies?: Record<string, string | undefined> };
  app.use(
    (
      req: CookieRequest,
      _res: unknown,
      next: (err?: unknown) => void,
    ): void => {
      const cookies = req.cookies;
      if (cookies && cookies.AUTHME_SESSION && !cookies.IDENPLANE_SESSION) {
        cookies.IDENPLANE_SESSION = cookies.AUTHME_SESSION;
      }
      next();
    },
  );

  // Handlebars template engine — templates live in themes/ and are resolved by ThemeRenderService
  app.setBaseViewsDir(join(__dirname, '..', 'themes'));
  app.engine('hbs', createThemeViewEngine(join(__dirname, '..', 'themes')));
  app.setViewEngine('hbs');

  // Block access to template sources, config files, and message bundles
  const expressInstance = app.getHttpAdapter().getInstance();
  expressInstance.use(
    '/themes',
    (
      req: { path: string },
      res: { status: (code: number) => { json: (body: object) => void } },
      next: () => void,
    ) => {
      if (
        /\.(hbs|properties)$/.test(req.path) ||
        req.path.includes('theme.json')
      ) {
        res.status(403).json({ statusCode: 403, message: 'Forbidden' });
        return;
      }
      next();
    },
  );

  // Theme assets uploaded through the Admin API (ThemeUploadService). SVG is
  // allowed, so a file opened directly could carry script; the sandbox CSP
  // and nosniff keep it inert, while <img> and CSS url() still render it.
  // Names are unique per upload, so they never change and can be cached.
  app.useStaticAssets(join(process.cwd(), 'uploads', 'themes'), {
    prefix: '/themes/uploads',
    index: false,
    setHeaders: (res: { setHeader: (k: string, v: string) => void }) => {
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      );
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    },
  });
  app.useStaticAssets(join(__dirname, '..', 'themes'), { prefix: '/themes' });

  // Register theme engine Handlebars helpers ({{msg}}, {{msgArgs}})
  registerHandlebarsHelpers();

  // NormalizeRoleBodyPipe MUST be registered before ValidationPipe so that
  // bare-array Keycloak-style bodies (e.g. [{ name: "admin" }]) are reshaped
  // to { roleNames: [...] } before ValidationPipe rejects them.
  // The pipe's metatype guard ensures it only activates for AssignRolesDto params.
  // RequestInputPipe runs first: a missing body becomes {} and a NUL
  // character is refused, so neither reaches a handler or the database.
  app.useGlobalPipes(
    new RequestInputPipe(),
    new NormalizeRoleBodyPipe(),
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new GlobalExceptionFilter());

  // Swagger UI (/api) and the OpenAPI document (/api-json): off in
  // production unless SWAGGER_ENABLED=true (see common/swagger-enabled.ts).
  const publishSwagger = swaggerEnabled();
  if (publishSwagger) {
    const config = new DocumentBuilder()
      .setTitle('Idenplane')
      .setDescription('Open-source Identity and Access Management Server')
      .setVersion(APP_VERSION)
      .addApiKey(
        { type: 'apiKey', name: 'x-admin-api-key', in: 'header' },
        'admin-api-key',
      )
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api', app, document);
  }

  // Preload CORS origin cache before accepting requests
  await corsOriginService.preloadCache();

  app.get(SessionEventsGateway).attach(app.getHttpServer());

  // Close cleanly on SIGTERM/SIGINT (docker stop, a rolling deploy, the
  // cluster primary): shutdown hooks release the leader lock, end the
  // database pools and finish in-flight requests.
  app.enableShutdownHooks();

  const port = process.env['PORT'] ?? 3000;
  await app.listen(port);
  console.log(`Idenplane is running on http://localhost:${port}`);
  console.log(
    publishSwagger
      ? `Swagger UI: http://localhost:${port}/api`
      : 'Swagger UI: off (set SWAGGER_ENABLED=true to publish /api and /api-json)',
  );

  // The certificate listener (MTLS_LISTEN_PORT) serves the OAuth endpoint
  // aliases through the same Express application, and the session events
  // WebSocket through the same gateway. Closed by the shutdown hooks with
  // the rest of the application.
  await startCertificateListener(app);
}

/**
 * Any failure to start (a configuration check, a module's init or bootstrap
 * hook, such as instance bootstrap or the admin seed, binding the port) is
 * logged once, at error level, in the application's log format, and the
 * process exits with 1 once every log line is written. Left to Node, the
 * rejection would be printed as a bare stack on stderr after an exit handler
 * had flushed the log, with nothing tying its position to the log's order.
 * Nest has already logged a port it could not bind.
 */
bootstrap().catch((err: unknown) =>
  exitOnStartupFailure(err, {
    alreadyLogged: (err as { syscall?: string } | null)?.syscall === 'listen',
  }),
);
