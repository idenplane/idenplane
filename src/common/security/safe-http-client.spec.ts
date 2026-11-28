jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }));

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { lookup } from 'node:dns/promises';
import {
  assertNotLinkLocalTarget,
  safeGet,
  safePost,
  SsrfBlockedError,
} from './safe-http-client.js';

const mockLookup = lookup as unknown as jest.Mock;

describe('safePost / safeGet redirects', () => {
  let server: Server;
  let base: string;
  const previous = process.env['WEBHOOK_ALLOW_PRIVATE_TARGETS'];

  beforeAll(async () => {
    // A loopback receiver: an IP literal, so no DNS lookup is involved.
    process.env['WEBHOOK_ALLOW_PRIVATE_TARGETS'] = 'true';
    server = createServer((req, res) => {
      if (req.url === '/moved') {
        res.writeHead(302, { Location: '/final' });
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(`at ${req.url}`);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previous === undefined)
      delete process.env['WEBHOOK_ALLOW_PRIVATE_TARGETS'];
    else process.env['WEBHOOK_ALLOW_PRIVATE_TARGETS'] = previous;
  });

  it('follows a re-validated redirect by default', async () => {
    await expect(safePost(`${base}/moved`, '{}', {})).resolves.toEqual({
      statusCode: 200,
      body: 'at /final',
    });
    await expect(safeGet(`${base}/moved`)).resolves.toEqual({
      statusCode: 200,
      body: 'at /final',
    });
  });

  it('refuses a redirect when followRedirects is false', async () => {
    await expect(
      safePost(`${base}/moved`, '{}', {}, { followRedirects: false }),
    ).rejects.toThrow('redirects are not followed');
    await expect(
      safeGet(`${base}/moved`, {}, { followRedirects: false }),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(
      safePost(`${base}/ok`, '{}', {}, { followRedirects: false }),
    ).resolves.toEqual({ statusCode: 200, body: 'at /ok' });
  });

  it('refuses a private target unless private targets are allowed', async () => {
    process.env['WEBHOOK_ALLOW_PRIVATE_TARGETS'] = 'false';
    try {
      await expect(safePost(`${base}/ok`, '{}', {})).rejects.toBeInstanceOf(
        SsrfBlockedError,
      );
    } finally {
      process.env['WEBHOOK_ALLOW_PRIVATE_TARGETS'] = 'true';
    }
  });
});

describe('assertNotLinkLocalTarget', () => {
  beforeEach(() => mockLookup.mockReset());

  it.each([
    'http://169.254.169.254/latest/meta-data/',
    'http://[fd00:ec2::254]/latest',
    'http://[fe80::1]/logout',
    'http://[::ffff:169.254.169.254]/',
    // The URL parser normalises a decimal IPv4 host to dotted form.
    'http://2852039166/',
  ])('refuses %s without a DNS lookup', async (url) => {
    await expect(assertNotLinkLocalTarget(url)).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it.each([
    'http://10.0.0.5:8080/backchannel',
    'http://127.0.0.1:3001/logout',
    'https://[::1]/logout',
    'https://203.0.114.10/logout',
  ])('allows private, loopback and public addresses: %s', async (url) => {
    await expect(assertNotLinkLocalTarget(url)).resolves.toBeUndefined();
  });

  it('refuses a name that resolves to a metadata address, among others', async () => {
    mockLookup.mockResolvedValue([
      { address: '10.0.0.7', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ]);

    await expect(
      assertNotLinkLocalTarget('http://metadata.google.internal/'),
    ).rejects.toThrow('link-local or cloud-metadata');
    expect(mockLookup).toHaveBeenCalledWith('metadata.google.internal', {
      all: true,
      verbatim: true,
    });
  });

  it('allows a name that resolves to an internal service', async () => {
    mockLookup.mockResolvedValue([{ address: '172.18.0.4', family: 4 }]);

    await expect(
      assertNotLinkLocalTarget('http://app.internal:8080/bc-logout'),
    ).resolves.toBeUndefined();
  });

  it('fails when the name does not resolve', async () => {
    mockLookup.mockRejectedValue(new Error('ENOTFOUND'));

    await expect(
      assertNotLinkLocalTarget('http://nowhere.invalid/'),
    ).rejects.toThrow('DNS resolution failed');
  });

  it.each(['ftp://example.com/x', 'file:///etc/passwd', 'not a url'])(
    'refuses %s: not an http(s) URL',
    async (url) => {
      await expect(assertNotLinkLocalTarget(url)).rejects.toThrow(
        'not an http(s) URL',
      );
    },
  );
});
