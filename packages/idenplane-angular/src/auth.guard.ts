/**
 * Angular route guard for AuthMe.
 *
 * @example
 * ```typescript
 * // app.routes.ts
 * import { AuthGuard } from '@authme/angular';
 *
 * export const routes: Routes = [
 *   { path: 'dashboard', component: DashboardComponent, canActivate: [AuthGuard] },
 *   {
 *     path: 'admin',
 *     component: AdminComponent,
 *     canActivate: [AuthGuard],
 *     data: { roles: ['admin'] },
 *   },
 * ];
 * ```
 */

import { Injectable } from '@angular/core';
import type {
  CanActivate,
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
  UrlTree,
} from '@angular/router';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { filter, take } from 'rxjs/operators';
import { AuthService } from './auth.service.js';

/** Extended route data fields recognised by AuthGuard. */
export interface AuthRouteData {
  /** Realm roles the user must have ALL of to access this route. */
  roles?: string[];
  /** Override the default login redirect path for this route. */
  loginPath?: string;
}

@Injectable({ providedIn: 'root' })
export class AuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly router: Router,
  ) {}

  async canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot,
  ): Promise<boolean | UrlTree> {
    // Wait for auth initialization to complete
    await firstValueFrom(
      this.auth.isLoading$.pipe(
        filter((loading) => !loading),
        take(1),
      ),
    );

    if (!this.auth.isAuthenticated) {
      const loginPath = (route.data as AuthRouteData)?.loginPath ?? '/login';
      return this.router.createUrlTree([loginPath], {
        queryParams: { next: state.url },
      });
    }

    // Role check
    const requiredRoles = (route.data as AuthRouteData)?.roles ?? [];
    if (requiredRoles.length > 0) {
      const hasAll = requiredRoles.every((role) => this.auth.hasRole(role));
      if (!hasAll) {
        const loginPath = (route.data as AuthRouteData)?.loginPath ?? '/login';
        return this.router.createUrlTree([loginPath], {
          queryParams: { error: 'forbidden' },
        });
      }
    }

    return true;
  }
}
