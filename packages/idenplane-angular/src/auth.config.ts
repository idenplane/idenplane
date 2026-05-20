/**
 * Configuration token and types for the Angular AuthMe SDK.
 */

import { InjectionToken } from '@angular/core';
import type { AuthmeConfig } from 'authme-sdk';

/** Re-export so consumers only need to import from @authme/angular */
export type { AuthmeConfig };

/**
 * Angular DI token for the AuthMe configuration object.
 * Provided via `AuthmeModule.forRoot(config)`.
 */
export const AUTHME_CONFIG = new InjectionToken<AuthmeConfig>('AUTHME_CONFIG');
