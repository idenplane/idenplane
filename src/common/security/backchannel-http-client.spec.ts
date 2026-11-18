jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }));

import { lookup } from 'node:dns/promises';
import { createServer, type Server } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createSecureContext } from 'node:tls';
import type { AddressInfo } from 'node:net';
import { makeTestCertificate } from '../../nhi/__mocks__/certificate.fixture.js';
import { postBackchannelLogout, SsrfBlockedError } from './safe-http-client.js';

const mockLookup = lookup as unknown as jest.Mock;

describe('DNS-pinned back-channel logout transport', () => {
  let server: Server;
  let port: number;
  const originalOverride = process.env['BACKCHANNEL_LOGOUT_ALLOW_LINK_LOCAL'];

  beforeEach(async () => {
    mockLookup.mockReset();
    delete process.env['BACKCHANNEL_LOGOUT_ALLOW_LINK_LOCAL'];
    server = createServer();
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
    if (originalOverride === undefined)
      delete process.env['BACKCHANNEL_LOGOUT_ALLOW_LINK_LOCAL'];
    else process.env['BACKCHANNEL_LOGOUT_ALLOW_LINK_LOCAL'] = originalOverride;
  });

  it('connects only to the validated address when DNS would rebind to metadata', async () => {
    mockLookup
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }])
      .mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
    const received: {
      host?: string;
      body?: string;
      type?: string;
      method?: string;
    } = {};
    server.on('request', (req, res) => {
      received.host = req.headers.host;
      received.type = req.headers['content-type'];
      received.method = req.method;
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        received.body = body;
        res.end('ignored response');
      });
    });

    await expect(
      postBackchannelLogout(
        `http://rebind.invalid:${port}/logout`,
        'logout_token=signed.jwt',
      ),
    ).resolves.toEqual({ statusCode: 200, body: '' });
    expect(mockLookup).toHaveBeenCalledTimes(1);
    expect(received).toEqual({
      host: `rebind.invalid:${port}`,
      type: 'application/x-www-form-urlencoded',
      method: 'POST',
      body: 'logout_token=signed.jwt',
    });
  });

  it('never follows a redirect carrying the token to another URL', async () => {
    const urls: string[] = [];
    server.on('request', (req, res) => {
      urls.push(req.url!);
      res.writeHead(307, { Location: `http://127.0.0.1:${port}/stolen` });
      res.end();
    });
    await expect(
      postBackchannelLogout(
        `http://127.0.0.1:${port}/logout`,
        'logout_token=signed.jwt',
      ),
    ).resolves.toEqual({ statusCode: 307, body: '' });
    expect(urls).toEqual(['/logout']);
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it('retains TLS SNI and refuses an untrusted certificate before sending a token', async () => {
    const identity = await makeTestCertificate({ dns: 'rp.invalid' });
    const tlsOptions = { key: identity.privateKeyPem, cert: identity.pem };
    const names: string[] = [];
    const received = jest.fn();
    const https = createHttpsServer(
      {
        ...tlsOptions,
        SNICallback: (name, callback) => {
          names.push(name);
          callback(null, createSecureContext(tlsOptions));
        },
      },
      received,
    );
    https.on('tlsClientError', () => {});
    await new Promise<void>((resolve) => https.listen(0, '127.0.0.1', resolve));
    mockLookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    try {
      const tlsPort = (https.address() as AddressInfo).port;
      await expect(
        postBackchannelLogout(
          `https://rp.invalid:${tlsPort}/logout`,
          'logout_token=secret',
        ),
      ).rejects.toMatchObject({ code: 'DEPTH_ZERO_SELF_SIGNED_CERT' });
      expect(names).toEqual(['rp.invalid']);
      expect(received).not.toHaveBeenCalled();
      expect(mockLookup).toHaveBeenCalledTimes(1);
    } finally {
      https.closeAllConnections();
      await new Promise<void>((resolve) => https.close(() => resolve()));
    }
  });

  it('rejects the entire DNS result when one answer is a metadata address', async () => {
    mockLookup.mockResolvedValue([
      { address: '127.0.0.1', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ]);
    const received = jest.fn();
    server.on('request', received);
    await expect(
      postBackchannelLogout(`http://mixed.invalid:${port}/logout`, 'token'),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
    expect(received).not.toHaveBeenCalled();
  });

  it.each([
    'http://169.254.169.254/',
    'http://[fd00:ec2::254]/',
    'ftp://localhost/x',
  ])('blocks %s before network access', async (url) => {
    await expect(postBackchannelLogout(url, 'token')).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it('fails closed on an empty DNS result', async () => {
    mockLookup.mockResolvedValue([]);
    await expect(
      postBackchannelLogout('http://empty.invalid/logout', 'token'),
    ).rejects.toThrow('DNS resolution returned no addresses');
  });

  it('keeps pinning when the operator explicitly allows link-local targets', async () => {
    process.env['BACKCHANNEL_LOGOUT_ALLOW_LINK_LOCAL'] = 'true';
    mockLookup.mockResolvedValue([
      { address: '127.0.0.1', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ]);
    server.on('request', (_req, res) => res.end());
    await expect(
      postBackchannelLogout(`http://allowed.invalid:${port}/logout`, 'token'),
    ).resolves.toMatchObject({ statusCode: 200 });
    expect(mockLookup).toHaveBeenCalledTimes(1);
  });

  it('bounds a receiver that never sends a response', async () => {
    server.on('request', () => {});
    await expect(
      postBackchannelLogout(`http://127.0.0.1:${port}/logout`, 'token', {
        timeoutMs: 30,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('times out DNS without sending later if resolution eventually completes', async () => {
    let finishLookup!: (value: { address: string; family: number }[]) => void;
    mockLookup.mockReturnValue(
      new Promise((resolve) => {
        finishLookup = resolve;
      }),
    );
    const received = jest.fn();
    server.on('request', received);
    await expect(
      postBackchannelLogout(`http://slow.invalid:${port}/logout`, 'token', {
        timeoutMs: 30,
      }),
    ).rejects.toThrow('DNS resolution timed out');
    finishLookup([{ address: '127.0.0.1', family: 4 }]);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(received).not.toHaveBeenCalled();
  });
});
