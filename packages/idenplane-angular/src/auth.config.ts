/**
 * Configuration token and types for the Angular Idenplane SDK.
 */

import { InjectionToken } from '@angular/core';
import type { IdenplaneConfig as CoreIdenplaneConfig } from 'idenplane-sdk';

/**
 * Configuration of the Angular SDK: the `idenplane-sdk` client configuration
 * plus the origins the HTTP interceptor may send the access token to.
 */
export interface IdenplaneConfig extends CoreIdenplaneConfig {
  /**
   * Origins, besides the Idenplane server (`url`), that the HTTP interceptor
   * attaches `Authorization: Bearer <access token>` to — typically your own
   * API, for example `['https://api.example.com']`.
   *
   * Each entry is an origin: scheme, host and optional port, nothing else.
   * Matching is exact: `https://api.example.com` does not match
   * `http://api.example.com`, `https://api.example.com:8443` or
   * `https://api.example.com.evil.com`. Relative request URLs (`/api/...`)
   * resolve to the app's own origin, so list `window.location.origin` (or
   * the origin it is served from) to keep sending the token to same-origin
   * APIs.
   *
   * Default: none, so the token is sent to the Idenplane server only.
   */
  bearerTokenOrigins?: string[];
}

/**
 * Angular DI token for the Idenplane configuration object.
 * Provided via `IdenplaneModule.forRoot(config)`.
 */
export const IDENPLANE_CONFIG = new InjectionToken<IdenplaneConfig>('IDENPLANE_CONFIG');
