import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';

export enum CaptchaProvider {
  RECAPTCHA = 'recaptcha',
  HCAPTCHA = 'hcaptcha',
  NONE = 'none',
}

interface CaptchaVerificationResult {
  success: boolean;
  score?: number;
  errorCodes?: string[];
}

@Injectable()
export class CaptchaService {
  private readonly logger = new Logger(CaptchaService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Verify a reCAPTCHA v3 token
   */
  async verifyRecaptcha(token: string, expectedAction?: string): Promise<CaptchaVerificationResult> {
    const secretKey = this.config.get<string>('RECAPTCHA_SECRET_KEY');
    if (!secretKey) {
      this.logger.warn('RECAPTCHA_SECRET_KEY not configured, skipping verification');
      return { success: true };
    }

    try {
      const params = new URLSearchParams({
        secret: secretKey,
        response: token,
      });

      const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });

      const data = await response.json() as { success: boolean; score?: number; 'error-codes'?: string[]; action?: string };

      if (!data.success) {
        return { success: false, errorCodes: data['error-codes'] };
      }

      // Verify action if provided
      if (expectedAction && data.action !== expectedAction) {
        return { success: false, errorCodes: ['invalid-action'] };
      }

      // Score threshold (reCAPTCHA v3 returns scores 0.0-1.0)
      const scoreThreshold = this.config.get<number>('RECAPTCHA_SCORE_THRESHOLD', 0.5);
      if (data.score !== undefined && data.score < scoreThreshold) {
        return { success: false, errorCodes: ['score-too-low'], score: data.score };
      }

      return { success: true, score: data.score };
    } catch (err) {
      this.logger.error(`reCAPTCHA verification failed: ${(err as Error).message}`);
      return { success: false, errorCodes: ['verification-error'] };
    }
  }

  /**
   * Verify an hCaptcha token
   */
  async verifyHcaptcha(token: string, expectedSecret?: string): Promise<CaptchaVerificationResult> {
    const secretKey = expectedSecret || this.config.get<string>('HCAPTCHA_SECRET_KEY');
    if (!secretKey) {
      this.logger.warn('HCAPTCHA_SECRET_KEY not configured, skipping verification');
      return { success: true };
    }

    try {
      const params = new URLSearchParams({
        secret: secretKey,
        response: token,
      });

      const response = await fetch('https://hcaptcha.com/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });

      const data = await response.json() as { success: boolean; 'error-codes'?: string[] };

      if (!data.success) {
        return { success: false, errorCodes: data['error-codes'] };
      }

      return { success: true };
    } catch (err) {
      this.logger.error(`hCaptcha verification failed: ${(err as Error).message}`);
      return { success: false, errorCodes: ['verification-error'] };
    }
  }

  /**
   * Verify a CAPTCHA token based on provider configuration
   */
  async verify(token: string, provider: CaptchaProvider, expectedAction?: string): Promise<CaptchaVerificationResult> {
    switch (provider) {
      case CaptchaProvider.RECAPTCHA:
        return this.verifyRecaptcha(token, expectedAction);
      case CaptchaProvider.HCAPTCHA:
        return this.verifyHcaptcha(token);
      case CaptchaProvider.NONE:
      default:
        return { success: true };
    }
  }

  /**
   * Validate a realm's CAPTCHA configuration exists
   */
  hasCaptchaConfig(provider: CaptchaProvider, siteKey?: string | null): boolean {
    return provider !== CaptchaProvider.NONE && !!siteKey;
  }
}