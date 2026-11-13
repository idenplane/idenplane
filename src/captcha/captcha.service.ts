import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CryptoService } from '../crypto/crypto.service.js';
import {
  captchaConfigProblem,
  captchaEnvSecret,
  captchaSiteKey,
  captchaStoredSecret,
  type CaptchaProviderName,
  type CaptchaRealmFields,
} from './captcha-config.js';

/**
 * Where tokens are verified. A DI token so tests can point the service at a
 * local fake provider; production always uses the defaults below.
 */
export const CAPTCHA_VERIFY_ENDPOINTS = Symbol('CAPTCHA_VERIFY_ENDPOINTS');

export interface CaptchaVerifyEndpoints {
  recaptcha: string;
  hcaptcha: string;
  /** Abort the provider call after this many milliseconds. */
  timeoutMs: number;
}

export const DEFAULT_CAPTCHA_VERIFY_ENDPOINTS: CaptchaVerifyEndpoints = {
  recaptcha: 'https://www.google.com/recaptcha/api/siteverify',
  hcaptcha: 'https://api.hcaptcha.com/siteverify',
  timeoutMs: 5000,
};

/** Messages shown to the end user. Deliberately generic. */
export const CAPTCHA_REQUIRED_MESSAGE = 'CAPTCHA required';
export const CAPTCHA_FAILED_MESSAGE = 'CAPTCHA verification failed';
export const CAPTCHA_UNAVAILABLE_MESSAGE =
  'Registration is temporarily unavailable. Please try again later.';

/** Real tokens are a few kilobytes; anything far larger is not worth sending. */
const MAX_TOKEN_LENGTH = 10_000;
const DEFAULT_SCORE_THRESHOLD = 0.5;

export interface CaptchaVerifyOptions {
  /** reCAPTCHA v3 action the token must carry, e.g. 'register'. */
  action: string;
  /** End-user IP, forwarded to the provider as `remoteip`. */
  remoteIp?: string;
  /**
   * Hostname the widget must have run on. Set by the hosted registration
   * page, whose widget always runs on this server's host. The public API
   * leaves it unset: its callers render the widget on their own domains.
   */
  expectedHostname?: string;
}

interface SiteverifyResponse {
  success?: unknown;
  score?: unknown;
  action?: unknown;
  hostname?: unknown;
  'error-codes'?: unknown;
}

type RealmForCaptcha = CaptchaRealmFields & { name: string };

@Injectable()
export class CaptchaService {
  private readonly logger = new Logger(CaptchaService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly crypto: CryptoService,
    @Inject(CAPTCHA_VERIFY_ENDPOINTS)
    private readonly endpoints: CaptchaVerifyEndpoints,
  ) {}

  /**
   * The one server-side CAPTCHA check for self-registration. Resolves when
   * the realm has CAPTCHA off or the token verifies; throws otherwise:
   *
   * - 400 `CAPTCHA required` for a missing or empty token;
   * - 400 `CAPTCHA verification failed` when the provider rejects the token
   *   (or it has the wrong action, a low score or the wrong hostname);
   * - 503 for an incomplete realm configuration or an unreachable provider.
   *
   * It fails closed: nothing but an explicit, matching success passes. The
   * provider comes only from the realm, never from the request.
   */
  async verifyForRealm(
    realm: RealmForCaptcha,
    token: unknown,
    options: CaptchaVerifyOptions,
  ): Promise<void> {
    if (!realm.captchaEnabled) return;

    const env = (key: string) => this.config.get<string>(key);
    const problem = captchaConfigProblem(realm, env);
    if (problem) {
      this.logger.error(
        `Realm '${realm.name}': refusing registration, ${problem}`,
      );
      throw new ServiceUnavailableException(CAPTCHA_UNAVAILABLE_MESSAGE);
    }
    // captchaConfigProblem guarantees a known provider, a site key and a secret.
    const provider = realm.captchaProvider as CaptchaProviderName;
    const siteKey = captchaSiteKey(realm, provider)!;
    const stored = captchaStoredSecret(realm, provider);
    const secret = stored
      ? this.crypto.decryptSecret(stored)
      : captchaEnvSecret(provider, env)!;

    if (typeof token !== 'string' || token.trim() === '') {
      throw new BadRequestException(CAPTCHA_REQUIRED_MESSAGE);
    }
    if (token.length > MAX_TOKEN_LENGTH) {
      this.reject(realm, provider, ['token-too-long']);
    }

    const data = await this.callProvider(realm, provider, {
      secret,
      response: token,
      remoteip: options.remoteIp,
      // hCaptcha rejects a token minted for another site key when told the
      // expected one; reCAPTCHA binds the token to the secret's key pair.
      sitekey: provider === 'hcaptcha' ? siteKey : undefined,
    });

    if (data.success !== true) {
      this.reject(realm, provider, errorCodes(data));
    }

    if (provider === 'recaptcha') {
      // reCAPTCHA v3 only. A v2 key answers without score/action and fails.
      if (data.action !== options.action) {
        this.reject(realm, provider, ['action-mismatch']);
      }
      const threshold = scoreThreshold(realm.captchaScoreThreshold);
      if (typeof data.score !== 'number' || !(data.score >= threshold)) {
        this.reject(realm, provider, ['score-too-low']);
      }
    }
    // hCaptcha Enterprise's `score` is a risk score (higher = riskier), the
    // inverse of reCAPTCHA's, so the realm threshold is not applied to it.

    if (options.expectedHostname !== undefined) {
      const actual =
        typeof data.hostname === 'string' ? data.hostname.toLowerCase() : '';
      if (!actual || actual !== options.expectedHostname.toLowerCase()) {
        this.reject(realm, provider, ['hostname-mismatch']);
      }
    }
  }

  private async callProvider(
    realm: RealmForCaptcha,
    provider: CaptchaProviderName,
    fields: Record<string, string | undefined>,
  ): Promise<SiteverifyResponse> {
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(fields)) {
      if (value) body.set(key, value);
    }
    try {
      const response = await fetch(this.endpoints[provider], {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: AbortSignal.timeout(this.endpoints.timeoutMs),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data: unknown = await response.json();
      if (!data || typeof data !== 'object') {
        throw new Error('response is not a JSON object');
      }
      return data;
    } catch (err) {
      this.logger.error(
        `Realm '${realm.name}': ${provider} verification unavailable: ${(err as Error).message}`,
      );
      throw new ServiceUnavailableException(CAPTCHA_UNAVAILABLE_MESSAGE);
    }
  }

  private reject(
    realm: RealmForCaptcha,
    provider: CaptchaProviderName,
    codes: string[],
  ): never {
    // Provider error codes go to the log only; the user gets a generic message.
    this.logger.warn(
      `Realm '${realm.name}': ${provider} token rejected (${codes.join(', ') || 'no error codes'})`,
    );
    throw new BadRequestException(CAPTCHA_FAILED_MESSAGE);
  }
}

function errorCodes(data: SiteverifyResponse): string[] {
  const codes = data['error-codes'];
  return Array.isArray(codes)
    ? codes.filter((c): c is string => typeof c === 'string')
    : [];
}

function scoreThreshold(value: unknown): number {
  return typeof value === 'number' && value >= 0 && value <= 1
    ? value
    : DEFAULT_SCORE_THRESHOLD;
}
