<p align="center">
  <img src="https://idenplane.dev/logo.svg" alt="Idenplane" width="60" />
</p>

<h2 align="center">Idenplane Admin Console</h2>

<p align="center">
  <strong>Full-featured web dashboard for managing your Idenplane instance.</strong><br />
  <sub>Built with React 19, Vite 7, Tailwind CSS 4, and React Query.</sub>
</p>

---

## Overview

The Admin Console is a single-page application served at `/console` that provides complete management of all Idenplane resources. It communicates with the backend via REST API using either an admin API key or credential-based JWT authentication.

### Capabilities

| Area | What You Can Do |
|------|----------------|
| **Dashboard** | Overview of realms, users, clients, and recent activity |
| **Realms** | Create, configure, theme, import/export realms (General, Tokens, Login, Email, Brute Force, Theme) |
| **Users** | Full CRUD, password reset, MFA management, role/group assignments, session viewer |
| **Clients** | OAuth2 client management — settings, credentials, scope assignments, service account config |
| **Roles** | Realm-level and client-level role management |
| **Groups** | Hierarchical groups with member and role management |
| **Client Scopes** | Scope definitions with protocol mapper configuration |
| **Sessions** | View and revoke active user sessions across all clients |
| **Events** | Login event log and admin action audit trail with filtering |
| **Identity Providers** | Configure OIDC and SAML social login providers (Google, GitHub, Azure AD, etc.) |
| **User Federation** | LDAP/AD directory sync configuration with test connection and sync triggers |
| **SAML Providers** | SAML Service Provider registration for IdP mode |

---

## Development

```bash
# Install dependencies
npm install

# Start dev server (proxies API to http://localhost:3000)
npm run dev

# Type check
npx tsc --noEmit

# Lint
npm run lint

# Production build
npm run build
```

The dev server runs on `http://localhost:5173` and proxies `/admin`, `/auth`, `/realms`, `/health`, and `/metrics` to the backend at `http://localhost:3000`.

---

## Tech Stack

| Library | Purpose |
|---------|---------|
| **React 19** | UI framework |
| **React Router 7** | Client-side routing |
| **TanStack React Query** | Server state management, caching, and mutations |
| **Axios** | HTTP client with interceptors for auth headers |
| **Tailwind CSS 4** | Utility-first styling |
| **Vite 7** | Build tool and dev server |
| **TypeScript 5.9** | Type safety |

---

## Project Structure

```
admin-ui/src/
├── api/                    # API client functions (one file per resource)
│   ├── clients.ts
│   ├── groups.ts
│   ├── identityProviders.ts
│   ├── realmImportExport.ts
│   ├── realms.ts
│   ├── roles.ts
│   ├── samlServiceProviders.ts
│   ├── sessions.ts
│   ├── userFederation.ts
│   └── users.ts
├── components/             # Reusable components
│   ├── ConfirmDialog.tsx   # Confirmation modal
│   ├── Layout.tsx          # App shell with sidebar navigation
│   └── PasswordInput.tsx   # Password input with visibility toggle
├── hooks/
│   └── useAuth.ts          # Authentication hook (API key + credential login)
├── pages/                  # Route page components
│   ├── DashboardPage.tsx
│   ├── LoginPage.tsx
│   ├── clients/            # ClientList, ClientCreate, ClientDetail
│   ├── client-scopes/      # ClientScopeList, ClientScopeCreate, ClientScopeDetail
│   ├── events/             # LoginEvents, AdminEvents
│   ├── groups/             # GroupList, GroupCreate, GroupDetail
│   ├── identity-providers/ # IdpList, IdpCreate, IdpDetail
│   ├── realms/             # RealmList, RealmCreate, RealmDetail
│   ├── roles/              # RoleList
│   ├── saml/               # SamlSpList, SamlSpCreate, SamlSpDetail
│   ├── sessions/           # SessionList
│   ├── user-federation/    # FederationList, FederationCreate, FederationDetail
│   └── users/              # UserList, UserCreate, UserDetail
├── types/
│   └── index.ts            # Shared TypeScript interfaces
├── utils/
│   └── getErrorMessage.ts  # API error extraction helper
├── App.tsx                 # Route definitions
├── main.tsx                # React entry point
└── index.css               # Tailwind imports
```

---

## Authentication

The console supports two login methods:

1. **Admin API Key** — Stored in `sessionStorage` as `adminApiKey`, sent via the `x-admin-api-key` header
2. **Admin Credentials** — Posts to `/auth/login` on the master realm, stores JWT in `sessionStorage` as `adminToken`, sent via `Authorization: Bearer` header

Both methods are configured in `useAuth.ts` and applied to all requests via Axios interceptors.

---

## Build & Deployment

Running `npm run build` outputs to `dist/`. During the full project build (`npm run build:all` from the root), this directory is copied to `dist/admin-ui/` in the backend. The NestJS server then serves it as a static SPA at `/console`.

In Docker, the multi-stage build handles this automatically — the admin console is built and bundled into the final production image.

---

<p align="center">
  Part of <a href="https://idenplane.dev">Idenplane</a> — Open-source Identity & Access Management
</p>
