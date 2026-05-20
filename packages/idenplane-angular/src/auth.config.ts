/**
 * Configuration token and types for the Angular Idenplane SDK.
 */

import { InjectionToken } from '@angular/core';
import type { IdenplaneConfig } from 'idenplane-sdk';

/** Re-export so consumers only need to import from @idenplane/angular */
export type { IdenplaneConfig };

/**
 * Angular DI token for the Idenplane configuration object.
 * Provided via `IdenplaneModule.forRoot(config)`.
 */
export const IDENPLANE_CONFIG = new InjectionToken<IdenplaneConfig>('IDENPLANE_CONFIG');
