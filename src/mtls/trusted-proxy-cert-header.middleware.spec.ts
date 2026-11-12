import type { IncomingMessage, ServerResponse } from 'node:http';
import { createTrustedProxyCertHeaderMiddleware } from './trusted-proxy-cert-header.middleware.js';
import { loadMtlsConfig, type MtlsProxyConfig } from './mtls-config.js';

function proxyConfig(env: Record<string, string> = {}): MtlsProxyConfig {
  const proxy = loadMtlsConfig({
    MTLS_ENABLED: 'true',
    MTLS_PROXY_CERT_HEADER: 'X-Client-Cert',
    MTLS_PROXY_CERT_CHAIN_HEADER: 'X-Client-Cert-Chain',
    MTLS_TRUSTED_PROXY_CIDRS: '10.0.0.0/8,fd00::/8',
    ...env,
  }).proxy;
  if (!proxy) throw new Error('proxy config expected');
  return proxy;
}

function call(
  middleware: ReturnType<typeof createTrustedProxyCertHeaderMiddleware>,
  headers: Record<string, string>,
  remoteAddress: string | undefined,
) {
  const req = {
    headers: { ...headers },
    socket: { remoteAddress },
  } as unknown as IncomingMessage;
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as string | undefined,
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
    },
    end(body?: string) {
      this.body = body;
    },
  };
  const next = jest.fn();
  middleware(req, res as unknown as ServerResponse, next);
  return { req, res, next };
}

describe('trusted proxy certificate header middleware', () => {
  const logger = () => ({ warn: jest.fn() });

  it('passes a request without the headers', () => {
    const { next, res } = call(
      createTrustedProxyCertHeaderMiddleware(proxyConfig(), logger()),
      {},
      '198.51.100.1',
    );
    expect(next).toHaveBeenCalledWith();
    expect(res.body).toBeUndefined();
  });

  it.each(['10.1.2.3', '::ffff:10.1.2.3', 'fd00::1'])(
    'passes the header from trusted proxy %s',
    (peer) => {
      const { next, req } = call(
        createTrustedProxyCertHeaderMiddleware(proxyConfig(), logger()),
        { 'x-client-cert': 'abc' },
        peer,
      );
      expect(next).toHaveBeenCalledWith();
      expect(req.headers['x-client-cert']).toBe('abc');
    },
  );

  it.each([[{ 'x-client-cert': 'abc' }], [{ 'x-client-cert-chain': 'abc' }]])(
    'rejects %j from an untrusted peer with 400 invalid_request by default',
    (headers) => {
      const log = logger();
      const { next, res } = call(
        createTrustedProxyCertHeaderMiddleware(proxyConfig(), log),
        headers,
        '198.51.100.1',
      );
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(400);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(JSON.parse(res.body!)).toMatchObject({ error: 'invalid_request' });
      expect(log.warn).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects when the peer address is unknown', () => {
    const { next, res } = call(
      createTrustedProxyCertHeaderMiddleware(proxyConfig(), logger()),
      { 'x-client-cert': 'abc' },
      undefined,
    );
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
  });

  it('strips the headers from an untrusted peer when configured to', () => {
    const { next, req, res } = call(
      createTrustedProxyCertHeaderMiddleware(
        proxyConfig({ MTLS_PROXY_UNTRUSTED_HEADER_ACTION: 'strip' }),
        logger(),
      ),
      {
        'x-client-cert': 'abc',
        'x-client-cert-chain': 'def',
        'x-other': 'kept',
      },
      '198.51.100.1',
    );
    expect(next).toHaveBeenCalledWith();
    expect(res.body).toBeUndefined();
    expect(req.headers['x-client-cert']).toBeUndefined();
    expect(req.headers['x-client-cert-chain']).toBeUndefined();
    expect(req.headers['x-other']).toBe('kept');
  });

  it('logs each peer at most once a minute', () => {
    const log = logger();
    let time = 1_000_000;
    const middleware = createTrustedProxyCertHeaderMiddleware(
      proxyConfig(),
      log,
      () => time,
    );
    call(middleware, { 'x-client-cert': 'a' }, '198.51.100.1');
    call(middleware, { 'x-client-cert': 'a' }, '198.51.100.1');
    call(middleware, { 'x-client-cert': 'a' }, '::ffff:198.51.100.1');
    expect(log.warn).toHaveBeenCalledTimes(1);
    call(middleware, { 'x-client-cert': 'a' }, '198.51.100.2');
    expect(log.warn).toHaveBeenCalledTimes(2);
    time += 60_000;
    call(middleware, { 'x-client-cert': 'a' }, '198.51.100.1');
    expect(log.warn).toHaveBeenCalledTimes(3);
    expect(log.warn.mock.calls[0][0]).toContain('198.51.100.1');
  });

  it('keeps logging within bounds under many spoofed peers', () => {
    const log = logger();
    const middleware = createTrustedProxyCertHeaderMiddleware(
      proxyConfig(),
      log,
      () => 5,
    );
    for (let i = 0; i < 10_050; i++) {
      call(middleware, { 'x-client-cert': 'a' }, `2001:db8::${i.toString(16)}`);
    }
    // Every distinct peer is logged once; the tracking map was reset rather than grown.
    expect(log.warn).toHaveBeenCalledTimes(10_050);
  });
});
