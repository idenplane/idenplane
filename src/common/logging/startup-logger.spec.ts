import { Writable } from 'node:stream';
import pino from 'pino';
import { PinoLogger, type Params } from 'nestjs-pino';
import { createLoggerConfig } from './logger.config.js';
import * as startup from './startup-logger.js';

type NestjsPino = typeof import('nestjs-pino');

/**
 * The production logger (createLoggerConfig with NODE_ENV=production) of a
 * fresh nestjs-pino, writing its lines into `lines`.
 */
function productionLogger(lines: string[]) {
  const previous = process.env['NODE_ENV'];
  process.env['NODE_ENV'] = 'production';
  let options: unknown;
  try {
    options = createLoggerConfig().pinoHttp;
  } finally {
    process.env['NODE_ENV'] = previous;
  }
  const sink = new Writable({
    write(chunk: Buffer, _enc, done) {
      lines.push(...chunk.toString().split('\n').filter(Boolean));
      done();
    },
  });
  const params = { pinoHttp: [options, sink] } as unknown as Params;
  let np!: NestjsPino;
  jest.isolateModules(() => {
    np = jest.requireActual<NestjsPino>('nestjs-pino');
  });
  return new np.Logger(new np.PinoLogger(params), params);
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('startup failure logging', () => {
  it('a startup failure is one JSON line at error level, shaped like every other line', async () => {
    const lines: string[] = [];
    const logger = productionLogger(lines);
    logger.log('Master realm created. Admin user: admin', 'AdminSeedService');
    const cause = new Error('realms[0].clients[0].clientSecret: is required');
    logger.error(
      new Error('Instance bootstrap (BOOTSTRAP_JSON) failed', { cause }),
      startup.STARTUP_CONTEXT,
    );
    await settle();

    expect(lines).toHaveLength(2);
    const [info, failure] = lines.map(
      (l) => JSON.parse(l) as Record<string, unknown>,
    );
    expect(info).toMatchObject({ level: 30, context: 'AdminSeedService' });
    for (const key of ['time', 'pid', 'hostname']) {
      expect(failure[key]).toEqual(expect.anything());
      expect(typeof failure[key]).toBe(typeof info[key]);
    }
    expect(failure).toMatchObject({
      level: 50,
      context: 'Startup',
      msg: 'Instance bootstrap (BOOTSTRAP_JSON) failed',
      err: expect.objectContaining({
        type: 'Error',
        // pino's error serializer appends the cause: the reason is all there.
        message:
          'Instance bootstrap (BOOTSTRAP_JSON) failed: realms[0].clients[0].clientSecret: is required',
        stack: expect.any(String),
      }),
    });
  });

  describe('exitOnStartupFailure', () => {
    const root = Object.getOwnPropertyDescriptor(PinoLogger, 'root');
    let order: string[];
    let flushSync: jest.Mock;
    const nodeEnv = process.env['NODE_ENV'];

    // The production logger: no pino-pretty worker thread in the test.
    beforeAll(() => {
      process.env['NODE_ENV'] = 'production';
    });
    afterAll(() => {
      process.env['NODE_ENV'] = nodeEnv;
    });

    beforeEach(() => {
      order = [];
      flushSync = jest.fn(() => order.push('flush'));
      // Built first: building it sets PinoLogger.root.
      startup.startupLogger();
      Object.defineProperty(PinoLogger, 'root', {
        configurable: true,
        writable: true,
        value: { [pino.symbols.streamSym]: { flushSync } },
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
      if (root) Object.defineProperty(PinoLogger, 'root', root);
    });

    const exitMock = () =>
      jest.fn((code: number) => {
        order.push(`exit ${code}`);
        return undefined as never;
      });

    it('logs the error once, writes pending lines, then exits with 1', () => {
      const error = jest
        .spyOn(startup.startupLogger(), 'error')
        .mockImplementation(() => {
          order.push('error');
        });
      const err = new Error('ADMIN_API_KEY must be at least 32 characters');

      startup.exitOnStartupFailure(err, { exit: exitMock() });

      expect(error).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledWith(err, 'Startup');
      expect(order).toEqual(['error', 'flush', 'exit 1']);
    });

    it('does not log again what Nest already logged', () => {
      const error = jest
        .spyOn(startup.startupLogger(), 'error')
        .mockImplementation(() => undefined);

      startup.exitOnStartupFailure(new Error('listen EADDRINUSE'), {
        alreadyLogged: true,
        exit: exitMock(),
      });

      expect(error).not.toHaveBeenCalled();
      expect(order).toEqual(['flush', 'exit 1']);
    });

    it('logs a thrown non-Error as an Error', () => {
      const error = jest
        .spyOn(startup.startupLogger(), 'error')
        .mockImplementation(() => undefined);

      startup.exitOnStartupFailure('plain text', { exit: exitMock() });

      const [logged] = error.mock.calls[0] as [Error];
      expect(logged).toBeInstanceOf(Error);
      expect(logged.message).toBe('plain text');
    });

    it('still exits when flushing fails', () => {
      jest
        .spyOn(startup.startupLogger(), 'error')
        .mockImplementation(() => undefined);
      flushSync.mockImplementation(() => {
        throw new Error('EPIPE');
      });
      const exit = exitMock();

      startup.exitOnStartupFailure(new Error('x'), { exit });

      expect(exit).toHaveBeenCalledWith(1);
    });
  });
});
