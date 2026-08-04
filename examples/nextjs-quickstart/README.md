# Idenplane + Next.js Quickstart

A minimal, working Next.js (App Router) app demonstrating login, a protected route, a user profile display, and logout against a real Idenplane server — runnable end-to-end with a single `docker compose up`.

## Run it

1. `docker compose up --build`
2. Wait for the `web` service to log `Ready` (the `idenplane` and `seed` services start first and seed a demo realm/client/user automatically).
3. Open [http://localhost:3001](http://localhost:3001).
4. Sign in with username `demo`, password `Demo1234!`.

That's it — no manual realm setup, no `.env` editing required for the Docker path.

## What's running

| Service | Purpose |
|---|---|
| `db` | Postgres for the Idenplane server |
| `idenplane` | The Idenplane server itself (`islamawad/idenplane:latest`), on `:3000` |
| `seed` | One-shot job that creates the `quickstart` realm, an `nextjs-quickstart` OIDC client, and a `demo` user, then exits |
| `web` | This Next.js app, on `:3001` |

## What it demonstrates

- **`app/layout.tsx`** — wraps the app in `AuthProvider` from `idenplane-nextjs`, configured from `NEXT_PUBLIC_IDENPLANE_*` environment variables.
- **`app/page.tsx`** — `useAuth()` for sign-in/sign-out and reading auth state.
- **`app/callback/page.tsx`** — the OAuth redirect target; `AuthProvider` auto-detects the `?code=` parameter and exchanges it for tokens, this page just waits for that and routes to `/dashboard`.
- **`app/dashboard/page.tsx`** — a protected route using the `ProtectedRoute` component, rendering the signed-in user's profile (username, name, email, subject).

## Running without Docker

If you already have an Idenplane server running elsewhere:

1. Copy `.env.example` to `.env.local` and point it at your server/realm/client (create the client yourself — `publicClient: true`, `redirectUris: ["http://localhost:3001/callback"]`).
2. `npm install`
3. `npm run dev`

## Notes

- The demo realm's admin API key and webhook secrets in `docker-compose.yml` are fixed, low-entropy values for local/throwaway use only — never reuse them for anything reachable outside your machine.
- This template intentionally protects its one route with the client-side `ProtectedRoute` component rather than Next.js Edge middleware, to keep the example to the minimum needed to demonstrate the pattern. See the [idenplane-nextjs README](https://github.com/idenplane/idenplane/tree/dev/packages/idenplane-nextjs) for the middleware-based approach, Server Components, and API route protection.
