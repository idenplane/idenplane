<p align="center">
  <a href="https://idenplane.com">
    <img src="branding/logos/png/social-preview.png" alt="Idenplane — The identity control plane you own." width="100%" />
  </a>
</p>

<p align="center">
  <strong>Open-Source Identity & Access Management</strong><br />
  <sub>Self-hosted authentication server with OAuth 2.0, OpenID Connect, SAML 2.0, WebAuthn, and more.</sub>
</p>

<p align="center">
  <a href="https://idenplane.com">Website</a> &middot;
  <a href="#features">Features</a> &middot;
  <a href="#quick-start">Quick Start</a> &middot;
  <a href="#client-sdks">SDKs</a> &middot;
  <a href="#cli">CLI</a> &middot;
  <a href="#architecture">Architecture</a> &middot;
  <a href="#api-documentation">API Docs</a>
</p>

<p align="center">
  <a href="https://github.com/idenplane/idenplane/actions"><img src="https://github.com/idenplane/idenplane/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://scorecard.dev/viewer/?uri=github.com/idenplane/idenplane"><img src="https://api.scorecard.dev/projects/github.com/idenplane/idenplane/badge" alt="OpenSSF Scorecard" /></a>
  <a href="https://www.npmjs.com/package/idenplane-sdk"><img src="https://img.shields.io/npm/v/idenplane-sdk?label=idenplane-sdk" alt="npm idenplane-sdk" /></a>
  <a href="https://www.npmjs.com/package/idenplane-cli"><img src="https://img.shields.io/npm/v/idenplane-cli?label=idenplane-cli" alt="npm idenplane-cli" /></a>
  <a href="https://hub.docker.com/r/islamawad/idenplane"><img src="https://img.shields.io/docker/v/islamawad/idenplane?label=Docker%20Hub" alt="Docker Hub" /></a>
  <a href="https://github.com/idenplane/idenplane/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="License" /></a>
  <a href="https://idenplane.com"><img src="https://img.shields.io/badge/docs-idenplane.com-blue" alt="Docs" /></a>
</p>

---

## Why Idenplane?

Most identity solutions are either too complex to self-host (Java, heavy runtimes) or too limited for production (simple JWT libraries). Idenplane fills that gap:

- **Local Docker setup** — generate unique secrets, then start the server with Docker Compose
- **Modern stack** — TypeScript, NestJS, React, PostgreSQL. No Java, no XML
- **Lightweight** — about 194 MiB of RAM at idle and ready in about 5 s, vs. 464 MiB and 24 s for Keycloak on the same machine ([benchmarks](docs/docs/benchmarks.md))
- **Complete** — OAuth 2.0, OIDC, SAML 2.0, WebAuthn, MFA, LDAP, SSO, Organizations — all built-in
- **Extensible** — plugin system, custom auth flows, webhooks, nine SDKs and a CLI
- **Admin Console** — full-featured React dashboard at `/console`

---

## Features

### Authentication & Protocols

| Feature | Description |
|---------|-------------|
| **OAuth 2.0 / OpenID Connect** | Authorization Code (with PKCE), Client Credentials, Password, Refresh Token, and Device Authorization grants |
| **SAML 2.0** | Identity Provider for SAML service providers: SP-initiated SSO, signed assertions and metadata. Idenplane is not a SAML service provider |
| **WebAuthn / Passkeys** | FIDO2 passwordless authentication with credential registration, biometric support, and platform authenticators |
| **Multi-Factor Authentication** | TOTP-based 2FA with QR provisioning, recovery codes, and brute-force protection |
| **Step-Up Authentication** | ACR levels (password, MFA, WebAuthn) requiring re-authentication for sensitive operations |
| **Adaptive / Risk-Based Auth** | Impossible travel detection, IP reputation scoring, device fingerprinting, and risk-based step-up or block |
| **Social Login** | Broker external OpenID Connect and OAuth 2.0 identity providers (Google, GitHub, Microsoft Entra ID, etc.). SAML identity providers cannot be brokered |
| **LDAP User Federation** | Sync users from LDAP/Active Directory with on-demand or scheduled sync |
| **Custom Auth Flows (experimental)** | Configurable login flows; they run at sign-in only when the server sets `AUTH_FLOW_RUNTIME_ENABLED=true` and the realm binds a flow |
| **Single Sign-On** | Browser-based SSO across all clients in a realm |
| **SCIM 2.0** | Complete Identity provisioning with Users, Groups, and Service Providers |

### Identity Management

| Feature | Description |
|---------|-------------|
| **Multi-Tenancy (Realms)** | Isolated tenants with independent users, clients, roles, and configurations |
| **Organizations (B2B)** | Organizations with member roles, SSO connections, and domain verification via DNS TXT |
| **Role-Based Access Control** | Realm-level and client-level roles with user and group assignments |
| **Policy-Based Authorization** | Attribute-Based Access Control (ABAC) for fine-grained permissions |
| **Groups** | Hierarchical groups with role inheritance |
| **Custom User Attributes** | Flexible schema (text, email, date, select, multiselect) with OIDC claim mapping |
| **Service Accounts & API Keys** | Stateless backend-to-backend authentication with key rotation and usage tracking |
| **Password Policies** | Minimum length, complexity requirements, history tracking, and expiry |
| **Brute Force Protection** | Automatic account lockout with configurable thresholds and duration |
| **Email Verification & Password Reset** | Configurable email flows via SMTP with themed templates |
| **Impersonation** | Admin impersonation with temporary tokens, max duration, and full audit trail |

### Admin Console

| Feature | Description |
|---------|-------------|
| **Modern React Dashboard** | Full-featured admin UI at `/console` with real-time stats |
| **Entity Management** | CRUD for realms, users, clients, roles, groups, scopes, organizations, and more |
| **Auth Flow Builder (experimental)** | Visual flow configuration; flows run at login when the server-wide runtime flag is on |
| **Session Management** | View and revoke active user sessions |
| **Event Audit Logs** | Login events and admin action history with filtering and export |
| **Identity Provider Config** | Configure OIDC/OAuth 2.0 identity providers, SAML service providers and LDAP federation from the UI |
| **Realm Import/Export** | Migrate configurations between environments |
| **Analytics Dashboard** | Active users (24h/7d/30d), login success/failure rates, session counts |

### Webhooks & Integrations

| Feature | Description |
|---------|-------------|
| **Outbound Webhooks** | Event-driven HTTP callbacks with AES-256-GCM encryption at rest |
| **Retry & Scheduling** | Async delivery with configurable retry policies and status tracking |
| **Plugin System** | Extensible plugin architecture with event listeners and token enrichment hooks |
| **Data Migration** | Built-in importers for Keycloak, Auth0, Zitadel and Authentik exports |

### Operations & DevOps

| Feature | Description |
|---------|-------------|
| **Prometheus Metrics** | `/admin/metrics` endpoint (admin credentials required) for Grafana dashboards |
| **Health Checks** | `/health/live` and `/health/ready` for load balancers and orchestrators |
| **Structured Logging** | JSON logging with Pino for log aggregation |
| **Rate Limiting** | Configurable request throttling per endpoint, per client, per user, and per IP |
| **Horizontal Scaling** | Stateless design — run multiple instances behind a load balancer |
| **Redis Support** | Optional Redis for session storage and caching (Sentinel support for HA) |
| **PostgreSQL** | PostgreSQL 16+, self-hosted or managed (RDS, Aurora, Cloud SQL, Azure, Supabase, Neon) |
| **Guided Upgrades** | Pre-flight validation, automatic pre-upgrade backup, and rollback on failure — opt-in, see [Upgrading](https://idenplane.com/deployment/upgrading) |
| **API Deprecation Headers** | `Deprecation` and `Sunset` headers (RFC 8594) on the admin API. There is no versioned `/api/v1` admin API yet; use `/admin/...` ([details](docs/docs/project/versioning-and-support.md)) |
| **CORS Management** | Dynamic origin validation with two-level caching (in-process + Redis) |
| **Realm Theming** | Custom logos, colors, and CSS per realm for login, consent, account, and email pages |

---

## Quick Start

### Docker Hub (Local Quick Start)

Requires Docker Compose v2.20+ and Node.js 24 for the one-time setup helper. On Windows, use `curl.exe` instead of `curl`.

```bash
curl --fail --location -o docker-compose.yml https://raw.githubusercontent.com/idenplane/idenplane/main/docker-compose.yml
curl --fail --location -o setup-env.cjs https://raw.githubusercontent.com/idenplane/idenplane/main/scripts/setup-env.cjs
node setup-env.cjs
docker compose up -d --wait --wait-timeout 180
```

Wait for the services to become healthy, then open:

| URL | Description |
|-----|-------------|
| http://localhost:3000/console | Admin Console |
| http://localhost:3000/api | Swagger API Docs |
| http://localhost:3000/health/live | Health Check |

Prometheus metrics are at `/admin/metrics` and need admin credentials:

```bash
curl -H "x-admin-api-key: $ADMIN_API_KEY" http://localhost:3000/admin/metrics
```

**Generated admin credentials:**

| Field | Value |
|-------|-------|
| Username | `admin` |
| Password | Value of `ADMIN_PASSWORD` in `.env` |
| API Key | Value of `ADMIN_API_KEY` in `.env` |

> Keep `.env` private and preserve its encryption keys. The helper refuses to overwrite an existing file. For an existing database, keep its current password; changing `.env` does not rotate a PostgreSQL password. This setup listens on localhost. Configure HTTPS, backups and a pinned release image before production use.

### From Source

**Prerequisites:** Node.js 24, PostgreSQL 16+

```bash
git clone https://github.com/idenplane/idenplane.git
cd idenplane

# Install dependencies
npm ci
cd admin-ui && npm ci && cd ..

# Configure
node scripts/setup-env.cjs
# Edit DATABASE_URL in .env if your local PostgreSQL uses different credentials

# Setup database
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed   # Optional: sample data

# Build & start
npm run build:all
npm run start:prod
```

---

## Client SDKs

Idenplane provides official SDKs for these platforms:

| Package | Install | Description |
|---------|---------|-------------|
| [**idenplane-sdk**](packages/idenplane-js/) | `npm i idenplane-sdk` | Core TypeScript SDK with React bindings |
| [**idenplane-nextjs**](packages/idenplane-nextjs/) | `npm i idenplane-nextjs` | Next.js SDK — App Router, middleware, Server Components |
| [**idenplane-angular**](packages/idenplane-angular/) | `npm i idenplane-angular` | Angular SDK — service, guard, HTTP interceptor |
| [**idenplane-vue**](packages/idenplane-vue/) | `npm i idenplane-vue` | Vue 3 SDK — composables, plugin, router guard |
| [**idenplane-android**](packages/idenplane-android/) | `com.idenplane:idenplane-android` (Maven Central) | Android SDK — Chrome Custom Tabs, encrypted storage, biometrics |
| [**idenplane-ios**](packages/idenplane-ios/) | Local Swift package (no SPM release yet) | iOS SDK — ASWebAuthenticationSession, Keychain, Face ID / Touch ID |
| [**idenplane-cli**](packages/idenplane-cli/) | `npm i -g idenplane-cli` | CLI tool — manage realms, users, and configurations from terminal |
| [**idenplane-python**](packages/idenplane-python/) | `pip install idenplane` | Python SDK — server-side admin API client for Python 3.9+ |
| [**idenplane-go**](packages/idenplane-go/) | `go get github.com/idenplane/idenplane/packages/idenplane-go` | Go SDK — admin API client with context support (Go 1.24+) |
| [**idenplane-java**](packages/idenplane-java/) | `com.idenplane:idenplane-java-core` (Maven Central) | Java SDK — Java 17+ token validation and OIDC client. The Spring Boot, Jakarta and Reactor modules are in the repo but not published yet |

### Quick Example (5 Lines to Authenticate)

```typescript
import { IdenplaneClient } from 'idenplane-sdk';

const idenplane = new IdenplaneClient({
  url: 'http://localhost:3000',
  realm: 'my-realm',
  clientId: 'my-app',
  redirectUri: 'http://localhost:5173/callback',
});

await idenplane.init();
if (!idenplane.isAuthenticated()) {
  await idenplane.login(); // Redirects to Idenplane login page
}
```

### React

```tsx
import { IdenplaneClient } from 'idenplane-sdk';
import { AuthProvider, useAuth, useUser } from 'idenplane-sdk/react';

const idenplane = new IdenplaneClient({ /* config */ });

function App() {
  return (
    <AuthProvider client={idenplane}>
      <Dashboard />
    </AuthProvider>
  );
}

function Dashboard() {
  const { isAuthenticated, login, logout } = useAuth();
  const user = useUser();

  if (!isAuthenticated) return <button onClick={() => login()}>Sign In</button>;

  return (
    <div>
      <p>Welcome, {user?.name}!</p>
      <button onClick={() => logout()}>Sign Out</button>
    </div>
  );
}
```

### Next.js

```typescript
// middleware.ts
import { NextResponse, type NextRequest } from 'next/server';
import { createAuthMiddleware } from 'idenplane-nextjs/middleware';

const auth = createAuthMiddleware({
  serverUrl: 'http://localhost:3000',
  realm: 'my-realm',
  clientId: 'my-app',
  protectedPaths: ['/dashboard', '/settings'],
  loginPath: '/login',
});

export default function middleware(req: NextRequest) {
  return auth(req as never, NextResponse as never);
}

// app/dashboard/page.tsx (Server Component)
// Reads the `idenplane_access_token` cookie, which your app must set.
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getServerUser } from 'idenplane-nextjs/server';

export default async function Dashboard() {
  const user = await getServerUser(await cookies());
  if (!user) redirect('/login');
  return <h1>Welcome, {user.name}</h1>;
}
```

### Angular

```typescript
// app.module.ts
import { IdenplaneModule } from 'idenplane-angular';

@NgModule({
  imports: [
    IdenplaneModule.forRoot({
      url: 'http://localhost:3000',
      realm: 'my-realm',
      clientId: 'my-app',
      redirectUri: 'http://localhost:4200/callback',
    }),
  ],
})
export class AppModule {}

// component.ts — inject AuthService, use isAuthenticated$ observable
```

### Vue

```typescript
// main.ts
import { IdenplanePlugin } from 'idenplane-vue';

app.use(IdenplanePlugin, {
  url: 'http://localhost:3000',
  realm: 'my-realm',
  clientId: 'my-app',
  redirectUri: 'http://localhost:5173/callback',
});

// Component — useAuth(), useUser(), usePermissions() composables
```

### Works with Any OIDC Library

Idenplane implements standard OpenID Connect, so it works out of the box with `oidc-client-ts`, `react-oidc-context`, `next-auth`, and any other compliant library.

---

## CLI

Idenplane ships with a command-line tool for managing your server:

```bash
npm install -g idenplane-cli
```

```bash
# Configure connection
idenplane login --server http://localhost:3000 --api-key YOUR_KEY

# Manage realms
idenplane realm list
idenplane realm create my-realm

# Manage users
idenplane user list --realm my-realm
idenplane user create john --realm my-realm --email john@example.com

# Bulk import from CSV
idenplane user bulk-import --realm my-realm --file users.csv

# Manage clients
idenplane client list --realm my-realm
```

See the full CLI documentation at [`packages/idenplane-cli/`](packages/idenplane-cli/).

---

## Architecture

### System Overview

```mermaid
graph TB
    subgraph Client["Client Applications"]
        Browser["Browser App"]
        Mobile["Mobile App"]
        API["API Client"]
    end

    subgraph Idenplane["Idenplane Server"]
        subgraph Gateways["Gateways"]
            AdminAPI["Admin REST API"]
            OAuth["OAuth/OIDC Endpoints"]
            SAML["SAML IdP"]
            WebAuthn["WebAuthn FIDO2"]
        end

        subgraph Services["NestJS Services"]
            AuthService["Auth Service"]
            TokenService["Token Service"]
            UserService["User Service"]
            ClientService["Client Service"]
            MFAService["MFA Service"]
            SessionService["Session Service"]
        end

        subgraph Storage["Data Layer"]
            Redis["Redis (Cache)"]
            Postgres["PostgreSQL"]
        end
    end

    subgraph External["External Services"]
        SMTP["SMTP Server"]
        LDAP["LDAP Server"]
        IdP["Identity Providers"]
    end

    Browser --> OAuth
    Mobile --> OAuth
    API --> AdminAPI

    OAuth --> AuthService
    AdminAPI --> AuthService
    AuthService --> TokenService
    AuthService --> UserService
    AuthService --> MFAService
    TokenService --> SessionService

    SessionService --> Redis
    UserService --> Postgres
    ClientService --> Postgres
    AuthService --> SMTP
    UserService --> LDAP
    AuthService --> IdP
```

### Authentication Flow

```mermaid
sequenceDiagram
    participant Client
    participant Idenplane
    participant DB as Database
    participant MFA as MFA Service

    Client->>Idenplane: POST /token (credentials)
    Idenplane->>DB: Validate credentials
    DB-->>Idenplane: User found
    Idenplane->>Idenplane: Check MFA required?
    Idenplane->>MFA: Verify TOTP
    MFA-->>Idenplane: MFA valid
    Idenplane->>DB: Create session
    Idenplane->>DB: Create tokens
    DB-->>Idenplane: Tokens created
    Idenplane-->>Client: { access_token, refresh_token }
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | NestJS 12, TypeScript 6, Node.js 24 |
| **Database** | PostgreSQL 16+ via Prisma 7 ORM |
| **Admin UI** | React 19, Vite 8, Tailwind CSS 4, React Query |
| **Auth Pages** | Handlebars SSR with per-realm theming and i18n |
| **Security** | Argon2id (passwords), JOSE (JWTs), Helmet (headers), AES-256-GCM (webhooks) |
| **Protocols** | OAuth 2.0, OpenID Connect, SAML 2.0, WebAuthn/FIDO2 |
| **Federation** | LDAP via ldapts; SAML 2.0 IdP on xml-crypto and @xmldom/xmldom |
| **Caching** | Redis (optional) with Sentinel HA support |
| **Observability** | Pino (logs), prom-client (metrics), @nestjs/terminus (health) |
| **Container** | Docker multi-stage build, Docker Compose (single, dev, cluster) |
| **SDKs** | TypeScript, React, Next.js, Angular, Vue, Android (Kotlin), iOS (Swift), Java, Python, Go |
| **CLI** | idenplane-cli (Node.js, Commander.js) |

---

## Supported Standards

| Standard | Support |
|----------|---------|
| OAuth 2.0 (RFC 6749) | Authorization Code, Client Credentials, Password, Refresh Token |
| PKCE (RFC 7636) | S256 method |
| OpenID Connect Core 1.0 | ID tokens, UserInfo, Discovery, Backchannel Logout |
| Device Authorization (RFC 8628) | Full device code flow with user verification |
| SAML 2.0 | Identity Provider only: SP-initiated SSO, signed assertions, metadata exchange |
| WebAuthn / FIDO2 | Credential registration, platform & roaming authenticators |
| TOTP (RFC 6238) | MFA with QR provisioning and recovery codes |
| Argon2id (RFC 9106) | Password hashing |
| API Deprecation (RFC 8594) | Deprecation and Sunset headers |

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | *(required)* | PostgreSQL connection string |
| `PORT` | `3000` | Server port |
| `NODE_ENV` | *(unset: non-production)* | Environment mode. The Docker image sets `production` |
| `BASE_URL` | `http://localhost:3000` | Public URL for redirects and emails |
| `ADMIN_API_KEY` | *(required in production)* | API key for admin endpoints. In production it must be at least 32 characters and not a placeholder, or startup fails. The Docker image refuses to start without it; from source, an unset key disables API-key auth |
| `ADMIN_USER` | `admin` | Initial admin username |
| `ADMIN_PASSWORD` | *(none; generated outside production)* | Initial admin password. Never defaults to `admin`: unset outside production, a random one is printed once in the first start's log; `admin` and placeholders are refused |
| `WEBHOOK_SECRET_KEY` | *(required in production)* | 32-byte AES-256-GCM key (`openssl rand -hex 32`) |
| `WEBHOOK_ENCRYPTION_SALT` | *(required in production)* | 16-byte salt (`openssl rand -hex 16`) |
| `REDIS_URL` | *(optional)* | Redis connection string for cache and session store |
| `REDIS_SENTINEL_HOSTS` | *(optional)* | Comma-separated Sentinel nodes for HA |
| `REDIS_SENTINEL_NAME` | `mymaster` | Sentinel master name |
| `SESSION_STORE` | `database` | Session backend: `database` or `redis` |
| `THROTTLE_TTL` | `60000` | Rate limit window (ms) |
| `THROTTLE_LIMIT` | `100` | Max requests per window |
| `TRUSTED_PROXIES` | *(optional)* | Comma-separated IPs/CIDR for X-Forwarded-For trust |

These are the main variables. The full list is in [Environment Variables](docs/docs/configuration/environment-variables.md). SMTP settings are configured per realm in the Admin Console (Realm > Email tab).

---

## API Documentation

Interactive Swagger UI is available at `/api` when the server is running.

### Key Endpoints

```
# OpenID Connect Discovery
GET  /realms/{realm}/.well-known/openid-configuration

# Token Endpoint (all grant types)
POST /realms/{realm}/protocol/openid-connect/token

# Authorization Endpoint
GET  /realms/{realm}/protocol/openid-connect/auth

# UserInfo
GET  /realms/{realm}/protocol/openid-connect/userinfo

# JWKS (signing keys)
GET  /realms/{realm}/protocol/openid-connect/certs

# SAML Metadata
GET  /realms/{realm}/protocol/saml/descriptor

# Admin API (requires x-admin-api-key or an admin Bearer token)
GET/POST       /admin/realms
GET/PUT/DELETE /admin/realms/{name}
GET/POST       /admin/realms/{name}/users
GET/POST       /admin/realms/{name}/clients
GET/POST       /admin/realms/{name}/roles
GET/POST       /admin/realms/{name}/groups
GET/POST       /admin/realms/{name}/organizations

# Webhooks
GET/POST       /admin/realms/{name}/webhooks

# Health & Metrics
GET  /health/live
GET  /health/ready
GET  /admin/metrics    # Requires admin credentials (x-admin-api-key or admin Bearer token)
```

---

## Project Structure

```
Idenplane/
├── src/                           # NestJS backend (about 70 modules)
│   ├── auth/                      # Core OAuth 2.0 authentication
│   ├── oauth/                     # OAuth 2.0 protocol logic
│   ├── nhi/                       # Non-human identities (workload certificates)
│   ├── saml/                      # SAML 2.0 IdP
│   ├── tokens/                    # JWT issuance, validation & revocation
│   ├── mfa/                       # TOTP multi-factor auth
│   ├── webauthn/                  # WebAuthn / FIDO2 passwordless
│   ├── login/                     # Login flow orchestration
│   ├── magic-link/                # Magic link authentication
│   ├── auth-flow/                 # Custom authentication flow engine
│   ├── step-up/                   # Step-up authentication (ACR levels)
│   ├── risk-assessment/           # Adaptive auth & risk scoring
│   ├── consent/                   # OAuth consent flow
│   ├── continuous-verification/   # Risk-based step-up
│   ├── users/                     # User management
│   ├── clients/                   # OAuth2 client management
│   ├── realms/                    # Multi-tenant configuration
│   ├── organizations/             # B2B organizations & SSO
│   ├── roles/                     # RBAC
│   ├── groups/                    # Hierarchical groups
│   ├── authorization/             # Policy-based access control (ABAC)
│   ├── sessions/                  # Session management
│   ├── scim/                      # SCIM 2.0 server
│   ├── setup-wizard/              # First-time setup wizard
│   ├── service-accounts/          # Service accounts & API keys
│   ├── custom-attributes/         # Custom user attributes
│   ├── broker/                    # External OIDC/OAuth 2.0 IdP brokering
│   ├── user-federation/           # LDAP sync
│   ├── identity-providers/        # Social login config
│   ├── impersonation/             # Admin impersonation
│   ├── webhooks/                  # Outbound event webhooks
│   ├── plugins/                   # Plugin system
│   ├── events/                    # Audit logging
│   ├── stats/                     # Analytics & statistics
│   ├── sms/                       # SMS OTP provider
│   ├── metrics/                   # Prometheus metrics
│   ├── health/                    # Health checks
│   ├── email/                     # SMTP email service
│   ├── verification/              # Email verification
│   ├── password-policy/           # Password rules
│   ├── brute-force/               # Lockout protection
│   ├── crypto/                    # Cryptographic utilities
│   ├── scopes/                    # OAuth scope definitions
│   ├── client-scopes/             # Client scope assignments
│   ├── device/                    # Device authorization grant
│   ├── well-known/                # OIDC discovery
│   ├── account/                   # User self-service portal
│   ├── admin-auth/                # Admin API authentication
│   ├── versioning/                # Deprecation and Sunset headers
│   ├── migration/                 # Keycloak, Auth0, Zitadel & Authentik importers
│   ├── rate-limit/                # Request throttling
│   ├── registration/              # User registration flow
│   ├── cors/                      # CORS origin management
│   ├── cache/                     # Cache abstraction layer
│   ├── redis/                     # Redis integration
│   ├── database/                  # Database provider abstraction
│   ├── upgrade/                  # Database upgrade system
│   ├── theme/                     # Handlebars template rendering
│   └── common/                    # Shared guards, filters, decorators
├── admin-ui/                      # React admin console (React 19 + Tailwind 4)
├── packages/
│   ├── idenplane-js/                 # Core TypeScript SDK
│   ├── idenplane-nextjs/             # Next.js SDK
│   ├── idenplane-angular/            # Angular SDK
│   ├── idenplane-vue/                # Vue 3 SDK
│   ├── idenplane-cli/                # CLI tool
│   ├── idenplane-mcp/                # MCP server
│   ├── idenplane-android/            # Android SDK (Kotlin)
│   ├── idenplane-ios/                # iOS SDK (Swift)
│   ├── idenplane-java/               # Java SDK
│   ├── idenplane-python/             # Python SDK
│   └── idenplane-go/                 # Go SDK
├── themes/                        # Login/account page themes
│   ├── idenplane/                    # Default theme
│   └── midnight/                  # Dark theme
├── prisma/                        # Database schema & migrations
├── test/                          # E2E tests
├── docker-compose.yml             # Local quick start (pulls from Docker Hub, localhost only)
├── docker-compose.dev.yml         # Builds the image from your checkout
├── docker-compose.production.yml  # Production with Traefik TLS and Redis
├── docker-compose.nginx.yml       # Production with nginx-proxy TLS and Redis
├── docker-compose.cluster.yml     # Multi-instance with Nginx LB
└── Dockerfile                     # Multi-stage production build
```

---

## Development

```bash
# Start PostgreSQL
docker compose up db -d

# Backend (watch mode)
npm run start:dev

# Admin UI (separate terminal)
npm run admin:dev

# Run tests
npm test           # Unit tests
npm run test:e2e   # E2E tests (requires PostgreSQL)
```

### Database Commands

```bash
npm run prisma:generate   # Regenerate Prisma client
npm run prisma:migrate    # Apply pending migrations
npm run prisma:seed       # Seed with test data
npm run db:setup          # Generate + migrate + seed
```

---

## Deployment

### Docker Hub

```bash
docker pull islamawad/idenplane:latest
docker compose up -d
```

### Build from Source (Docker)

```bash
docker compose -f docker-compose.dev.yml up -d --build
```

### Horizontal Scaling

Idenplane is fully stateless — all state is stored in PostgreSQL (and optionally Redis). Scale horizontally:

```bash
# Using the cluster compose file (2 instances + Nginx LB)
docker compose -f docker-compose.cluster.yml up -d
```

For production clusters, enable Redis for shared session storage:

```bash
SESSION_STORE=redis
REDIS_URL=redis://your-redis:6379
```

---

## Comparison

| Feature | Idenplane | Keycloak | Auth0 | Clerk |
|---------|--------|----------|-------|-------|
| Self-hosted | Yes | Yes | No | No |
| Open source | Yes | Yes | No | No |
| Memory at idle ([measured](docs/docs/benchmarks.md)) | 194 MiB | 464 MiB | N/A | N/A |
| Language | TypeScript | Java | N/A | N/A |
| OAuth 2.0 + OIDC | Yes | Yes | Yes | Yes |
| SAML 2.0 | Yes | Yes | Yes | No |
| WebAuthn / Passkeys | Yes | Yes | Yes | Yes |
| MFA / 2FA | Yes | Yes | Yes | Yes |
| Adaptive Auth | Yes | Yes | Yes | Yes |
| LDAP Federation | Yes | Yes | Yes | No |
| Organizations (B2B) | Yes | Yes | Yes | Yes |
| Webhooks | Yes | Yes | Yes | Yes |
| Admin Console | Yes | Yes | Yes | Yes |
| Client SDKs | 9 SDKs | Java-centric | Yes | Yes |
| CLI Tool | Yes | Yes | No | Yes |
| Custom Auth Flows | Experimental | Yes | No | No |
| Plugin System | Yes | Yes | No | No |
| Realm Theming | Yes | Yes | No | Yes |
| Database | PostgreSQL | PostgreSQL, MySQL, MariaDB, Oracle, SQL Server | Managed | Managed |

---

## Project

- [Support](SUPPORT.md): where to ask questions and report bugs, and what to expect
- [Governance](GOVERNANCE.md): how decisions are made and how changes are reviewed and released
- [Roadmap](ROADMAP.md): what is planned or under consideration
- [Versioning and Support](docs/docs/project/versioning-and-support.md): version numbers, which versions get security fixes, deprecation, and the compatibility matrix
- [Security Policy](SECURITY.md): how to report a vulnerability privately
- [Security Acknowledgments](docs/docs/security/acknowledgments.md): reporters of fixed vulnerabilities
- [Threat Model](docs/docs/security/threat-model.md): what Idenplane protects, and against whom

---

## Contributing

Contributions are welcome! Please open an issue or submit a pull request. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full guide.

1. Fork the repository
2. Create your feature branch (`git checkout -b feat/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feat/amazing-feature`)
5. Open a Pull Request

---

## License

Idenplane is released under the **GNU Affero General Public License v3.0 (AGPL-3.0)**.

You are free to use, modify, and distribute Idenplane. However, if you run a modified version of Idenplane as a network service (e.g. as a SaaS), the AGPL requires you to make the complete source code of your modified version available to its users.

For organizations that cannot comply with the AGPL — for example, because they want to embed Idenplane in a proprietary product — a **commercial license** is available. Contact [licensing@idenplane.com](mailto:licensing@idenplane.com) for details.

See the [LICENSE](LICENSE) file for the full AGPL-3.0 text.

---

<p align="center">
  <a href="https://idenplane.com">idenplane.com</a> &middot;
  Built with NestJS, React, and PostgreSQL
</p>
