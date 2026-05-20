<p align="center">
  <img src="https://authme.dev/logo.svg" alt="AuthMe" width="60" />
</p>

<h2 align="center">authme-sdk</h2>

<p align="center">
  <strong>Official client SDK for <a href="https://authme.dev">AuthMe</a></strong><br />
  <sub>Zero-dependency TypeScript SDK with OAuth 2.0 PKCE, token management, React bindings, and Next.js support.</sub>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.0-blue" alt="v1.0.0" />
  <img src="https://img.shields.io/badge/bundle-~5KB_gzipped-green" alt="bundle size" />
  <img src="https://img.shields.io/badge/TypeScript-first-blue" alt="TypeScript" />
  <img src="https://img.shields.io/badge/React-18%2B-61dafb" alt="React 18+" />
</p>

---

## Install

```bash
npm install authme-sdk
```

---

## Quick Start

### Vanilla JavaScript / TypeScript

```typescript
import { AuthmeClient } from 'authme-sdk';

const authme = new AuthmeClient({
  url: 'http://localhost:3000',
  realm: 'my-realm',
  clientId: 'my-app',
  redirectUri: 'http://localhost:5173/callback',
});

// Initialize (restores existing session if any)
await authme.init();

if (!authme.isAuthenticated()) {
  // Redirects to AuthMe login page
  await authme.login();
}
```

On your callback page:

```typescript
const authme = new AuthmeClient({ /* same config */ });
const success = await authme.handleCallback();
if (success) {
  const user = authme.getUserInfo();
  console.log(`Welcome, ${user?.name}!`);
}
```

### React

```tsx
import { AuthProvider, useAuth, useUser, usePermissions } from 'authme-sdk/react';

function App() {
  return (
    <AuthProvider
      serverUrl="http://localhost:3000"
      realm="my-realm"
      clientId="my-app"
      redirectUri="http://localhost:5173/callback"
      onLogin={(tokens) => console.log('Logged in!')}
      onLogout={() => console.log('Logged out!')}
      onError={(err) => console.error('Auth error:', err)}
    >
      <Main />
    </AuthProvider>
  );
}

function Main() {
  const { isAuthenticated, isLoading, login, logout, getToken } = useAuth();
  const user = useUser();
  const { hasRole, hasPermission, roles } = usePermissions();

  if (isLoading) return <div>Loading...</div>;

  if (!isAuthenticated) {
    return <button onClick={() => login()}>Sign In</button>;
  }

  return (
    <div>
      <p>Welcome, {user?.name}!</p>
      <p>Token: {getToken()}</p>
      {hasRole('admin') && <p>You are an admin.</p>}
      {hasPermission('read:reports') && <p>You can read reports.</p>}
      <p>Your roles: {roles.join(', ')}</p>
      <button onClick={() => logout()}>Sign Out</button>
    </div>
  );
}
```

### AuthProvider with pre-built client

```tsx
import { AuthmeClient } from 'authme-sdk';
import { AuthProvider } from 'authme-sdk/react';

const client = new AuthmeClient({
  url: 'http://localhost:3000',
  realm: 'my-realm',
  clientId: 'my-app',
  redirectUri: 'http://localhost:5173/callback',
  refreshStrategy: 'rotation', // 'rotation' | 'silent' | 'eager'
  storage: 'sessionStorage',   // 'sessionStorage' | 'localStorage' | 'memory'
});

function App() {
  return (
    <AuthProvider client={client}>
      <Main />
    </AuthProvider>
  );
}
```

### ProtectedRoute

```tsx
import { AuthProvider, ProtectedRoute } from 'authme-sdk/react';
import { useNavigate } from 'react-router-dom';

function AdminPage() {
  const navigate = useNavigate();

  return (
    <ProtectedRoute
      roles={['admin']}
      fallback={<div>Loading...</div>}
      onUnauthorized={() => {
        navigate('/login');
        return null;
      }}
      onForbidden={() => <div>Access denied. Admin role required.</div>}
    >
      <AdminDashboard />
    </ProtectedRoute>
  );
}
```

---

## Token Refresh Strategies

Configure how the SDK refreshes tokens via the `refreshStrategy` option:

| Strategy | Description |
|----------|-------------|
| `rotation` | *(default)* Uses refresh token grant to get a new access token |
| `eager` | Like `rotation`, but refreshes proactively at 2× the `refreshBuffer` |
| `silent` | Uses a hidden iframe with `prompt=none` for silent re-auth |

```typescript
const client = new AuthmeClient({
  url: 'http://localhost:3000',
  realm: 'my-realm',
  clientId: 'my-app',
  redirectUri: 'http://localhost:5173/callback',
  refreshStrategy: 'eager',  // refresh 60 seconds before expiry (2× default 30s)
  refreshBuffer: 30,          // seconds before expiry to trigger refresh
  autoRefresh: true,          // enable automatic refresh (default: true)
});
```

For the `silent` strategy, your app's redirect URI page must post a message back to the parent window:

```html
<!-- /callback page for silent refresh -->
<script>
  const params = new URLSearchParams(window.location.search);
  window.parent.postMessage({
    type: 'authme:silent_callback',
    code: params.get('code'),
    state: params.get('state'),
    error: params.get('error'),
  }, window.location.origin);
</script>
```

---

## Event System

Subscribe to SDK events to react to authentication state changes:

```typescript
const client = new AuthmeClient({ ... });

// Subscribe — returns an unsubscribe function
const unsubscribe = client.on('login', (tokens) => {
  console.log('User logged in, token:', tokens.access_token);
});

client.on('logout', () => {
  console.log('User logged out');
});

client.on('tokenRefresh', (tokens) => {
  console.log('Token refreshed silently');
});

client.on('error', (error) => {
  console.error('Auth error:', error.message);
});

client.on('ready', (isAuthenticated) => {
  console.log('Client initialized, authenticated:', isAuthenticated);
});

// Unsubscribe when done
unsubscribe();
// or
client.off('login', myHandler);
```

Alternatively, pass callbacks directly in the config:

```typescript
const client = new AuthmeClient({
  url: 'http://localhost:3000',
  realm: 'my-realm',
  clientId: 'my-app',
  redirectUri: '/callback',
  onLogin: (tokens) => saveSession(tokens),
  onLogout: () => clearSession(),
  onError: (err) => reportError(err),
  onTokenRefresh: (tokens) => updateSession(tokens),
});
```

---

## Next.js Integration

### Server-side authentication in API routes

```typescript
// pages/api/profile.ts  (or app/api/profile/route.ts)
import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSideAuth } from 'authme-sdk/server';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { user, isAuthenticated } = await getServerSideAuth(req, {
    issuerUrl: 'http://localhost:3000',
    realm: 'my-realm',
  });

  if (!isAuthenticated) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  res.json({
    id: user!.sub,
    username: user!.preferred_username,
    email: user!.email,
  });
}
```

### getServerSideProps

```typescript
import { getServerSideAuth } from 'authme-sdk/server';

export const getServerSideProps = async ({ req }) => {
  const { user, isAuthenticated } = await getServerSideAuth(req, {
    issuerUrl: 'http://localhost:3000',
    realm: 'my-realm',
  });

  if (!isAuthenticated) {
    return { redirect: { destination: '/login', permanent: false } };
  }

  return {
    props: {
      user: { sub: user!.sub, name: user!.name, email: user!.email },
    },
  };
};
```

### Next.js Middleware

```typescript
// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createNextMiddleware } from 'authme-sdk/server';

const authMiddleware = createNextMiddleware({
  issuerUrl: 'http://localhost:3000',
  realm: 'my-realm',
  protectedPaths: ['/dashboard', '/api/protected'],
  loginPath: '/login',
  forbiddenPath: '/403',
});

export async function middleware(request: NextRequest) {
  const result = await authMiddleware(request as any);

  if (result?.redirect) {
    return NextResponse.redirect(new URL(result.redirect, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next|public|favicon.ico).*)'],
};
```

---

## SSR Compatibility

The SDK is fully SSR-safe. When `window` is undefined (e.g., in Node.js / Next.js):
- Storage automatically falls back to `MemoryStorage`
- `login()` and `logout()` browser redirects throw a safe error
- `init()` and token operations work without errors

```typescript
// This works safely in both browser and SSR environments
const client = new AuthmeClient({
  url: 'http://localhost:3000',
  realm: 'my-realm',
  clientId: 'my-app',
  redirectUri: '/callback',
  storage: 'memory', // explicit for SSR, or falls back automatically
});
```

---

## API Reference

### `AuthmeClient`

#### Constructor

```typescript
new AuthmeClient(config: AuthmeConfig)
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `url` | `string` | *required* | AuthMe server URL |
| `realm` | `string` | *required* | Realm name |
| `clientId` | `string` | *required* | OAuth2 client ID (PUBLIC client) |
| `redirectUri` | `string` | *required* | Callback URL after login |
| `scopes` | `string[]` | `['openid', 'profile', 'email']` | OAuth2 scopes to request |
| `storage` | `'sessionStorage' \| 'localStorage' \| 'memory'` | `'sessionStorage'` | Where to persist tokens |
| `autoRefresh` | `boolean` | `true` | Automatically refresh tokens before expiry |
| `refreshBuffer` | `number` | `30` | Seconds before expiry to trigger refresh |
| `refreshStrategy` | `'rotation' \| 'silent' \| 'eager'` | `'rotation'` | Token refresh strategy |
| `postLogoutRedirectUri` | `string` | — | URL to redirect after logout |
| `onLogin` | `(tokens: TokenResponse) => void` | — | Called on successful login |
| `onLogout` | `() => void` | — | Called on logout |
| `onError` | `(error: Error) => void` | — | Called on error |
| `onTokenRefresh` | `(tokens: TokenResponse) => void` | — | Called on token refresh |

#### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `init()` | `Promise<boolean>` | Initialize client, restore session. Returns `true` if authenticated |
| `login(options?)` | `Promise<void>` | Redirect to AuthMe login page |
| `handleCallback(url?)` | `Promise<boolean>` | Exchange authorization code for tokens |
| `logout()` | `Promise<void>` | Clear tokens and call server logout endpoint |
| `getAccessToken()` | `string \| null` | Current access token (null if expired) |
| `getTokenClaims()` | `TokenClaims \| null` | Parsed access token JWT payload |
| `getIdTokenClaims()` | `TokenClaims \| null` | Parsed ID token JWT payload |
| `isAuthenticated()` | `boolean` | Whether user has a valid, non-expired access token |
| `fetchUserInfo()` | `Promise<UserInfo \| null>` | Fetch user info from the server UserInfo endpoint |
| `getUserInfo()` | `UserInfo \| null` | Cached user info (from ID token or last fetch) |
| `hasRealmRole(role)` | `boolean` | Check if user has a realm-level role |
| `hasClientRole(clientId, role)` | `boolean` | Check if user has a client-level role |
| `hasPermission(permission)` | `boolean` | Check realm or default client role |
| `getRealmRoles()` | `string[]` | All realm roles for the current user |
| `getClientRoles(clientId)` | `string[]` | All client roles for a specific client |
| `refreshTokens()` | `Promise<TokenResponse>` | Manually trigger a token refresh |
| `on(event, handler)` | `() => void` | Subscribe to SDK events — returns unsubscribe function |
| `off(event, handler)` | `void` | Unsubscribe from SDK events |

#### Events

| Event | Payload | Fires When |
|-------|---------|------------|
| `login` | `TokenResponse` | After successful login or callback |
| `logout` | — | After logout completes |
| `tokenRefresh` | `TokenResponse` | After a silent token refresh |
| `error` | `Error` | On any authentication error |
| `ready` | `boolean` | After `init()` completes (`true` if authenticated) |

---

### React

Import from `authme-sdk/react`.

#### `<AuthProvider>`

| Prop | Type | Description |
|------|------|-------------|
| `client` | `AuthmeClient` | Pre-built client (mutually exclusive with inline config props) |
| `serverUrl` | `string` | AuthMe server URL (alternative to `client`) |
| `realm` | `string` | Realm name (alternative to `client`) |
| `clientId` | `string` | OAuth2 client ID (alternative to `client`) |
| `redirectUri` | `string` | Redirect URI (alternative to `client`) |
| `scope` | `string[]` | OAuth2 scopes |
| `autoHandleCallback` | `boolean` | Auto-handle `/callback` redirect (default: `true`) |
| `onReady` | `(authenticated: boolean) => void` | Called when initialization is complete |
| `onLogin` | `(tokens: TokenResponse) => void` | Called on login |
| `onLogout` | `() => void` | Called on logout |
| `onError` | `(error: Error) => void` | Called on error |
| `onTokenRefresh` | `(tokens: TokenResponse) => void` | Called on token refresh |

#### `useAuth()`

```typescript
const { isAuthenticated, isLoading, login, logout, getToken, user, client } = useAuth();
```

| Property | Type | Description |
|----------|------|-------------|
| `isAuthenticated` | `boolean` | Whether the user is logged in |
| `isLoading` | `boolean` | `true` during initialization |
| `login` | `(options?) => Promise<void>` | Trigger login redirect |
| `logout` | `() => Promise<void>` | Trigger logout |
| `getToken` | `() => string \| null` | Get current access token |
| `user` | `UserInfo \| null` | Current user profile |
| `client` | `AuthmeClient` | Underlying SDK client instance |

#### `useUser()`

```typescript
const user = useUser();
// user?.sub, user?.name, user?.email, user?.preferred_username, etc.
```

Returns the current user's profile information, or `null` if not authenticated.

#### `usePermissions()`

```typescript
const { hasRole, hasPermission, roles } = usePermissions();

hasRole('admin');               // boolean — check realm role
hasPermission('read:reports');  // boolean — check realm or client role
roles;                          // string[] — all realm roles
```

#### `<ProtectedRoute>`

| Prop | Type | Description |
|------|------|-------------|
| `roles` | `string[]` | Required realm roles (optional) |
| `fallback` | `ReactNode` | Shown while loading |
| `onUnauthorized` | `() => ReactNode \| null` | Called when not authenticated |
| `onForbidden` | `() => ReactNode \| null` | Called when lacking required roles |

---

### Server (`authme-sdk/server`)

#### `verifyToken(token, config)`

Verifies a JWT access token using the server's JWKS endpoint.

```typescript
const payload = await verifyToken(accessToken, {
  issuerUrl: 'http://localhost:3000',
  realm: 'my-realm',
});
```

#### `getServerSideAuth(req, config)`

Helper for Next.js API routes and `getServerSideProps`.

#### `createNextMiddleware(config)`

Factory for Next.js middleware with route protection.

#### `createAuthmeMiddleware(config)`

Express middleware for token validation.

#### `createAuthmeGuard(config)`

NestJS guard factory for token validation.

---

## Backend Integration

### Express

```typescript
import express from 'express';
import { createAuthmeMiddleware } from 'authme-sdk/server';

const app = express();
const authme = createAuthmeMiddleware({
  issuerUrl: 'http://localhost:3000',
  realm: 'my-realm',
  requiredRoles: ['user'],  // optional
});

app.get('/api/profile', authme, (req: any, res) => {
  res.json(req.user); // AuthmeTokenPayload
});
```

### NestJS

```typescript
import { createAuthmeGuard } from 'authme-sdk/server';

const AuthmeGuard = createAuthmeGuard({
  issuerUrl: 'http://localhost:3000',
  realm: 'my-realm',
});

@Controller('api')
export class AppController {
  @Get('profile')
  @UseGuards(AuthmeGuard)
  getProfile(@Req() req) {
    return req.user;
  }
}
```

---

## Attaching Tokens to API Requests

```typescript
// With fetch
const res = await fetch('/api/profile', {
  headers: {
    Authorization: `Bearer ${authme.getAccessToken()}`,
  },
});

// With axios interceptor
api.interceptors.request.use((config) => {
  const token = authme.getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
```

---

## Full SPA Callback Flow (React Router)

```tsx
// main.tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider, ProtectedRoute } from 'authme-sdk/react';

function App() {
  return (
    <AuthProvider
      serverUrl="http://localhost:3000"
      realm="my-realm"
      clientId="my-app"
      redirectUri="http://localhost:5173/callback"
    >
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute
                onUnauthorized={() => { window.location.href = '/login'; return null; }}
              >
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route path="/login" element={<Login />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
```

---

## Error Handling

```typescript
authme.on('error', (error) => {
  console.error('Auth error:', error.message);

  // Common errors:
  // - "No refresh token available" — user needs to re-login
  // - "State mismatch — possible CSRF attack"
  // - "Missing PKCE verifier"
  // - "token_exchange_failed" — authorization code invalid or expired
});
```

---

## AuthMe Client Setup

For the SDK to work, register a **PUBLIC** client in AuthMe:

1. Open the AuthMe Admin Console at `/console`
2. Navigate to your realm > **Clients** > **Create**
3. Set **Client Type** to `PUBLIC`
4. Add your app's URL to **Redirect URIs** (e.g., `http://localhost:5173/callback`)
5. Add your app's origin to **Web Origins** (e.g., `http://localhost:5173`)
6. Enable the `authorization_code` and `refresh_token` grant types

---

## License

MIT

---

<p align="center">
  Part of <a href="https://authme.dev">AuthMe</a> — Open-source Identity & Access Management
</p>
