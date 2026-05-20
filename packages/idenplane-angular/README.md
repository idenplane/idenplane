# idenplane-angular

Angular SDK for [Idenplane](https://github.com/Islamawad132/Authme) — an injectable `AuthService`, a route guard, an HTTP interceptor, and an `NgModule` entry point.

## Installation

```bash
npm install idenplane-angular idenplane-sdk rxjs
```

## Quick Start

### 1. Import `AuthmeModule.forRoot()`

```typescript
// app.module.ts
import { NgModule } from '@angular/core';
import { HttpClientModule } from '@angular/common/http';
import { AuthmeModule } from 'idenplane-angular';

@NgModule({
  imports: [
    HttpClientModule,
    AuthmeModule.forRoot({
      url: 'http://localhost:3000',
      realm: 'my-realm',
      clientId: 'my-app',
      redirectUri: 'http://localhost:4200/callback',
    }),
  ],
  bootstrap: [AppComponent],
})
export class AppModule {}
```

### 2. Inject `AuthService`

```typescript
import { Component } from '@angular/core';
import { AuthService } from 'idenplane-angular';

@Component({
  selector: 'app-nav',
  template: `
    <ng-container *ngIf="auth.isLoading$ | async; else content">
      <span>Loading...</span>
    </ng-container>
    <ng-template #content>
      <button *ngIf="!(auth.isAuthenticated$ | async)" (click)="auth.login()">
        Sign In
      </button>
      <div *ngIf="auth.isAuthenticated$ | async">
        <span>{{ (auth.user$ | async)?.name }}</span>
        <button (click)="auth.logout()">Sign Out</button>
      </div>
    </ng-template>
  `,
})
export class NavComponent {
  constructor(public auth: AuthService) {}
}
```

### 3. Protect routes with `AuthGuard`

```typescript
// app.routes.ts
import { Routes } from '@angular/router';
import { AuthGuard } from 'idenplane-angular';

export const routes: Routes = [
  { path: '', component: HomeComponent },
  {
    path: 'dashboard',
    component: DashboardComponent,
    canActivate: [AuthGuard],
  },
  {
    path: 'admin',
    component: AdminComponent,
    canActivate: [AuthGuard],
    data: { roles: ['admin'] },
  },
];
```

### 4. Automatically attach Bearer tokens (HTTP interceptor)

The HTTP interceptor is registered automatically when you use `AuthmeModule.forRoot()`.

For standalone / functional interceptor style (Angular 15+):

```typescript
// app.config.ts
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { authInterceptor } from 'idenplane-angular';

export const appConfig = {
  providers: [
    provideHttpClient(withInterceptors([authInterceptor])),
  ],
};
```

## API Reference

### `AuthmeModule`

- `AuthmeModule.forRoot(config: AuthmeConfig)` — registers all providers

### `AuthService`

| Member | Type | Description |
|--------|------|-------------|
| `isAuthenticated$` | `Observable<boolean>` | Reactive auth state |
| `isLoading$` | `Observable<boolean>` | True while initializing |
| `user$` | `Observable<UserInfo \| null>` | Current user |
| `isAuthenticated` | `boolean` | Synchronous getter |
| `user` | `UserInfo \| null` | Synchronous getter |
| `login(opts?)` | `Promise<void>` | Redirect to login |
| `logout()` | `Promise<void>` | Log out |
| `getToken()` | `string \| null` | Current access token |
| `hasRole(role)` | `boolean` | Realm role check |
| `hasPermission(perm)` | `boolean` | Permission check |
| `getRoles()` | `string[]` | All realm roles |

### `AuthGuard`

Route guard implementing `CanActivate`. Reads `route.data.roles` and `route.data.loginPath`.

### `AuthInterceptor`

Class-based HTTP interceptor. Adds `Authorization: Bearer <token>` to requests.

### `authInterceptor`

Functional interceptor for use with `withInterceptors([authInterceptor])`.

## License

MIT
