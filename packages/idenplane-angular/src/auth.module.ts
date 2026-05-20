/**
 * AuthmeModule — NgModule entry point for the Angular SDK.
 *
 * @example
 * ```typescript
 * // app.module.ts
 * import { NgModule } from '@angular/core';
 * import { BrowserModule } from '@angular/platform-browser';
 * import { HttpClientModule } from '@angular/common/http';
 * import { AuthmeModule } from '@authme/angular';
 *
 * @NgModule({
 *   imports: [
 *     BrowserModule,
 *     HttpClientModule,
 *     AuthmeModule.forRoot({
 *       url: 'http://localhost:3000',
 *       realm: 'my-realm',
 *       clientId: 'my-app',
 *       redirectUri: 'http://localhost:4200/callback',
 *     }),
 *   ],
 *   bootstrap: [AppComponent],
 * })
 * export class AppModule {}
 * ```
 */

import { NgModule } from '@angular/core';
import type { ModuleWithProviders } from '@angular/core';
import { HTTP_INTERCEPTORS } from '@angular/common/http';
import type { AuthmeConfig } from 'authme-sdk';
import { AUTHME_CONFIG } from './auth.config.js';
import { AuthService } from './auth.service.js';
import { AuthGuard } from './auth.guard.js';
import { AuthInterceptor } from './auth.interceptor.js';

@NgModule({})
export class AuthmeModule {
  /**
   * Call `forRoot` in the root `AppModule` with your AuthMe configuration.
   * This registers `AuthService`, `AuthGuard`, and `AuthInterceptor` as
   * module-level providers.
   */
  static forRoot(config: AuthmeConfig): ModuleWithProviders<AuthmeModule> {
    return {
      ngModule: AuthmeModule,
      providers: [
        { provide: AUTHME_CONFIG, useValue: config },
        AuthService,
        AuthGuard,
        {
          provide: HTTP_INTERCEPTORS,
          useClass: AuthInterceptor,
          multi: true,
        },
      ],
    };
  }
}
