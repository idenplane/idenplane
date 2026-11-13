/**
 * Pure helpers for a realm's CAPTCHA settings, shared by the verifier
 * (CaptchaService), the hosted registration page (widget + CSP) and the admin
 * validation in RealmsService. No Nest or Prisma runtime imports, so any
 * module can use them without creating an import cycle.
 */

export const CAPTCHA_PROVIDERS = ['recaptcha', 'hcaptcha'] as const;
export type CaptchaProviderName = (typeof CAPTCHA_PROVIDERS)[number];

export function isCaptchaProvider(
  value: unknown,
): value is CaptchaProviderName {
  return (
    typeof value === 'string' &&
    (CAPTCHA_PROVIDERS as readonly string[]).includes(value)
  );
}

/** Environment fallback for a provider's secret, used only when the realm has none. */
export const CAPTCHA_ENV_SECRET: Record<CaptchaProviderName, string> = {
  recaptcha: 'RECAPTCHA_SECRET_KEY',
  hcaptcha: 'HCAPTCHA_SECRET_KEY',
};

/** The realm columns that hold CAPTCHA settings (secrets as stored: encrypted). */
export interface CaptchaRealmFields {
  captchaEnabled: boolean;
  captchaProvider: string | null;
  recaptchaSiteKey: string | null;
  recaptchaSecretKey: string | null;
  hcaptchaSiteKey: string | null;
  hcaptchaSecretKey: string | null;
  captchaScoreThreshold: number;
}

function nonBlank(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** The site key the realm configured for `provider`, or null when blank. */
export function captchaSiteKey(
  realm: Pick<CaptchaRealmFields, 'recaptchaSiteKey' | 'hcaptchaSiteKey'>,
  provider: CaptchaProviderName,
): string | null {
  return nonBlank(
    provider === 'recaptcha' ? realm.recaptchaSiteKey : realm.hcaptchaSiteKey,
  );
}

/** The realm's stored (encrypted) secret for `provider`, or null when blank. */
export function captchaStoredSecret(
  realm: Pick<CaptchaRealmFields, 'recaptchaSecretKey' | 'hcaptchaSecretKey'>,
  provider: CaptchaProviderName,
): string | null {
  return nonBlank(
    provider === 'recaptcha'
      ? realm.recaptchaSecretKey
      : realm.hcaptchaSecretKey,
  );
}

/** The provider's secret from the environment fallback, or null when unset. */
export function captchaEnvSecret(
  provider: CaptchaProviderName,
  env: (key: string) => string | undefined,
): string | null {
  return nonBlank(env(CAPTCHA_ENV_SECRET[provider]));
}

/**
 * Why a realm with CAPTCHA turned on could not verify a token, or null when
 * its settings are complete. The message is for administrators and server
 * logs, never for end users. A disabled realm is always complete.
 */
export function captchaConfigProblem(
  realm: CaptchaRealmFields,
  env: (key: string) => string | undefined,
): string | null {
  if (!realm.captchaEnabled) return null;
  const provider = realm.captchaProvider;
  if (!isCaptchaProvider(provider)) {
    return `CAPTCHA is enabled but captchaProvider must be one of: ${CAPTCHA_PROVIDERS.join(', ')}.`;
  }
  const keyPrefix = provider === 'recaptcha' ? 'recaptcha' : 'hcaptcha';
  if (!captchaSiteKey(realm, provider)) {
    return `CAPTCHA is enabled with ${provider} but ${keyPrefix}SiteKey is not set.`;
  }
  if (
    !captchaStoredSecret(realm, provider) &&
    !captchaEnvSecret(provider, env)
  ) {
    return `CAPTCHA is enabled with ${provider} but neither ${keyPrefix}SecretKey nor ${CAPTCHA_ENV_SECRET[provider]} is set.`;
  }
  return null;
}

/** What the hosted registration page needs to render a provider's widget. */
export interface CaptchaWidget {
  provider: CaptchaProviderName;
  siteKey: string;
  scriptUrl: string;
  isRecaptcha: boolean;
  isHcaptcha: boolean;
  /** Form field the widget posts its token in. */
  tokenField: string;
}

/** The form field each provider's widget posts its token in. */
export const CAPTCHA_TOKEN_FIELD: Record<CaptchaProviderName, string> = {
  recaptcha: 'g-recaptcha-response',
  hcaptcha: 'h-captcha-response',
};

/**
 * The widget for a realm's registration page, or null when CAPTCHA is off.
 * A realm that is enabled but has no usable provider or site key also gets
 * null here; its registrations are refused by the server-side check.
 */
export function captchaWidget(
  realm: Pick<
    CaptchaRealmFields,
    | 'captchaEnabled'
    | 'captchaProvider'
    | 'recaptchaSiteKey'
    | 'hcaptchaSiteKey'
  >,
): CaptchaWidget | null {
  if (!realm.captchaEnabled) return null;
  const provider = realm.captchaProvider;
  if (!isCaptchaProvider(provider)) return null;
  const siteKey = captchaSiteKey(realm, provider);
  if (!siteKey) return null;
  const scriptUrl =
    provider === 'recaptcha'
      ? `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}`
      : 'https://js.hcaptcha.com/1/api.js';
  return {
    provider,
    siteKey,
    scriptUrl,
    isRecaptcha: provider === 'recaptcha',
    isHcaptcha: provider === 'hcaptcha',
    tokenField: CAPTCHA_TOKEN_FIELD[provider],
  };
}

/** Extra CSP sources, per directive, that a themed page needs. */
export type CspSourceAdditions = Partial<
  Record<'script-src' | 'frame-src' | 'style-src' | 'connect-src', string[]>
>;

/**
 * Exactly the origins each provider's widget loads from, as documented by the
 * providers. Only the hosted registration page adds them, and only when the
 * realm has CAPTCHA turned on.
 */
export function captchaCspSources(
  provider: CaptchaProviderName,
): CspSourceAdditions {
  if (provider === 'hcaptcha') {
    const hcaptcha = ['https://hcaptcha.com', 'https://*.hcaptcha.com'];
    return {
      'script-src': [...hcaptcha],
      'frame-src': [...hcaptcha],
      'style-src': [...hcaptcha],
      'connect-src': [...hcaptcha],
    };
  }
  const recaptcha = [
    'https://www.google.com/recaptcha/',
    'https://www.gstatic.com/recaptcha/',
  ];
  return {
    'script-src': [...recaptcha],
    'frame-src': [...recaptcha],
  };
}
