import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { CryptoService } from '../crypto/crypto.service.js';
import {
  CaptchaService,
  CAPTCHA_FAILED_MESSAGE,
  CAPTCHA_REQUIRED_MESSAGE,
  type CaptchaVerifyEndpoints,
} from './captcha.service.js';
import type { CaptchaRealmFields } from './captcha-config.js';

const ENDPOINTS: CaptchaVerifyEndpoints = {
  recaptcha: 'http://fake.test/recaptcha/siteverify',
  hcaptcha: 'http://fake.test/hcaptcha/siteverify',
  timeoutMs: 5000,
};

type Realm = CaptchaRealmFields & { name: string };

describe('CaptchaService.verifyForRealm', () => {
  const crypto = new CryptoService();
  let env: Record<string, string | undefined>;
  let service: CaptchaService;
  let fetchMock: jest.SpyInstance;

  const recaptchaRealm = (over: Partial<Realm> = {}): Realm => ({
    name: 'r1',
    captchaEnabled: true,
    captchaProvider: 'recaptcha',
    recaptchaSiteKey: 'rc-site',
    recaptchaSecretKey: crypto.encryptSecret('rc-realm-secret'),
    hcaptchaSiteKey: null,
    hcaptchaSecretKey: null,
    captchaScoreThreshold: 0.5,
    ...over,
  });
  const hcaptchaRealm = (over: Partial<Realm> = {}): Realm => ({
    name: 'r2',
    captchaEnabled: true,
    captchaProvider: 'hcaptcha',
    recaptchaSiteKey: null,
    recaptchaSecretKey: null,
    hcaptchaSiteKey: 'hc-site',
    hcaptchaSecretKey: crypto.encryptSecret('hc-realm-secret'),
    captchaScoreThreshold: 0.5,
    ...over,
  });

  const respond = (body: unknown, status = 200) =>
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  const sentForm = (call = 0): URLSearchParams => {
    const init = fetchMock.mock.calls[call][1] as RequestInit;
    return new URLSearchParams(init.body as string);
  };
  const opts = { action: 'register', remoteIp: '203.0.113.9' };

  beforeEach(() => {
    env = {};
    const config = {
      get: (key: string) => env[key],
    } as unknown as ConfigService;
    service = new CaptchaService(config, crypto, ENDPOINTS);
    fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('unexpected network call'));
  });
  afterEach(() => fetchMock.mockRestore());

  describe('disabled', () => {
    it('passes without a token and makes no network call', async () => {
      await expect(
        service.verifyForRealm(
          recaptchaRealm({ captchaEnabled: false }),
          undefined,
          opts,
        ),
      ).resolves.toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('passes even with an incomplete configuration', async () => {
      await expect(
        service.verifyForRealm(
          {
            ...recaptchaRealm(),
            captchaEnabled: false,
            captchaProvider: null,
            recaptchaSiteKey: null,
          },
          undefined,
          opts,
        ),
      ).resolves.toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('reCAPTCHA v3', () => {
    it('passes a good token and sends the decrypted realm secret and remoteip', async () => {
      respond({ success: true, score: 0.9, action: 'register' });
      await expect(
        service.verifyForRealm(recaptchaRealm(), 'tok', opts),
      ).resolves.toBeUndefined();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe(ENDPOINTS.recaptcha);
      const init = fetchMock.mock.calls[0][1] as RequestInit;
      expect(init.method).toBe('POST');
      expect(init.signal).toBeInstanceOf(AbortSignal);
      const form = sentForm();
      expect(form.get('secret')).toBe('rc-realm-secret');
      expect(form.get('response')).toBe('tok');
      expect(form.get('remoteip')).toBe('203.0.113.9');
      expect(form.has('sitekey')).toBe(false);
    });

    it('rejects a token the provider refuses', async () => {
      respond({ success: false, 'error-codes': ['invalid-input-response'] });
      await expect(
        service.verifyForRealm(recaptchaRealm(), 'tok', opts),
      ).rejects.toThrow(new BadRequestException(CAPTCHA_FAILED_MESSAGE));
    });

    it('does not echo provider error codes to the caller', async () => {
      respond({ success: false, 'error-codes': ['invalid-input-secret'] });
      const err = (await service
        .verifyForRealm(recaptchaRealm(), 'tok', opts)
        .catch((e: unknown) => e)) as BadRequestException;
      expect(err.message).toBe(CAPTCHA_FAILED_MESSAGE);
    });

    it('rejects a score below the default threshold', async () => {
      respond({ success: true, score: 0.3, action: 'register' });
      await expect(
        service.verifyForRealm(recaptchaRealm(), 'tok', opts),
      ).rejects.toThrow(BadRequestException);
    });

    it("uses the realm's threshold", async () => {
      respond({ success: true, score: 0.7, action: 'register' });
      await expect(
        service.verifyForRealm(
          recaptchaRealm({ captchaScoreThreshold: 0.8 }),
          'tok',
          opts,
        ),
      ).rejects.toThrow(BadRequestException);
      respond({ success: true, score: 0.3, action: 'register' });
      await expect(
        service.verifyForRealm(
          recaptchaRealm({ captchaScoreThreshold: 0.2 }),
          'tok',
          opts,
        ),
      ).resolves.toBeUndefined();
    });

    it('accepts a score equal to the threshold', async () => {
      respond({ success: true, score: 0.5, action: 'register' });
      await expect(
        service.verifyForRealm(recaptchaRealm(), 'tok', opts),
      ).resolves.toBeUndefined();
    });

    it('rejects a success without a score (a v2 key)', async () => {
      respond({ success: true, action: 'register' });
      await expect(
        service.verifyForRealm(recaptchaRealm(), 'tok', opts),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects the wrong action', async () => {
      respond({ success: true, score: 0.9, action: 'login' });
      await expect(
        service.verifyForRealm(recaptchaRealm(), 'tok', opts),
      ).rejects.toThrow(new BadRequestException(CAPTCHA_FAILED_MESSAGE));
    });

    it('rejects a missing action', async () => {
      respond({ success: true, score: 0.9 });
      await expect(
        service.verifyForRealm(recaptchaRealm(), 'tok', opts),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('hCaptcha', () => {
    it('passes a good token and sends secret, remoteip and the expected sitekey', async () => {
      respond({ success: true, hostname: 'idp.example.com' });
      await expect(
        service.verifyForRealm(hcaptchaRealm(), 'tok', opts),
      ).resolves.toBeUndefined();
      expect(fetchMock.mock.calls[0][0]).toBe(ENDPOINTS.hcaptcha);
      const form = sentForm();
      expect(form.get('secret')).toBe('hc-realm-secret');
      expect(form.get('response')).toBe('tok');
      expect(form.get('remoteip')).toBe('203.0.113.9');
      expect(form.get('sitekey')).toBe('hc-site');
    });

    it('rejects a token the provider refuses', async () => {
      respond({
        success: false,
        'error-codes': ['invalid-or-already-seen-response'],
      });
      await expect(
        service.verifyForRealm(hcaptchaRealm(), 'tok', opts),
      ).rejects.toThrow(new BadRequestException(CAPTCHA_FAILED_MESSAGE));
    });

    it('does not apply the reCAPTCHA threshold to its risk score (higher = riskier)', async () => {
      respond({ success: true, score: 0.1 });
      await expect(
        service.verifyForRealm(
          hcaptchaRealm({ captchaScoreThreshold: 0.9 }),
          'tok',
          opts,
        ),
      ).resolves.toBeUndefined();
    });

    it('ignores the action (hCaptcha has none)', async () => {
      respond({ success: true });
      await expect(
        service.verifyForRealm(hcaptchaRealm(), 'tok', {
          action: 'register',
        }),
      ).resolves.toBeUndefined();
      expect(sentForm().has('remoteip')).toBe(false);
    });
  });

  describe('missing token', () => {
    it.each([undefined, null, '', '   ', 42, ['tok']])(
      'answers 400 CAPTCHA required for %p without calling the provider',
      async (token) => {
        await expect(
          service.verifyForRealm(recaptchaRealm(), token, opts),
        ).rejects.toThrow(new BadRequestException(CAPTCHA_REQUIRED_MESSAGE));
        expect(fetchMock).not.toHaveBeenCalled();
      },
    );

    it('rejects an oversized token without calling the provider', async () => {
      await expect(
        service.verifyForRealm(recaptchaRealm(), 'x'.repeat(10_001), opts),
      ).rejects.toThrow(new BadRequestException(CAPTCHA_FAILED_MESSAGE));
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('missing configuration fails closed', () => {
    it.each<[string, Partial<Realm>]>([
      ['no provider', { captchaProvider: null }],
      ['the "none" provider', { captchaProvider: 'none' }],
      ['an unknown provider', { captchaProvider: 'turnstile' }],
      ['no site key', { recaptchaSiteKey: null }],
      ['a blank site key', { recaptchaSiteKey: '  ' }],
      ['no secret and no env key', { recaptchaSecretKey: null }],
      ['an empty secret and no env key', { recaptchaSecretKey: '' }],
    ])('refuses with %s (503, no network call)', async (_label, over) => {
      const err: unknown = await service
        .verifyForRealm(recaptchaRealm(over), 'tok', opts)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ServiceUnavailableException);
      expect((err as Error).message).not.toMatch(/secret|site ?key/i);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refuses an hCaptcha realm whose keys are only set for reCAPTCHA', async () => {
      await expect(
        service.verifyForRealm(
          hcaptchaRealm({
            hcaptchaSiteKey: null,
            hcaptchaSecretKey: null,
            recaptchaSiteKey: 'rc-site',
            recaptchaSecretKey: 'rc-secret',
          }),
          'tok',
          opts,
        ),
      ).rejects.toThrow(ServiceUnavailableException);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('secret resolution', () => {
    it('prefers the realm secret over the env key', async () => {
      env['RECAPTCHA_SECRET_KEY'] = 'rc-env-secret';
      respond({ success: true, score: 0.9, action: 'register' });
      await service.verifyForRealm(recaptchaRealm(), 'tok', opts);
      expect(sentForm().get('secret')).toBe('rc-realm-secret');
    });

    it('falls back to the env key when the realm has no secret', async () => {
      env['HCAPTCHA_SECRET_KEY'] = 'hc-env-secret';
      respond({ success: true });
      await service.verifyForRealm(
        hcaptchaRealm({ hcaptchaSecretKey: null }),
        'tok',
        opts,
      );
      expect(sentForm().get('secret')).toBe('hc-env-secret');
    });

    it("does not use the other provider's env key", async () => {
      env['HCAPTCHA_SECRET_KEY'] = 'hc-env-secret';
      await expect(
        service.verifyForRealm(
          recaptchaRealm({ recaptchaSecretKey: null }),
          'tok',
          opts,
        ),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });

  describe('provider failures fail closed', () => {
    it('refuses on a network error', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
      await expect(
        service.verifyForRealm(recaptchaRealm(), 'tok', opts),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('refuses on a timeout', async () => {
      fetchMock.mockRejectedValueOnce(
        new DOMException('The operation was aborted', 'TimeoutError'),
      );
      await expect(
        service.verifyForRealm(hcaptchaRealm(), 'tok', opts),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('refuses on an HTTP error, even with a success body', async () => {
      respond({ success: true, score: 0.9, action: 'register' }, 500);
      await expect(
        service.verifyForRealm(recaptchaRealm(), 'tok', opts),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('refuses a response that is not JSON', async () => {
      fetchMock.mockResolvedValueOnce(new Response('<html>oops</html>'));
      await expect(
        service.verifyForRealm(recaptchaRealm(), 'tok', opts),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('refuses a truthy but non-true success', async () => {
      respond({ success: 'true', score: 0.9, action: 'register' });
      await expect(
        service.verifyForRealm(recaptchaRealm(), 'tok', opts),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('expected hostname', () => {
    const hosted = { ...opts, expectedHostname: 'idp.example.com' };

    it('passes when the provider reports the expected host (case-insensitive)', async () => {
      respond({ success: true, hostname: 'IDP.example.com' });
      await expect(
        service.verifyForRealm(hcaptchaRealm(), 'tok', hosted),
      ).resolves.toBeUndefined();
    });

    it('rejects another host', async () => {
      respond({
        success: true,
        score: 0.9,
        action: 'register',
        hostname: 'evil.example',
      });
      await expect(
        service.verifyForRealm(recaptchaRealm(), 'tok', hosted),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a missing hostname', async () => {
      respond({ success: true });
      await expect(
        service.verifyForRealm(hcaptchaRealm(), 'tok', hosted),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when the expected host is empty (unparsable BASE_URL)', async () => {
      respond({ success: true });
      await expect(
        service.verifyForRealm(hcaptchaRealm(), 'tok', {
          ...opts,
          expectedHostname: '',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
