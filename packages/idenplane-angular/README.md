# idenplane-angular

Angular SDK for [Idenplane](https://github.com/idenplane/idenplane) — an injectable `AuthService`, a route guard, an HTTP interceptor, and an `NgModule` entry point.

## Installation

```bash
npm install idenplane-angular idenplane-sdk rxjs
```

## Quick Start

### 1. Import `IdenplaneModule.forRoot()`

```typescript
// app.module.ts
import { NgModule } from '@angular/core';
import { HttpClientModule } from '@angular/common/http';
import { IdenplaneModule } from 'idenplane-angular';

@NgModule({
  imports: [
    HttpClientModule,
    IdenplaneModule.forRoot({
      url: 'http://localhost:3000',
      realm: 'my-realm',
      clientId: 'my-app',
      redirectUri: 'http://localhost:4200/callback',
      // Origins of your own APIs that should receive the access token.
      bearerTokenOrigins: ['https://api.example.com'],
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

The HTTP interceptor is registered automatically when you use `IdenplaneModule.forRoot()`.

It adds `Authorization: Bearer <access token>` **only** to requests for:

- the Idenplane server (the origin of `url`), and
- the origins you list in `bearerTokenOrigins`.

Requests to any other origin go out without the token, and a `401` from them
does not trigger a token refresh. Origins are compared exactly, by scheme,
host and port: `https://api.example.com` does not match
`http://api.example.com`, `https://api.example.com:8443`,
`https://sub.api.example.com` or `https://api.example.com.evil.com`.
Entries must be bare origins (no path, query, credentials or `*`); an invalid
entry throws when `AuthService` is created.

Relative URLs such as `/api/orders` resolve to the origin the app is served
from, so to send the token to a same-origin API, list that origin:

```typescript
IdenplaneModule.forRoot({
  url: 'https://auth.example.com',
  realm: 'my-realm',
  clientId: 'my-app',
  redirectUri: 'https://app.example.com/callback',
  bearerTokenOrigins: [
    'https://api.example.com',   // a separate API
    window.location.origin,       // same-origin calls like /api/orders
  ],
});
```

> **Upgrading from 1.x:** before 2.0.0 the interceptor sent the token to
> every URL the app requested, including third-party hosts. If your app calls
> its own API on any origin other than the Idenplane server, add that origin to
> `bearerTokenOrigins`, or those requests will now be sent without a token.

For standalone / functional interceptor style (Angular 15+), provide the configuration with `IDENPLANE_CONFIG`; the same origin rules apply:

```typescript
// app.config.ts
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { authInterceptor, IDENPLANE_CONFIG } from 'idenplane-angular';

export const appConfig = {
  providers: [
    {
      provide: IDENPLANE_CONFIG,
      useValue: {
        url: 'https://auth.example.com',
        realm: 'my-realm',
        clientId: 'my-app',
        redirectUri: 'https://app.example.com/callback',
        bearerTokenOrigins: ['https://api.example.com'],
      },
    },
    provideHttpClient(withInterceptors([authInterceptor])),
  ],
};
```

## API Reference

### `IdenplaneModule`

- `IdenplaneModule.forRoot(config: IdenplaneConfig)` — registers all providers. `IdenplaneConfig` is the `idenplane-sdk` client configuration plus `bearerTokenOrigins?: string[]`.

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

Class-based HTTP interceptor. Adds `Authorization: Bearer <token>` to requests for the Idenplane server and `bearerTokenOrigins` only; on a `401` from those origins it refreshes the tokens and retries once.

### `authInterceptor`

Functional interceptor for use with `withInterceptors([authInterceptor])`. Same origin rules.

### `shouldAttachToken(url, origins, baseUrl?)`, `resolveBearerTokenOrigins(config)`, `normalizeOrigin(origin)`

The matching helpers the interceptors use, exported for custom interceptors (for example `fetch` wrappers or WebSocket clients) that need the same rule.

## License

MIT
