import { symbols } from 'pino';
import { Logger, PinoLogger, type Params } from 'nestjs-pino';
import { createLoggerConfig } from './logger.config.js';

/**
 * The application's logger outside Nest's lifecycle: before the application
 * exists, and while it fails to start.
 *
 * nestjs-pino builds one root pino logger, on first use, from the parameters
 * it is given; LoggerModule (app.module.ts) and this module share the same
 * parameters, so whoever comes first builds it and every log line, including
 * a startup failure, goes through the same logger, destination and format.
 */
let params: Params | undefined;

/** The logger parameters, built once for the whole process. */
export function loggerParams(): Params {
  params ??= createLoggerConfig();
  return params;
}

let logger: Logger | undefined;

/** A Nest LoggerService writing through the application's root logger. */
export function startupLogger(): Logger {
  logger ??= new Logger(new PinoLogger(loggerParams()), loggerParams());
  return logger;
}

/**
 * Writes out whatever the root logger still holds. Its destination writes
 * asynchronously; a process about to exit must not leave lines behind, nor
 * let them land after the failure that ends it.
 */
export function flushLogs(): void {
  const root = PinoLogger.root as unknown as
    Record<symbol, { flushSync?: () => void } | undefined> | undefined;
  try {
    root?.[symbols.streamSym]?.flushSync?.();
  } catch {
    // Nothing better to do while exiting: the line was handed to the stream.
  }
}

/** The context startup failures are logged with. */
export const STARTUP_CONTEXT = 'Startup';

/**
 * Ends a process that cannot start: logs `err` once, at error level, in the
 * application's log format, writes every pending log line, and exits with 1.
 *
 * `alreadyLogged` is for an error Nest has reported itself (a module that
 * could not be created, a port that could not be bound), so it is not logged
 * twice.
 */
export function exitOnStartupFailure(
  err: unknown,
  options: { alreadyLogged?: boolean; exit?: (code: number) => never } = {},
): never {
  if (!options.alreadyLogged) {
    startupLogger().error(
      err instanceof Error ? err : new Error(String(err)),
      STARTUP_CONTEXT,
    );
  }
  flushLogs();
  const exit = options.exit ?? ((code: number) => process.exit(code));
  return exit(1);
}
