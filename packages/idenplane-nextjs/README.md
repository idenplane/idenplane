# idenplane-nextjs

Next.js SDK for [Idenplane](https://github.com/idenplane/idenplane) — integrates Idenplane OIDC authentication into Next.js applications with support for the App Router, Pages Router, middleware, and Server Components.

## Installation

```bash
npm install idenplane-nextjs idenplane-sdk jose
```

`jose` is needed by the server-side helpers (`/server`, `/api`, `/session`), which verify tokens against the realm's JWKS.

## How the pieces fit

Sign-in happens in the browser: `AuthProvider` runs the authorization code flow with PKCE and keeps the tokens in the browser. Nothing sends those tokens to your Next.js server on page navigation, so:

- **Your own API routes** (`withAuth`, `withAuthHandler`) read the access token from the `Authorization: Bearer` header. Send it from the browser with `getToken()`.
- **Middleware and Server Components** (`createAuthMiddleware`, `getServerAuth`, `getServerUser`) read it from an HttpOnly cookie, `idenplane_access_token`. Mount the `idenplane-nextjs/session` route handler and call `syncSessionCookie(client)` in the browser: it stores the token in that cookie after sign-in and after every refresh, and clears it on sign-out.

Every server-side helper takes an `audience`: the client ID (or IDs) whose access tokens it accepts. An Idenplane access token's `aud` is the `client_id` of the client that requested it, so this is usually your app's own client ID.

For a design where the browser never holds tokens at all, see the server-session (BFF) mode of the [Next.js quickstart](https://github.com/idenplane/idenplane/tree/dev/examples/nextjs-quickstart).

## Quick Start

### 1. Create the client, sync the cookie, and wrap your app

```tsx
// app/providers.tsx
'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { AuthProvider, IdenplaneClient, syncSessionCookie } from 'idenplane-nextjs';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new IdenplaneClient({
        url: 'http://localhost:3000',
        realm: 'my-realm',
        clientId: 'my-app',
        redirectUri: 'http://localhost:3001/callback',
      }),
  );

  // Keep the HttpOnly session cookie in step with sign-in, refresh and sign-out.
  useEffect(() => syncSessionCookie(client), [client]);

  return <AuthProvider client={client}>{children}</AuthProvider>;
}
```

```tsx
// app/layout.tsx
import { Providers } from './providers';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

### 2. Mount the session cookie route

```typescript
// app/api/auth/session/route.ts
import { createSessionCookieHandlers } from 'idenplane-nextjs/session';

export const { POST, DELETE } = createSessionCookieHandlers({
  serverUrl: 'http://localhost:3000',
  realm: 'my-realm',
  audience: 'my-app',
});
```

`POST` verifies the access token (signature, issuer, audience, expiry, `typ: "Bearer"`) and sets `idenplane_access_token` as `HttpOnly; Secure; SameSite=Lax; Path=/`, expiring with the token. `DELETE` clears it. Both refuse cross-site requests (checked with `Sec-Fetch-Site` and `Origin`), so another site cannot plant its own token in a user's browser. Browsers accept `Secure` cookies from `http://localhost`, so this works in development too. Behind a reverse proxy that changes the Host header, list the public origin in `allowedOrigins`.

Keep access tokens small enough for a cookie (about 4 KB): very large role lists can push a token over the browser limit.

### 3. Use auth state in client components

```tsx
'use client';
import { useAuth } from 'idenplane-nextjs';

export function NavBar() {
  const { isAuthenticated, user, login, logout, isLoading } = useAuth();

  if (isLoading) return <span>Loading...</span>;
  if (!isAuthenticated) return <button onClick={() => login()}>Sign In</button>;
  return (
    <div>
      <span>{user?.name}</span>
      <button onClick={logout}>Sign Out</button>
    </div>
  );
}
```

### 4. Redirect signed-out users with middleware

```typescript
// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createAuthMiddleware } from 'idenplane-nextjs/middleware';

const authMiddleware = createAuthMiddleware({
  serverUrl: 'http://localhost:3000',
  realm: 'my-realm',
  clientId: 'my-app',
  protectedPaths: ['/dashboard'],
  loginPath: '/login',
});

export default function middleware(request: NextRequest) {
  return authMiddleware(request as never, NextResponse as never);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

The middleware runs on the Edge runtime and only checks that the cookie (or an `Authorization` header) holds an unexpired JWT; it does not verify the signature. Use it to redirect signed-out users, not as the security boundary: verify the token where you use it, with `getServerUser` or `withAuthHandler`.

### 5. Server Components

```tsx
// app/dashboard/page.tsx
import { cookies } from 'next/headers';
import { getServerUser } from 'idenplane-nextjs/server';
import { redirect } from 'next/navigation';

export default async function DashboardPage() {
  const user = await getServerUser(await cookies(), {
    serverUrl: 'http://localhost:3000',
    realm: 'my-realm',
    audience: 'my-app',
  });

  if (!user) redirect('/login');

  return <h1>Hello, {user.name}!</h1>;
}
```

`getServerUser` and `getServerAuth` verify the cookie's token before returning any claim, so they can back authorization decisions.

### 6. API Routes (Pages Router)

```typescript
// pages/api/profile.ts
import { withAuth } from 'idenplane-nextjs/api';

export default withAuth(
  { serverUrl: 'http://localhost:3000', realm: 'my-realm', audience: 'my-app' },
  (req, res) => {
    res.json({ user: req.authUser });
  },
);
```

### 6b. Route Handlers (App Router)

```typescript
// app/api/profile/route.ts
import { withAuthHandler } from 'idenplane-nextjs/api';

export const GET = withAuthHandler(
  { serverUrl: 'http://localhost:3000', realm: 'my-realm', audience: 'my-app' },
  (_req, user) => Response.json({ user }),
);
```

Call these with the access token from the browser:

```typescript
const { getToken } = useAuth();
await fetch('/api/profile', { headers: { Authorization: `Bearer ${getToken()}` } });
```

## API Reference

### `idenplane-nextjs` (default export)

Re-exports from `idenplane-sdk/react`:

- `AuthProvider` / `IdenplaneProvider` — context provider
- `useAuth()` — authentication state and actions
- `useUser()` — current user info
- `usePermissions()` — role and permission helpers
- `ProtectedRoute` — render-gate component
- `IdenplaneClient` — raw client class

And:

- `syncSessionCookie(client, { endpoint?, onError? })` — keeps the session cookie in step with the client; returns a function that stops it. `endpoint` defaults to `/api/auth/session`.

### `idenplane-nextjs/session`

- `createSessionCookieHandlers({ serverUrl, realm, audience, cookieName?, secure?, allowedOrigins?, allowInsecureHttp? })` — returns `{ POST, DELETE }` route handlers.

### `idenplane-nextjs/middleware`

- `createAuthMiddleware({ serverUrl, realm, clientId, protectedPaths?, loginPath?, cookieName?, allowInsecureHttp? })` — Edge middleware factory. `loginPath` defaults to `/login`.

### `idenplane-nextjs/server`

- `getServerAuth(cookies, { serverUrl, realm, audience, cookieName?, allowInsecureHttp? })` — returns `AuthSession | null` (`{ accessToken, payload, isAuthenticated }`)
- `getServerUser(cookies, config)` — returns `User | null`

### `idenplane-nextjs/api`

- `withAuth({ serverUrl, realm, audience, requiredRoles?, allowInsecureHttp? }, handler)` — Pages Router API handler wrapper
- `withAuthHandler(config, handler)` — App Router Route Handler wrapper

## Upgrading from 1.x

- `withAuth`, `withAuthHandler`, `getServerAuth` and `getServerUser` require `audience`, and throw a configuration error without it.
- `getServerAuth` and `getServerUser` now verify the cookie's token (they used to decode it without checking the signature), so they need a configuration object and `jose`.
- Tokens are verified with `idenplane-sdk` 2.x, which also refuses ID tokens and other non-access tokens.
- Nothing in 1.x set the `idenplane_access_token` cookie these helpers read. Add the `idenplane-nextjs/session` route and `syncSessionCookie` (steps 1 and 2).
- In Next.js 15 and later, `cookies()` returns a Promise: pass `await cookies()`.

## License

MIT
