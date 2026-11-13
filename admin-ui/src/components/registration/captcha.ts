/**
 * Loading the realm's CAPTCHA provider in the browser. The server verifies
 * every self-registration with the provider the realm names (see the
 * "Self-Registration and CAPTCHA" guide); this only obtains the token.
 */

export type CaptchaProvider = 'recaptcha' | 'hcaptcha';

interface Grecaptcha {
  ready: (callback: () => void) => void;
  execute: (siteKey: string, options: { action: string }) => Promise<string>;
}

interface Hcaptcha {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      'expired-callback'?: () => void;
      'error-callback'?: () => void;
    },
  ) => string;
  reset: (widgetId?: string) => void;
}

declare global {
  interface Window {
    grecaptcha?: Grecaptcha;
    hcaptcha?: Hcaptcha;
  }
}

/** The realm fields that decide which widget, if any, to show. */
export interface CaptchaRealm {
  captchaEnabled?: boolean;
  captchaProvider?: string | null;
  recaptchaSiteKey?: string | null;
  hcaptchaSiteKey?: string | null;
}

/**
 * The provider and the site key *of that provider*, or null when CAPTCHA is
 * off or the realm has no usable configuration (the server then refuses
 * registration anyway).
 */
export function captchaConfig(
  realm: CaptchaRealm | null | undefined,
): { provider: CaptchaProvider; siteKey: string } | null {
  if (!realm?.captchaEnabled) return null;
  const provider = realm.captchaProvider;
  if (provider !== 'recaptcha' && provider !== 'hcaptcha') return null;
  const siteKey = (
    provider === 'recaptcha' ? realm.recaptchaSiteKey : realm.hcaptchaSiteKey
  )?.trim();
  return siteKey ? { provider, siteKey } : null;
}

/** The provider script URL for a site key. */
export function captchaScriptUrl(
  provider: CaptchaProvider,
  siteKey: string,
): string {
  return provider === 'recaptcha'
    ? `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}`
    : 'https://js.hcaptcha.com/1/api.js?render=explicit';
}

const loading = new Map<string, Promise<void>>();

/** Adds the script once per URL; resolves when it has loaded. */
export function loadCaptchaScript(src: string): Promise<void> {
  const existing = loading.get(src);
  if (existing) return existing;
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loading.delete(src);
      script.remove();
      reject(new Error('The CAPTCHA could not be loaded.'));
    };
    document.head.appendChild(script);
  });
  loading.set(src, promise);
  return promise;
}

/** Forget loaded scripts (tests only). */
export function resetCaptchaScriptsForTests(): void {
  loading.clear();
}

/** A fresh reCAPTCHA v3 token for the `register` action. */
export function executeRecaptcha(siteKey: string): Promise<string> {
  const grecaptcha = window.grecaptcha;
  if (!grecaptcha) {
    return Promise.reject(new Error('The CAPTCHA could not be loaded.'));
  }
  return new Promise<string>((resolve, reject) => {
    grecaptcha.ready(() => {
      grecaptcha.execute(siteKey, { action: 'register' }).then(resolve, reject);
    });
  });
}
