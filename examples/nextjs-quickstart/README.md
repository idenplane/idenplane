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

Use Node.js 24 or later. If you already have an Idenplane server running elsewhere:

1. Copy `.env.example` to `.env.local` and point it at your server/realm/client (create the client yourself — `publicClient: true`, `redirectUris: ["http://localhost:3001/callback"]`, `postLogoutRedirectUris: ["http://localhost:3001"]`).
2. `npm install`
3. `npm run dev`

## Server-authorized profile API

On `/dashboard`, choose **Load my profile** to call `GET /api/users/{userId}/profile` with an access token. The endpoint verifies RS256 signatures against configured JWKS, the exact issuer, audience, authorized client, required time/subject claims, and the Bearer token type. It requires `profile` scope and permits only the subject's own ID; a valid token for another user receives 403. ID tokens, identity headers, and cookies are not accepted as bearer authentication. Responses are private and `no-store`.

`lib/server-profile.ts` contains the authorization policy; `app/dashboard/layout.tsx` adds the panel without relying on the page guard for API protection. This example returns selected signed identity claims, not database records. For a real database resource, put the verified subject in the database ownership condition too. Email is returned only with `email` scope.

Run the real-signature regression locally (Node 24+):

```sh
node --experimental-strip-types --test tests/server-profile.test.mjs
```

The existing example CI job runs this command before building. Docker supplies `IDENPLANE_INTERNAL_URL=http://idenplane:3000` only to the server so it can fetch public keys over the private service network. The token issuer still uses the public browser URL. Only trusted deployment configuration selects the issuer, audience, and key endpoint. Use HTTPS for production connections; do not expose the local demo's fixed credentials.

JWT verification is stateless: a previously issued access token can remain valid until expiry even after logout. Logout ends SSO and revokes refresh tokens; immediate access-token revocation requires a separate introspection or server-session design. This example does not implement that production session layer.

## Server-session mode (BFF)

Open `/server-session` for the separate server-managed example. Access and refresh tokens stay in an encrypted PostgreSQL session record; the browser gets an opaque HttpOnly cookie. This mode skips the browser SDK provider entirely. `/api/session/profile` requires the live cookie-backed database session and does not accept a bearer token as a substitute. `/api/session/users/{userId}/profile` also enforces ownership. The original browser SDK mode and stateless bearer endpoint remain separate demonstrations.

### Local Docker demonstration

Run these commands from this example directory with Node 24+ and Docker running:

```sh
docker compose up -d db idenplane
docker compose run --rm seed
node --experimental-strip-types scripts/setup-server-session.mjs --local-demo
docker compose --env-file .env.server-session -f docker-compose.yml -f compose.server-session.yml up -d --build
```

The helper registers a confidential `nextjs-session` client and writes unique database credentials and an encryption key to private `.env.server-session`. It refuses overwrite and never automatically rotates an existing client secret. Preserve this file and back up the key with the session database. The overlay uses a separate persistent session database; do not remove its volume unless you intend to invalidate stored sessions. The fixed backend credentials in the base Compose file are still for local throwaway use only.

For an existing deployment, configure server-only `SESSION_APP_ORIGIN`, `SESSION_DATABASE_URL`, `SESSION_ENCRYPTION_KEY` (64 hex characters), `SESSION_CLIENT_ID`, and `SESSION_CLIENT_SECRET`. Register the exact `{origin}/api/session/callback` and `{origin}/server-session` post-logout URI. Apply `session-schema.sql` to the dedicated session database before starting the app. Every replica must share the database and stable key. `IDENPLANE_INTERNAL_URL` selects a trusted server-side route to the same provider; the public issuer stays unchanged.

### Security and deployment scope

Production cookies use `__Host-` names, Secure, HttpOnly, SameSite=Lax and Path=/ without Domain. Plain HTTP is refused unless `SESSION_ALLOW_INSECURE_LOCALHOST=true` explicitly enables a loopback application origin for development. State-changing requests require same-origin POST. Callback state/PKCE/nonce are one-time and server-stored. Absolute session lifetime is eight hours and idle lifetime thirty minutes. Refresh is serialized with a PostgreSQL row lock, including across replicas; transient provider failures return 503 and keep the session for retry, while rejected credentials revoke it. A successful local logout deletes the row before contacting the provider, so a copied cookie cannot be used afterward. Failed database revocation returns 503 instead of claiming success.

Provider logout is best effort after local revocation. Its standard front-channel redirect carries an ID-token hint; access and refresh credentials are never put in that URL. The original stateless bearer API is not changed into a revocable session endpoint. Disabling users or changing privileges in the provider also needs an explicit refresh/backchannel policy; this example does not claim immediate synchronization of every external account change.

Before public deployment, verify real HTTPS domains, proxy/cookie and cross-site SSO behavior, database TLS and least-privilege roles, stable key/backup management, expired-session cleanup scheduling, and dependency advisories. Do not expose the local demo stack or its browser-token demonstration as a production deployment recipe.

Run all profile and session policy/service/bootstrap regressions:

```sh
node --experimental-strip-types --test tests/*.test.mjs
```

## Notes

- `app/auth-provider.tsx` explicitly uses `sessionStorage` so PKCE state survives login redirects and authentication survives reloads in the same tab. Browser scripts can read this storage, including tokens; use strong XSS protections. This demo opt-in does not change the SDK's default memory storage. For production, evaluate server-managed sessions with HttpOnly cookies and authorize every protected server endpoint.

- The demo realm's admin API key and webhook secrets in `docker-compose.yml` are fixed, low-entropy values for local/throwaway use only — never reuse them for anything reachable outside your machine.
- `ProtectedRoute` controls dashboard presentation; the profile API independently verifies authentication and ownership on the server. Never use client-side visibility as authorization for a data endpoint.
