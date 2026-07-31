// The SMS webhook provider posts to an operator-supplied URL, so it must go
// through the SSRF-safe client rather than raw fetch.
const mockSafePost = jest.fn();
jest.mock('../../common/security/safe-http-client.js', () => ({
  ...jest.requireActual('../../common/security/safe-http-client.js'),
  safePost: (...args: unknown[]) => mockSafePost(...args),
}));

const mockFetch = jest.fn(() => {
  throw new Error('SMS webhook delivery must not call fetch() directly');
});
global.fetch = mockFetch as any;

import { WebhookSmsProvider } from './webhook.provider.js';
import { SsrfBlockedError } from '../../common/security/safe-http-client.js';

describe('WebhookSmsProvider', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...OLD_ENV, SMS_WEBHOOK_URL: 'https://sms.example.com/send' };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('delivers through the SSRF-safe client, not fetch', async () => {
    mockSafePost.mockResolvedValueOnce({ statusCode: 200, body: 'queued' });

    const provider = new WebhookSmsProvider();
    await provider.sendSms('+15550100', 'hello');

    expect(mockSafePost).toHaveBeenCalledTimes(1);
    const [url, body, headers, options] = mockSafePost.mock.calls[0] as [
      string,
      string,
      Record<string, string>,
      { timeoutMs?: number },
    ];
    expect(url).toBe('https://sms.example.com/send');
    expect(JSON.parse(body)).toMatchObject({
      to: '+15550100',
      message: 'hello',
    });
    expect(headers['Content-Type']).toBe('application/json');
    expect(options.timeoutMs).toBe(30000);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('surfaces a non-2xx response as an error', async () => {
    mockSafePost.mockResolvedValueOnce({ statusCode: 502, body: 'upstream' });

    const provider = new WebhookSmsProvider();

    await expect(provider.sendSms('+15550100', 'hello')).rejects.toThrow(
      /Webhook API error: 502/,
    );
  });

  it('fails without delivering when the target is blocked by SSRF policy', async () => {
    mockSafePost.mockRejectedValueOnce(new SsrfBlockedError());

    const provider = new WebhookSmsProvider();

    await expect(provider.sendSms('+15550100', 'hello')).rejects.toThrow(
      /not publicly routable/,
    );
  });

  it('still throws when the URL is not configured', async () => {
    process.env = { ...OLD_ENV };
    delete process.env['SMS_WEBHOOK_URL'];

    const provider = new WebhookSmsProvider();

    await expect(provider.sendSms('+15550100', 'hello')).rejects.toThrow(
      /SMS_WEBHOOK_URL is required/,
    );
    expect(mockSafePost).not.toHaveBeenCalled();
  });
});
