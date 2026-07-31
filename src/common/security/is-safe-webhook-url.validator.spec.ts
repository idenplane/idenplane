import { isSafeWebhookUrl } from './is-safe-webhook-url.validator.js';

describe('isSafeWebhookUrl', () => {
  it('accepts ordinary public http(s) URLs', () => {
    expect(isSafeWebhookUrl('https://example.com/hook')).toBe(true);
    expect(isSafeWebhookUrl('http://example.com:8080/hook?x=1')).toBe(true);
    expect(isSafeWebhookUrl('https://8.8.8.8/hook')).toBe(true);
  });

  it('rejects loopback and private literals', () => {
    for (const url of [
      'http://127.0.0.1/hook',
      'http://localhost:3000/hook',
      'http://LOCALHOST/hook',
      'http://[::1]/hook',
      'http://10.0.0.5/hook',
      'http://192.168.1.1/hook',
      'http://172.16.0.1/hook',
    ]) {
      expect([url, isSafeWebhookUrl(url)]).toEqual([url, false]);
    }
  });

  it('rejects the cloud metadata endpoint', () => {
    expect(isSafeWebhookUrl('http://169.254.169.254/latest/meta-data/')).toBe(
      false,
    );
  });

  it('rejects encoded loopback literals that bypass a naive string check', () => {
    for (const url of [
      'http://2130706433/hook', // decimal 127.0.0.1
      'http://0x7f.0x0.0x0.0x1/hook', // hex-octet 127.0.0.1
      'http://[::ffff:127.0.0.1]/hook', // IPv4-mapped IPv6
    ]) {
      expect([url, isSafeWebhookUrl(url)]).toEqual([url, false]);
    }
  });

  it('rejects non-http(s) protocols and unparseable values', () => {
    expect(isSafeWebhookUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeWebhookUrl('gopher://example.com/')).toBe(false);
    expect(isSafeWebhookUrl('not a url')).toBe(false);
    expect(isSafeWebhookUrl('')).toBe(false);
    expect(isSafeWebhookUrl(undefined)).toBe(false);
    expect(isSafeWebhookUrl(42)).toBe(false);
  });

  it('accepts a public hostname even though it could resolve internally', () => {
    // Documents the boundary: this check is I/O-free and therefore cannot
    // catch DNS-based attacks. resolveSafeTarget at delivery time is what
    // rejects a hostname that resolves to an internal address.
    expect(isSafeWebhookUrl('https://rebound.example.com/hook')).toBe(true);
  });
});
