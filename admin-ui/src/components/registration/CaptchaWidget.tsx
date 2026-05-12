import { useEffect, useRef } from 'react';

interface CaptchaWidgetProps {
  provider?: string;
  siteKey?: string;
}

declare global {
  interface Window {
    grecaptcha?: {
      ready: (callback: () => void) => void;
      execute: (siteKey: string, options: { action: string }) => Promise<string>;
    };
    hcaptcha?: {
      render: (container: string, options: {
        sitekey: string;
        callback: (token: string) => void;
        'expired-callback'?: () => void;
        'error-callback'?: () => void;
      }) => string;
      reset: (widgetId?: string) => void;
    };
    __captchaToken?: string;
  }
}

export default function CaptchaWidget({ provider, siteKey }: CaptchaWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!siteKey) return;

    if (provider === 'recaptcha' && window.grecaptcha) {
      const grecaptcha = window.grecaptcha;
      grecaptcha.ready(() => {
        grecaptcha.execute(siteKey, { action: 'register' }).then((token) => {
          (window as any).__captchaToken = token;
        }).catch(console.error);
      });
    } else if (provider === 'hcaptcha' && window.hcaptcha && containerRef.current) {
      const containerId = `hcaptcha-${Date.now()}`;
      containerRef.current.id = containerId;
      widgetIdRef.current = window.hcaptcha.render(containerId, {
        sitekey: siteKey,
        callback: (token: string) => {
          (window as any).__captchaToken = token;
        },
      });
    }
  }, [provider, siteKey]);

  if (!siteKey) return null;

  if (provider === 'recaptcha') {
    return (
      <div className="space-y-2">
        <div
          className="grecaptcha-badge"
          data-size="invisible"
          style={{ display: 'none' }}
        />
        <p className="text-xs text-gray-500">
          reCAPTCHA protection active
        </p>
      </div>
    );
  }

  if (provider === 'hcaptcha') {
    return (
      <div ref={containerRef} data-size="normal" />
    );
  }

  return null;
}