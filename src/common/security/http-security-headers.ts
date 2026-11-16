import helmet from 'helmet';
import type { NextFunction, Request, Response } from 'express';

/**
 * Browser features no Idenplane page uses are switched off for the page and
 * anything it frames. WebAuthn (passkeys) stays available to the page's own
 * origin, and so do the clipboard (copying recovery codes, client secrets)
 * and fullscreen. Only features Chromium recognises are listed: an unknown
 * one logs a console warning on every page.
 */
export const PERMISSIONS_POLICY = [
  'accelerometer=()',
  'autoplay=()',
  'camera=()',
  'display-capture=()',
  'encrypted-media=()',
  'geolocation=()',
  'gyroscope=()',
  'magnetometer=()',
  'microphone=()',
  'midi=()',
  'payment=()',
  'picture-in-picture=()',
  'screen-wake-lock=()',
  'usb=()',
  'xr-spatial-tracking=()',
  'clipboard-read=()',
  'clipboard-write=(self)',
  'fullscreen=(self)',
  'publickey-credentials-create=(self)',
  'publickey-credentials-get=(self)',
].join(', ');

/**
 * Paths whose responses are meant to be embedded by other sites without
 * CORS (an <img> of a realm logo in a client app or a webmail), so their
 * Cross-Origin-Resource-Policy is `cross-origin`. Everything else is
 * `same-origin`: no other site can pull an Idenplane response into its own
 * process with a no-cors request. CORS requests (discovery, JWKS, the token
 * endpoint called from SPAs) are not affected by CORP.
 */
const CROSS_ORIGIN_EMBEDDABLE = /^\/themes\//;

/**
 * Responses that may be kept by caches: static theme and console assets, and
 * the public, non-personal OIDC metadata (discovery, JWKS) that clients are
 * expected to cache. Everything else is dynamic and often personal (hosted
 * pages carrying a CSRF token, the account page, admin API responses, which
 * authenticate with x-admin-api-key rather than Authorization and so are not
 * protected from shared caches by HTTP's default rules) and is `no-store`
 * unless its handler says otherwise.
 */
const CACHEABLE =
  /^\/(themes|console)(\/|$)|\/\.well-known\/|\/protocol\/openid-connect\/certs$/;

/** helmet, as Idenplane configures it (the admin console and JSON responses; hosted pages replace the CSP, see buildThemeCsp). */
export function helmetMiddleware() {
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        // 'data:' allows the admin-ui Vite bundle's inlined woff2 font,
        // which is emitted as a data: URI (mirrors imgSrc below).
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: null,
      },
    },
    hsts: {
      maxAge: 31536000, // 1 year in seconds
      includeSubDomains: true,
      preload: true,
    },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
  });
}

/**
 * Permissions-Policy on every response, the CORP exception above, and a
 * `no-store` default for dynamic responses (a handler or static server that
 * sets its own Cache-Control later wins).
 */
export function extraSecurityHeaders(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
  if (!CACHEABLE.test(req.path)) {
    res.setHeader('Cache-Control', 'no-store');
  }
  if (CROSS_ORIGIN_EMBEDDABLE.test(req.path)) {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  }
  next();
}

/**
 * Registers the security headers on an application. main.ts and the e2e
 * test application both call this, so the e2e suite sees the same headers
 * production sends.
 */
export function applySecurityHeaders(app: {
  use: (...handlers: unknown[]) => unknown;
}): void {
  app.use(helmetMiddleware());
  app.use(extraSecurityHeaders);
}
