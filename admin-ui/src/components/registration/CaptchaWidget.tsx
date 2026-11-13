import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  captchaScriptUrl,
  executeRecaptcha,
  loadCaptchaScript,
  type CaptchaProvider,
} from './captcha';

interface CaptchaWidgetProps {
  provider: CaptchaProvider;
  siteKey: string;
}

export interface CaptchaWidgetHandle {
  /**
   * The token to send as `captchaToken`: the solved hCaptcha checkbox, or a
   * reCAPTCHA v3 token generated now for the `register` action (they expire
   * after two minutes, so never earlier). Null when hCaptcha isn't solved.
   */
  getToken: () => Promise<string | null>;
  /** Clear a used token (tokens work once). */
  reset: () => void;
}

const CaptchaWidget = forwardRef<CaptchaWidgetHandle, CaptchaWidgetProps>(
  function CaptchaWidget({ provider, siteKey }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const widgetIdRef = useRef<string | undefined>(undefined);
    const tokenRef = useRef<string | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);

    useEffect(() => {
      let cancelled = false;
      tokenRef.current = null;
      setLoadError(null);
      loadCaptchaScript(captchaScriptUrl(provider, siteKey))
        .then(() => {
          if (cancelled || provider !== 'hcaptcha') return;
          const hcaptcha = window.hcaptcha;
          if (!hcaptcha || !containerRef.current) {
            throw new Error('The CAPTCHA could not be loaded.');
          }
          widgetIdRef.current = hcaptcha.render(containerRef.current, {
            sitekey: siteKey,
            callback: (token) => {
              tokenRef.current = token;
            },
            'expired-callback': () => {
              tokenRef.current = null;
            },
            'error-callback': () => {
              tokenRef.current = null;
            },
          });
        })
        .catch((err: Error) => {
          if (!cancelled) setLoadError(err.message);
        });
      return () => {
        cancelled = true;
      };
    }, [provider, siteKey]);

    useImperativeHandle(
      ref,
      () => ({
        getToken: async () =>
          provider === 'recaptcha' ? executeRecaptcha(siteKey) : tokenRef.current,
        reset: () => {
          tokenRef.current = null;
          if (provider === 'hcaptcha') window.hcaptcha?.reset(widgetIdRef.current);
        },
      }),
      [provider, siteKey],
    );

    return (
      <div className="space-y-2">
        {provider === 'hcaptcha' ? (
          <div ref={containerRef} data-testid="hcaptcha-container" />
        ) : (
          <p className="text-xs text-subtle">
            This site is protected by reCAPTCHA; the Google{' '}
            <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="text-accent">
              Privacy Policy
            </a>{' '}
            and{' '}
            <a href="https://policies.google.com/terms" target="_blank" rel="noopener noreferrer" className="text-accent">
              Terms of Service
            </a>{' '}
            apply.
          </p>
        )}
        {loadError && (
          <p role="alert" className="text-sm text-danger">
            {loadError}
          </p>
        )}
      </div>
    );
  },
);

export default CaptchaWidget;
