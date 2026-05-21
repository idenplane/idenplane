# Idenplane

**The identity control plane you own.**

Self-hosted, open-source Identity & Access Management server — a lightweight alternative to Keycloak and Auth0. Built with TypeScript, NestJS, and PostgreSQL. Runs in ~150 MB of RAM (vs Keycloak's 1 GB+).

[![GitHub](https://img.shields.io/badge/source-idenplane%2Fidenplane-181717?logo=github&style=flat-square)](https://github.com/idenplane/idenplane)
[![License](https://img.shields.io/badge/license-AGPL--3.0-blue?style=flat-square)](https://github.com/idenplane/idenplane/blob/dev/LICENSE)

---

## Quick Start

```bash
curl -o docker-compose.yml \
  https://raw.githubusercontent.com/idenplane/idenplane/dev/docker-compose.yml

# Required: set an admin API key (32+ chars)
export ADMIN_API_KEY=$(openssl rand -hex 32)
export ADMIN_PASSWORD=$(openssl rand -hex 16)

docker compose up -d
```

Then open:

| URL | What |
|---|---|
| `http://localhost:3000/console` | Admin Console (React) |
| `http://localhost:3000/api` | Swagger / OpenAPI docs |
| `http://localhost:3000/health/live` | Liveness probe |
| `http://localhost:3000/metrics` | Prometheus metrics |

Default admin: `admin` / value of `$ADMIN_PASSWORD`.

---

## What you get

### Protocols
OAuth 2.0 · OpenID Connect · SAML 2.0 · WebAuthn / FIDO2 · TOTP / MFA · SCIM 2.0 · Device Authorization (RFC 8628)

### Identity
Multi-tenancy via realms · Organizations (B2B) · RBAC + ABAC · Hierarchical groups · Service accounts + API keys · LDAP federation · External IdP brokering (OIDC + SAML social login) · Magic links · Email + SMS OTP

### Adaptive auth
Risk-based step-up · Impossible-travel detection · IP reputation · Device fingerprinting · Continuous verification · ACR levels (password / MFA / WebAuthn)

### Operations
Stateless · Horizontal scaling · Optional Redis (with Sentinel HA) · Prometheus metrics · Structured JSON logs · Health / readiness probes · API versioning · Per-realm theming (Handlebars SSR)

### Ecosystem
10 client SDKs: TypeScript core · React · Next.js · Angular · Vue · Android · iOS · CLI · Python · Go · Java

Migration importers for **Auth0** and **Keycloak** configurations are built in.

---

## Tags

| Tag | What it is |
|---|---|
| `latest` | Latest stable build from the `dev` branch |
| `v1.0.0` | First named release |
| `<short-sha>` | Pinned to a specific commit (e.g. `56009be`) |

Production deployments should pin a specific version rather than `latest`.

---

## Required environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (also accepts MySQL and SQLite) |
| `ADMIN_API_KEY` | 32+ character secret for admin endpoints. Startup refuses to boot in `NODE_ENV=production` if absent, placeholder, or shorter than 32 chars. |
| `ADMIN_PASSWORD` | Initial admin-user password |
| `WEBHOOK_SECRET_KEY` | 32-byte key for AES-256-GCM encryption of webhook secrets at rest |
| `WEBHOOK_ENCRYPTION_SALT` | 16-byte salt for scrypt-derivation of the AES key |

Generate strong values with:

```bash
openssl rand -hex 32   # for ADMIN_API_KEY and WEBHOOK_SECRET_KEY
openssl rand -hex 16   # for WEBHOOK_ENCRYPTION_SALT
```

Full reference: see [.env.example](https://github.com/idenplane/idenplane/blob/dev/.env.example).

---

## Horizontal scaling

The server is stateless — all state lives in PostgreSQL (and optionally Redis for sessions and cache). Run multiple instances behind a load balancer:

```bash
docker compose up -d --scale app=3
```

For production clusters, enable shared session storage:

```bash
SESSION_STORE=redis
REDIS_URL=redis://your-redis:6379
```

---

## Image details

- Base: `node:22-alpine` · multi-stage build · production deps only
- Runs as the non-root `node` user (UID 1000)
- Built with `--ignore-scripts` in the deps stage; Prisma client generated explicitly in the build stage
- Healthcheck: `wget -q --spider http://localhost:3000/health/ready` every 30s
- Compressed image size: ~325 MB

---

## Documentation, source, support

- **Source code**: https://github.com/idenplane/idenplane
- **Issues**: https://github.com/idenplane/idenplane/issues
- **Discussions**: https://github.com/idenplane/idenplane/discussions
- **Security reports**: see [SECURITY.md](https://github.com/idenplane/idenplane/blob/dev/SECURITY.md) — please do not file security issues publicly

---

## License

Idenplane is released under the **GNU Affero General Public License v3.0 (AGPL-3.0)**. You're free to use, modify, and run it; running a modified network service requires offering source to its users.

For organizations that need to embed Idenplane in a proprietary product, a commercial license is available — contact licensing@idenplane.com.

[Full license](https://github.com/idenplane/idenplane/blob/dev/LICENSE)
