# authme-nextjs

Next.js SDK for [AuthMe](https://github.com/Islamawad132/Authme) — integrates AuthMe OIDC authentication into Next.js applications with support for the App Router, Pages Router, middleware, and Server Components.

## Installation

```bash
npm install authme-nextjs authme-sdk
```

## Quick Start

### 1. Wrap your app with `AuthProvider`

```tsx
// app/layout.tsx
'use client';
import { AuthProvider } from 'authme-nextjs';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        <AuthProvider
          serverUrl="http://localhost:3000"
          realm="my-realm"
          clientId="my-app"
          redirectUri="http://localhost:3001/callback"
        >
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
```

### 2. Use auth state in client components

```tsx
'use client';
import { useAuth } from 'authme-nextjs';

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

### 3. Protect routes with middleware

```typescript
// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createAuthMiddleware } from 'authme-nextjs/middleware';

const authMiddleware = createAuthMiddleware({
  serverUrl: 'http://localhost:3000',
  realm: 'my-realm',
  clientId: 'my-app',
  protectedPaths: ['/dashboard', '/api/protected'],
  loginPath: '/login',
});

export default function middleware(request: NextRequest) {
  return authMiddleware(request as never, NextResponse as never);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

### 4. Server Components

```tsx
// app/dashboard/page.tsx
import { cookies } from 'next/headers';
import { getServerUser } from 'authme-nextjs/server';
import { redirect } from 'next/navigation';

export default async function DashboardPage() {
  const cookieStore = cookies();
  const user = await getServerUser(cookieStore, {
    serverUrl: 'http://localhost:3000',
    realm: 'my-realm',
  });

  if (!user) redirect('/login');

  return <h1>Hello, {user.name}!</h1>;
}
```

### 5. API Routes (Pages Router)

```typescript
// pages/api/profile.ts
import { withAuth } from 'authme-nextjs/api';

export default withAuth(
  { serverUrl: 'http://localhost:3000', realm: 'my-realm' },
  (req, res) => {
    res.json({ user: req.authUser });
  },
);
```

### 5b. Route Handlers (App Router)

```typescript
// app/api/profile/route.ts
import { withAuthHandler } from 'authme-nextjs/api';

export const GET = withAuthHandler(
  { serverUrl: 'http://localhost:3000', realm: 'my-realm' },
  (_req, user) => Response.json({ user }),
);
```

## API Reference

### `authme-nextjs` (default export)

Re-exports from `authme-sdk/react`:

- `AuthProvider` / `AuthmeProvider` — context provider
- `useAuth()` — authentication state and actions
- `useUser()` — current user info
- `usePermissions()` — role and permission helpers
- `ProtectedRoute` — render-gate component
- `AuthmeClient` — raw client class

### `authme-nextjs/middleware`

- `createAuthMiddleware(config)` — Next.js Edge middleware factory

### `authme-nextjs/server`

- `getServerAuth(cookies, config?)` — returns `AuthSession | null`
- `getServerUser(cookies, config?)` — returns `User | null`

### `authme-nextjs/api`

- `withAuth(config, handler)` — Pages Router API handler wrapper
- `withAuthHandler(config, handler)` — App Router Route Handler wrapper

## License

MIT
