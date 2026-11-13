import {
  captchaConfigProblem,
  captchaCspSources,
  captchaWidget,
  type CaptchaRealmFields,
} from './captcha-config.js';

const base: CaptchaRealmFields = {
  captchaEnabled: true,
  captchaProvider: 'hcaptcha',
  recaptchaSiteKey: null,
  recaptchaSecretKey: null,
  hcaptchaSiteKey: 'hc-site',
  hcaptchaSecretKey: 'hc-secret',
  captchaScoreThreshold: 0.5,
};
const noEnv = () => undefined;

describe('captchaConfigProblem', () => {
  it('accepts a disabled realm with nothing set', () => {
    expect(
      captchaConfigProblem(
        { ...base, captchaEnabled: false, captchaProvider: null },
        noEnv,
      ),
    ).toBeNull();
  });

  it('accepts a complete realm', () => {
    expect(captchaConfigProblem(base, noEnv)).toBeNull();
  });

  it('accepts a missing realm secret when the env fallback is set', () => {
    expect(
      captchaConfigProblem({ ...base, hcaptchaSecretKey: null }, (k) =>
        k === 'HCAPTCHA_SECRET_KEY' ? 'env' : undefined,
      ),
    ).toBeNull();
  });

  it.each<[string, Partial<CaptchaRealmFields>, RegExp]>([
    ['no provider', { captchaProvider: null }, /captchaProvider/],
    ['provider none', { captchaProvider: 'none' }, /captchaProvider/],
    ['no site key', { hcaptchaSiteKey: '' }, /hcaptchaSiteKey/],
    ['no secret', { hcaptchaSecretKey: null }, /hcaptchaSecretKey/],
    [
      'reCAPTCHA without its keys',
      { captchaProvider: 'recaptcha' },
      /recaptchaSiteKey/,
    ],
  ])('names the problem with %s', (_label, over, message) => {
    expect(captchaConfigProblem({ ...base, ...over }, noEnv)).toMatch(message);
  });
});

describe('captchaWidget', () => {
  it('is null when disabled or incomplete', () => {
    expect(captchaWidget({ ...base, captchaEnabled: false })).toBeNull();
    expect(captchaWidget({ ...base, captchaProvider: 'none' })).toBeNull();
    expect(captchaWidget({ ...base, hcaptchaSiteKey: null })).toBeNull();
  });

  it('describes the hCaptcha checkbox', () => {
    expect(captchaWidget(base)).toEqual({
      provider: 'hcaptcha',
      siteKey: 'hc-site',
      scriptUrl: 'https://js.hcaptcha.com/1/api.js',
      isRecaptcha: false,
      isHcaptcha: true,
      tokenField: 'h-captcha-response',
    });
  });

  it('loads reCAPTCHA v3 with the URL-encoded site key', () => {
    const widget = captchaWidget({
      ...base,
      captchaProvider: 'recaptcha',
      recaptchaSiteKey: 'a&b=c',
    });
    expect(widget?.scriptUrl).toBe(
      'https://www.google.com/recaptcha/api.js?render=a%26b%3Dc',
    );
    expect(widget?.tokenField).toBe('g-recaptcha-response');
  });
});

describe('captchaCspSources', () => {
  it('lists the hCaptcha origins for script, frame, style and connect', () => {
    const hc = ['https://hcaptcha.com', 'https://*.hcaptcha.com'];
    expect(captchaCspSources('hcaptcha')).toEqual({
      'script-src': hc,
      'frame-src': hc,
      'style-src': hc,
      'connect-src': hc,
    });
  });

  it('lists the reCAPTCHA origins for script and frame only', () => {
    const rc = [
      'https://www.google.com/recaptcha/',
      'https://www.gstatic.com/recaptcha/',
    ];
    expect(captchaCspSources('recaptcha')).toEqual({
      'script-src': rc,
      'frame-src': rc,
    });
  });
});
