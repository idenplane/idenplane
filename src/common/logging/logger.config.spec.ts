import {
  accessLogLevel,
  accessLogMode,
  createLoggerConfig,
} from './logger.config.js';
import { SENSITIVE_BODY_FIELDS } from '../security/sensitive-body-fields.js';

describe('createLoggerConfig', () => {
  function getRedactPaths(): string[] {
    const config = createLoggerConfig();
    return (config.pinoHttp as { redact: { paths: string[] } }).redact.paths;
  }

  it('should redact the authorization and admin API key headers', () => {
    const paths = getRedactPaths();
    expect(paths).toContain('req.headers.authorization');
    expect(paths).toContain('req.headers["x-admin-api-key"]');
  });

  it('should redact every field in the canonical sensitive-body-fields list', () => {
    const paths = getRedactPaths();
    for (const field of SENSITIVE_BODY_FIELDS) {
      expect(paths).toContain(`req.body.${field}`);
    }
  });

  it('should redact the realm-config secrets covered by this fix', () => {
    const paths = getRedactPaths();
    expect(paths).toContain('req.body.recaptchaSecretKey');
    expect(paths).toContain('req.body.hcaptchaSecretKey');
    expect(paths).toContain('req.body.emailProviderConfig');
    expect(paths).toContain('req.body.smsProviderConfig');
  });

  it('should censor redacted values with [REDACTED]', () => {
    const config = createLoggerConfig();
    expect(
      (config.pinoHttp as { redact: { censor: string } }).redact.censor,
    ).toBe('[REDACTED]');
  });
});

describe('access log (LOG_ACCESS)', () => {
  it('defaults to errors, and accepts all and off', () => {
    expect(accessLogMode(undefined)).toBe('errors');
    expect(accessLogMode('')).toBe('errors');
    expect(accessLogMode('nonsense')).toBe('errors');
    expect(accessLogMode('ALL')).toBe('all');
    expect(accessLogMode(' off ')).toBe('off');
  });

  it('logs failed requests in every mode that logs, successful ones only with all', () => {
    for (const mode of ['errors', 'all'] as const) {
      expect(accessLogLevel(mode, 500)).toBe('error');
      expect(accessLogLevel(mode, 200, new Error('x'))).toBe('error');
      expect(accessLogLevel(mode, 404)).toBe('warn');
      expect(accessLogLevel(mode, 401)).toBe('warn');
    }
    expect(accessLogLevel('errors', 200)).toBe('silent');
    expect(accessLogLevel('errors', 302)).toBe('silent');
    expect(accessLogLevel('all', 200)).toBe('info');
  });

  describe('through pino-http', () => {
    const env = { ...process.env };
    afterEach(() => {
      process.env = { ...env };
    });

    /** Serves one request per status code and returns the logged lines. */
    const linesFor = async (statuses: number[]) => {
      const pinoHttp = (await import('pino-http')).default;
      const { Writable } = await import('node:stream');
      const http = await import('node:http');
      const lines: Array<{ msg: string; res?: { statusCode: number } }> = [];
      const sink = new Writable({
        write(chunk: Buffer, _enc, done) {
          for (const l of chunk.toString().split('\n').filter(Boolean)) {
            lines.push(JSON.parse(l));
          }
          done();
        },
      });
      const options = createLoggerConfig().pinoHttp as object;
      const middleware = pinoHttp(
        { ...(options as Record<string, unknown>), transport: undefined },
        sink,
      );
      const server = http.createServer((req, res) => {
        middleware(req, res);
        res.statusCode = Number(req.url?.slice(1));
        res.end();
      });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      const { port } = server.address() as { port: number };
      for (const s of statuses) await fetch(`http://127.0.0.1:${port}/${s}`);
      await new Promise((r) => server.close(r));
      await new Promise((r) => setImmediate(r));
      return lines.filter((l) => l.res).map((l) => l.res!.statusCode);
    };

    it('by default writes a line only for failed requests', async () => {
      delete process.env['LOG_ACCESS'];
      expect(await linesFor([200, 204, 401, 500])).toEqual([401, 500]);
    });

    it('with LOG_ACCESS=all writes every request', async () => {
      process.env['LOG_ACCESS'] = 'all';
      expect(await linesFor([200, 404])).toEqual([200, 404]);
    });

    it('with LOG_ACCESS=off writes none', async () => {
      process.env['LOG_ACCESS'] = 'off';
      expect(await linesFor([200, 500])).toEqual([]);
    });
  });
});
