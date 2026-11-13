import { describe, it, expect } from 'vitest';
import { captchaConfig, captchaScriptUrl } from '../captcha';

describe('captchaConfig', () => {
  it('is null when CAPTCHA is off or incomplete', () => {
    expect(captchaConfig(null)).toBeNull();
    expect(captchaConfig({ captchaEnabled: false, captchaProvider: 'hcaptcha', hcaptchaSiteKey: 'k' })).toBeNull();
    expect(captchaConfig({ captchaEnabled: true, captchaProvider: 'none', hcaptchaSiteKey: 'k' })).toBeNull();
    expect(captchaConfig({ captchaEnabled: true, captchaProvider: 'hcaptcha', hcaptchaSiteKey: ' ' })).toBeNull();
  });

  it("uses the site key of the realm's provider only", () => {
    const realm = {
      captchaEnabled: true,
      recaptchaSiteKey: 'rc',
      hcaptchaSiteKey: 'hc',
    };
    expect(captchaConfig({ ...realm, captchaProvider: 'hcaptcha' })).toEqual({ provider: 'hcaptcha', siteKey: 'hc' });
    expect(captchaConfig({ ...realm, captchaProvider: 'recaptcha' })).toEqual({ provider: 'recaptcha', siteKey: 'rc' });
    expect(captchaConfig({ captchaEnabled: true, captchaProvider: 'recaptcha', hcaptchaSiteKey: 'hc' })).toBeNull();
  });
});

describe('captchaScriptUrl', () => {
  it('loads reCAPTCHA v3 with the encoded site key and hCaptcha for explicit rendering', () => {
    expect(captchaScriptUrl('recaptcha', 'a&b')).toBe('https://www.google.com/recaptcha/api.js?render=a%26b');
    expect(captchaScriptUrl('hcaptcha', 'x')).toBe('https://js.hcaptcha.com/1/api.js?render=explicit');
  });
});
