/**
 * Configuration token and types for the Angular Idenplane SDK.
 */

import { InjectionToken } from '@angular/core';
import type { AuthmeConfig } from 'idenplane-sdk';

/** Re-export so consumers only need to import from @idenplane/angular */
export type { AuthmeConfig };

/**
 * Angular DI token for the Idenplane configuration object.
 * Provided via `AuthmeModule.forRoot(config)`.
 */
export const IDENPLANE_CONFIG = new InjectionToken<AuthmeConfig>('IDENPLANE_CONFIG');
