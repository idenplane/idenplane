---
id: environment-variables
title: Environment Variables
sidebar_position: 1
description: Complete reference for all Idenplane environment variables and configuration options.
---

# Environment Variables

Idenplane is configured entirely through environment variables. This reference documents all available options with their defaults, requirements, and examples.

---

## Quick Reference

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `DATABASE_URL` | — | Yes | PostgreSQL connection string |
| `DATABASE_MIGRATION_URL` | — | No | URL the Docker image uses for `prisma migrate deploy` only. Defaults to `DATABASE_URL`, with `sslmode=verify-full`/`verify-ca` and `sslrootcert` translated to Prisma's `sslmode=require&sslcert=…&sslaccept=strict` so migrations verify the database certificate too |
| `PORT` | `3000` | No | Server port |
| `NODE_ENV` | `development` | No | Environment: `development`, `production` |
| `BASE_URL` | `http://localhost:3000` | No | Public URL for redirects and emails |
| `ADMIN_API_KEY` | — | Yes (prod) | API key for admin endpoints |
| `WEBHOOK_SECRET_KEY` | — | Yes (prod) | AES-256-GCM key for every secret stored encrypted (not only webhooks) |
| `WEBHOOK_ENCRYPTION_SALT` | — | Yes (prod) | Salt for webhook key derivation |
| `REDIS_URL` | — | No | Redis connection string |
| `SESSION_STORE` | `database` | No | Session backend: `database` or `redis` |
| `THROTTLE_TTL` | `60000` | No | Rate limit window (ms) |
| `THROTTLE_LIMIT` | `100` | No | Max requests per window |
| `TRUSTED_PROXIES` | — | No | Trusted proxy IPs or CIDR blocks |
| `MTLS_ENABLED` | `false` | No | Client certificates (RFC 8705); see [Client Certificates](#client-certificates-mtls) |

---

## Database

Idenplane runs on **PostgreSQL 16 or later**, and only on PostgreSQL. A managed service works well: Amazon RDS or Aurora PostgreSQL, Google Cloud SQL, Azure Database for PostgreSQL, Supabase or Neon.

```bash
DATABASE_URL=postgresql://idenplane:idenplane@localhost:5432/idenplane
```

In production, connect over TLS and verify the server certificate (`sslmode=verify-full`); see the [Production Checklist](../deployment/production.md).

---

## Server

Control the server's network and runtime settings.

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `PORT` | `3000` | No | Port the server listens on |
| `NODE_ENV` | `development` | No | Environment: `development`, `production`, `test` |
| `BASE_URL` | `http://localhost:3000` | No | Public URL used for redirects, emails, and OAuth callbacks |
| `LOG_LEVEL` | `info` in production, `debug` otherwise | No | Lowest level written to the log: `fatal`, `error`, `warn`, `info`, `debug`, `trace` |
| `LOG_ACCESS` | `errors` | No | Which HTTP requests get an access-log line: `errors` (failed requests only: 4xx as `warn`, 5xx as `error`), `all` (every request, successful ones at `info`), or `off` |

### Examples

```bash
# Default development settings
PORT=3000
NODE_ENV=development
BASE_URL=http://localhost:3000

# Production settings
PORT=3000
NODE_ENV=production
BASE_URL=https://auth.example.com
```

An access-log line for every request costs throughput on the busiest endpoints (token, introspection, discovery), so by default only failed requests are logged. Set `LOG_ACCESS=all` to log every request, for example while investigating traffic. Application logs (sign-in failures, admin changes, errors) are written whatever `LOG_ACCESS` says.

---

## Security

:::warning
The following variables are **required in production**. Idenplane will refuse to start if you use placeholder values in a production environment.
:::

### API Authentication

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `ADMIN_API_KEY` | — | Yes (prod) | Secret API key for admin endpoints (32+ characters recommended) |
| `ADMIN_USER` | `admin` | No | Initial admin username (only used on first run) |
| `ADMIN_PASSWORD` | `admin` outside production | Production, first start | Initial admin password (only used on first run). With `NODE_ENV=production` the first start refuses a missing, default or shorter-than-12-character value |

Generate a secure key:

```bash
# Generate a 32-byte random key
openssl rand -hex 32
```

```bash
# Production example
ADMIN_API_KEY=REPLACE_ME_WITH_A_STRONG_RANDOM_SECRET
ADMIN_USER=admin
ADMIN_PASSWORD=change_this_password
```

### Webhook Encryption

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `WEBHOOK_SECRET_KEY` | — | Yes (prod) | 32-byte (or longer) key from which the AES-256-GCM key for every secret stored encrypted is derived: webhook, identity provider, LDAP, SMTP and provider secrets, audit stream headers, SSO connection secrets, signing keys and TOTP seeds. See [Production → Encryption at rest](../deployment/production.md#encryption-at-rest) |
| `WEBHOOK_ENCRYPTION_SALT` | — | Yes (prod) | 16-byte salt used when deriving the AES key via scrypt |
| `WEBHOOK_SECRET_KEY_PREVIOUS` | — | No | Only while [rotating the encryption key](../deployment/production.md#rotating-the-encryption-key): the old `WEBHOOK_SECRET_KEY`. Decrypts only; on start, every value under it is re-encrypted with the current key. Defaults to `WEBHOOK_SECRET_KEY` when only the salt changes. Remove it once the log reports `Key rotation complete`. Never generated |
| `WEBHOOK_ENCRYPTION_SALT_PREVIOUS` | — | No | Only while rotating: the old `WEBHOOK_ENCRYPTION_SALT`. Defaults to `WEBHOOK_ENCRYPTION_SALT` when only the key changes |
| `STORED_SECRETS_ACCEPT_KEY` | — | No | `true` for one start only: accept the configured key when the first start of encryption at rest finds stored values that look encrypted but do not decrypt (plaintext that merely looks like ciphertext). Never set it to get past a wrong key |
| `STORED_SECRETS_ACCEPT_UNREADABLE` | — | No | `true` for one start only: start although some stored secrets decrypt with no configured key (with neither key during a rotation). They are left as they are and logged; set each again. Without it, such a value stops the start and nothing is rewritten |

```bash
# Generate webhook encryption key
openssl rand -hex 32

# Generate encryption salt
openssl rand -hex 16
```

```bash
# Production example
WEBHOOK_SECRET_KEY=REPLACE_ME_WITH_A_STRONG_RANDOM_SECRET
WEBHOOK_ENCRYPTION_SALT=REPLACE_ME_WITH_A_UNIQUE_RANDOM_SALT
```

:::warning
`WEBHOOK_SECRET_KEY` and `WEBHOOK_ENCRYPTION_SALT` cannot simply be replaced: every stored encrypted secret (signing keys and TOTP seeds included) would become unreadable, so Idenplane refuses to start with a different key. To change them, [rotate the key](../deployment/production.md#rotating-the-encryption-key) with `WEBHOOK_SECRET_KEY_PREVIOUS` / `WEBHOOK_ENCRYPTION_SALT_PREVIOUS`. Back both values up separately from the database.
:::

---

### Sign-in

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `AUTH_FLOW_RUNTIME_ENABLED` | off | No | `true` lets realms run bound custom auth flows at login (see [Custom Auth Flows](/guides/auth-flows)). Off: every realm uses the built-in login. |
| `RECAPTCHA_SECRET_KEY` | — | No | reCAPTCHA v3 secret used for a realm whose CAPTCHA provider is `recaptcha` but that has no `recaptchaSecretKey` of its own. A realm's own secret always wins. See [Self-Registration and CAPTCHA](/guides/registration-captcha). |
| `HCAPTCHA_SECRET_KEY` | — | No | The same fallback for realms using `hcaptcha`. |
| `ENFORCE_ACR_ON_FRESH_LOGIN` | off | No | `true` makes a fresh sign-in honour what the authorization request asks of `acr`: the login form carries `acr_values` and `claims`, and an `acr` requested as an Essential Claim (OIDC `claims` parameter) is mandatory. A sign-in that cannot meet it ends with `unmet_authentication_requirements` instead of a code at a weaker level. `acr_values` stays voluntary. Custom login themes should add the hidden fields `acr_values` and `claims` (see the built-in `login.hbs`). |

## In-process cache

Every Idenplane process keeps in memory what most requests read:

- realms, clients, signing keys (JWKS) and CORS origins;
- what a token says about its user: the profile, roles (direct and through groups) and custom-attribute claims;
- each realm's scope mappers;
- the list of revoked token ids, and which sessions still exist.

Issuing a client-credentials token, verifying one, or reading discovery and JWKS therefore doesn't query the database each time.

The database keeps those copies current. Triggers on the tables behind them (realms, clients, signing keys, users, roles, groups and their memberships, custom attributes, client scopes and mappers, revoked tokens, sessions) send a PostgreSQL notification whenever something the cache holds changes, and each process drops what changed as soon as it hears it. This works however the change was made (Admin API, import, SQL by hand), and on every replica. Each process holds one extra database connection for this. If that connection drops, the process reads from the database until it is back, and then starts with an empty cache. A missed notification therefore never leaves stale data behind.

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `CACHE_L1` | on | No | Set to `off` to disable the in-process cache. |

Set `CACHE_L1=off` when Idenplane reaches PostgreSQL through a connection pooler in **transaction** mode, such as PgBouncer with `pool_mode = transaction`. `LISTEN` appears to work there, but notifications are never delivered. Session mode, or a direct connection, is fine. The cache is also off when the database is not PostgreSQL.

With Redis configured, the same notifications also delete the shared Redis entries.

### Using every CPU

By default an Idenplane container runs one Node.js process, which uses about one CPU however many the container has. To use them all, set `WEB_CONCURRENCY`. The container then starts a small primary process, which runs one worker per CPU. The workers share the port, and everything they must agree on goes through PostgreSQL: caches, scheduled jobs, live session events and plugin state. The primary restarts a worker that crashes. If workers keep failing at startup, it stops the container with the workers' error, rather than retrying for ever.

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `WEB_CONCURRENCY` | `1` | No | `auto` for one worker per usable CPU, or a number of workers. |

"Usable" means the CPUs the container may actually use: its cpuset (`--cpuset-cpus`) and its CPU quota (`--cpus`, or a Kubernetes `resources.limits.cpu`), whichever is smaller. A pod limited to 2 CPUs on a 64-core node runs 2 workers, not 64.

Each worker is a full process: it needs roughly another 150–200 MiB of memory. Per-container budgets are split between the workers rather than given to each:

- **Argon2 concurrency:** one hash at a time per usable CPU, across all workers.
- **Database pool:** about `2 × CPUs + 1` connections in total, but at least 5 per worker.
- **Global throttle:** `THROTTLE_LIMIT` per container.

Each process also keeps two connections of its own, the cache-invalidation listener and the leader lock. A container with *N* workers therefore uses up to its pool plus 2 × *N* connections. Size PostgreSQL's `max_connections` for all your containers together.

### Scheduled jobs with several instances

Some scheduled jobs must run once per tick across all instances, not once per instance: risk re-evaluation, step-up and termination checks, trust decay and credential rotation. The instances elect one of themselves to run them. The leader holds a PostgreSQL advisory lock on a connection of its own. If it stops or loses that connection, another instance takes over within about 15 seconds. Cleanup jobs and webhook delivery run on every instance; they are safe to.

Live session events (`/realms/{realm}/session-events` WebSockets) are fanned out through PostgreSQL `NOTIFY`, so a client gets them whichever instance it is connected to.

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `LEADER_ELECTION` | on | No | Set to `off` to make every instance run every job (a single instance, or a connection pooler in transaction mode, which cannot hold the lock). |

---

## Redis (Optional)

Redis is optional but recommended for production deployments with multiple instances or when you need shared session storage.

### Basic Configuration

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `REDIS_URL` | — | No | Redis connection string. If not set, Idenplane runs without Redis. |

```bash
# Basic Redis connection
REDIS_URL=redis://localhost:6379

# With password
REDIS_URL=redis://:password@localhost:6379

# With TLS
REDIS_URL=rediss://localhost:6379
```

### Redis Sentinel (High Availability)

For Redis Sentinel deployments:

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `REDIS_SENTINEL_HOSTS` | — | No | Comma-separated list of Sentinel host:port pairs (e.g., `sentinel1:26379,sentinel2:26379`) |
| `REDIS_SENTINEL_NAME` | — | No | Name of the Sentinel master to monitor (e.g., `mymaster`) |

```bash
# Redis Sentinel configuration
REDIS_URL=redis://localhost:6379
REDIS_SENTINEL_HOSTS=sentinel1:26379,sentinel2:26379,sentinel3:26379
REDIS_SENTINEL_NAME=mymaster
```

### Session Storage

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `SESSION_STORE` | `database` | No | Backend for session storage: `database` or `redis` |

```bash
# Use Redis for session storage (requires REDIS_URL)
SESSION_STORE=redis

# Use database for sessions (default)
SESSION_STORE=database
```

---

## Rate Limiting

Protect your API from abuse with configurable throttling.

This is a coarse flood guard, per client IP and **per container** (split between the container's workers, if any): with three containers a client can make up to three times `THROTTLE_LIMIT` requests per window. It is kept in memory so it costs nothing per request. The limits that matter for abuse are shared by every instance through the database: the realm's rate limits (`rateLimitEnabled`, per IP, client and user), brute-force lockout, and the per-address limits on mail that a request can trigger. A verification resend or a password reset sends at most one email a minute to an account, and a magic link at most `magicLinkRateLimitPerEmail` every 15 minutes.

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `THROTTLE_TTL` | `60000` | No | Time window for rate limiting in milliseconds |
| `THROTTLE_LIMIT` | `100` | No | Maximum requests allowed per window |

```bash
# 1 minute window, 100 requests max (default)
THROTTLE_TTL=60000
THROTTLE_LIMIT=100

# More restrictive (30 seconds, 20 requests)
THROTTLE_TTL=30000
THROTTLE_LIMIT=20

# Less restrictive (5 minutes, 500 requests)
THROTTLE_TTL=300000
THROTTLE_LIMIT=500
```

---

## Reverse Proxy / Trusted Proxies

Idenplane sits behind a reverse proxy (nginx, Cloudflare, load balancer) to improve client IP resolution and enable rate limiting by user rather than by IP.

### Configuration

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `TRUSTED_PROXIES` | — | No | Comma-separated list of trusted proxy IPs or CIDR blocks |

### Examples

```bash
# Trust specific proxies
TRUSTED_PROXIES=10.0.0.1,10.0.0.2

# Trust a subnet
TRUSTED_PROXIES=172.16.0.0/12

# Trust multiple subnets and IPs
TRUSTED_PROXIES=10.0.0.1,172.16.0.0/12,192.168.1.0/24

# Trust all proxies (only if network layer prevents direct access)
TRUSTED_PROXIES=*
```

:::warning
Setting `TRUSTED_PROXIES=*` is only safe when the network layer prevents direct public access to the Idenplane process (e.g., behind a managed cloud load balancer).
:::

---

## Client Certificates (mTLS)

OAuth client authentication with TLS client certificates ([RFC 8705](https://www.rfc-editor.org/rfc/rfc8705)): `tls_client_auth` and `self_signed_tls_client_auth`. Everything is off by default; a realm must also turn on `mtlsClientAuthEnabled`. See the [mTLS client authentication guide](../guides/mtls-client-auth.mdx). Certificate-bound access tokens are not issued yet.

The server checks these settings at startup. An unsafe or incomplete setting stops the process with an error that names the variable, even while `MTLS_ENABLED` is `false`.

| Variable | Default | Description |
|----------|---------|-------------|
| `MTLS_ENABLED` | `false` | Master switch. While it is off, the listener does not start and certificate headers are ignored. |
| `MTLS_LISTEN_PORT` | — | Port of an extra HTTPS listener that asks every client for a certificate. Requires `MTLS_TLS_CERT_FILE` and `MTLS_TLS_KEY_FILE`. |
| `MTLS_LISTEN_HOST` | all interfaces | Address the listener binds to. |
| `MTLS_TLS_CERT_FILE` | — | Server certificate (PEM) for the listener. |
| `MTLS_TLS_KEY_FILE` | — | Private key (PEM) for the listener. |
| `MTLS_TLS_KEY_PASSPHRASE_FILE` | — | File that holds the key's passphrase. |
| `MTLS_TLS_MIN_VERSION` | `TLSv1.2` | `TLSv1.2` or `TLSv1.3`. |
| `MTLS_HANDSHAKE_CA_FILE` | — | CA certificates named in the TLS CertificateRequest, so clients pick the right certificate. This is only a hint: the listener accepts any certificate at the handshake, and trust is decided for each realm. |
| `MTLS_GLOBAL_TRUST_ANCHORS_FILE` | — | PEM bundle of CA certificates that realms with `mtlsTrustGlobalAnchors` trust for `tls_client_auth`, besides their own anchors. Read at startup; a missing file or a certificate that is not a CA stops the server. |
| `MTLS_BASE_URL` | — | `https` origin of the certificate listener (or the proxy that asks for certificates). Discovery publishes `mtls_endpoint_aliases` under it for realms with certificate authentication on. It must be `https`. |
| `MTLS_PROXY_CERT_HEADER` | — | Header in which a TLS-terminating proxy forwards the client certificate. Requires `MTLS_TRUSTED_PROXY_CIDRS`. |
| `MTLS_PROXY_CERT_FORMAT` | `pem-urlencoded` | `pem-urlencoded` (one URL-encoded PEM `CERTIFICATE` block, like nginx `$ssl_client_escaped_cert`) or `rfc9440` (`:base64-DER:`, the `Client-Cert` header of RFC 9440). |
| `MTLS_PROXY_CERT_CHAIN_HEADER` | — | Optional header with the intermediates, in the same format (several PEM blocks, or a comma-separated RFC 9440 list). |
| `MTLS_TRUSTED_PROXY_CIDRS` | — | Comma-separated IPv4/IPv6 addresses and CIDR blocks of the proxies allowed to send the certificate headers. It is matched against the TCP peer only, never against `X-Forwarded-For`. `*`, `0.0.0.0/0` and `::/0` are refused. |
| `MTLS_PROXY_UNTRUSTED_HEADER_ACTION` | `reject` | What happens when a certificate header comes from any other peer: `reject` answers `400 invalid_request`, `strip` removes the header and continues. Either way the event is logged, at most once a minute per peer. |
| `MTLS_MAX_CERT_HEADER_BYTES` | `16384` | Largest accepted certificate header. A larger one, a repeated one, or one with more than one certificate is rejected. |
| `MTLS_MAX_CHAIN_DEPTH` | `5` | Most intermediates read from the handshake or the chain header, and the longest `tls_client_auth` path accepted, leaf included and trust anchor excluded (1–10). |
| `MTLS_AUTH_FAILURE_LIMIT_PER_MINUTE` | `20` | Failed certificate authentications allowed per realm and certificate (`x5t#S256`) each minute. Further attempts with that certificate get `429 slow_down` with `Retry-After` until the minute ends. Counted in Redis, or in the database without it. |

The listener serves only the endpoints a client needs: discovery (`/realms/{realm}/.well-known/openid-configuration`), `token`, `token/introspect`, `revoke`, `userinfo`, `auth/device` and `certs` under `/realms/{realm}/protocol/openid-connect/`. Every other path returns 404.

```bash
# nginx terminates TLS on 10.0.0.2 and forwards the certificate
MTLS_ENABLED=true
MTLS_PROXY_CERT_HEADER=X-SSL-Client-Cert
MTLS_TRUSTED_PROXY_CIDRS=10.0.0.2/32

# or: Idenplane terminates TLS for certificate clients itself
MTLS_ENABLED=true
MTLS_LISTEN_PORT=8443
MTLS_TLS_CERT_FILE=/etc/idenplane/tls.crt
MTLS_TLS_KEY_FILE=/etc/idenplane/tls.key
MTLS_BASE_URL=https://mtls.idp.example.com:8443
```

:::warning
Only a proxy you control may set the certificate header. Make sure the proxy overwrites any copy of the header that a client sends.
:::

---

## Complete Example

Here's a complete `.env` file for production:

```bash
# ─── Database ──────────────────────────────────────────────────────────────────
# PostgreSQL (recommended for production):
DATABASE_URL=postgresql://idenplane:idenplane@localhost:5432/idenplane

# ─── Server ────────────────────────────────────────────────────────────────────
PORT=3000
NODE_ENV=development
BASE_URL=http://localhost:3000

# ─── Security (REQUIRED) ───────────────────────────────────────────────────────
# REQUIRED: Set a strong, randomly generated secret before running in production.
# Generate one with: openssl rand -hex 32
# NEVER use the placeholder value in production — startup will be blocked if you do.
ADMIN_API_KEY=REPLACE_ME_WITH_A_STRONG_RANDOM_SECRET

# REQUIRED: 32-byte (or longer) key used to encrypt webhook secrets at rest
# (AES-256-GCM).  Generate one with: openssl rand -hex 32
WEBHOOK_SECRET_KEY=REPLACE_ME_WITH_A_STRONG_RANDOM_SECRET

# REQUIRED: Salt used when deriving the AES key from WEBHOOK_SECRET_KEY via
# scrypt.  Generate one with: openssl rand -hex 16
WEBHOOK_ENCRYPTION_SALT=REPLACE_ME_WITH_A_UNIQUE_RANDOM_SALT

# Only while rotating the encryption key: the old key and salt. Remove them
# once the log reports "Key rotation complete".
# WEBHOOK_SECRET_KEY_PREVIOUS=
# WEBHOOK_ENCRYPTION_SALT_PREVIOUS=

# ─── Rate Limiting ─────────────────────────────────────────────────────────────
THROTTLE_TTL=60000
THROTTLE_LIMIT=100

# ─── Redis (optional) ──────────────────────────────────────────────────────────
# Set REDIS_URL to enable the Redis cache layer. Leave unset to run without Redis.
# REDIS_URL=redis://localhost:6379

# Redis Sentinel support (comma-separated host:port pairs)
# REDIS_SENTINEL_HOSTS=sentinel1:26379,sentinel2:26379,sentinel3:26379
# REDIS_SENTINEL_NAME=mymaster

# Session store backend: "database" (default) or "redis"
# SESSION_STORE=database

# ─── Reverse proxy / trusted proxies ──────────────────────────────────────────
# TRUSTED_PROXIES=10.0.0.1,172.16.0.0/12
```

---

## Generating Secure Values

Use the following commands to generate secure random values:

```bash
# Generate a 32-byte random key (for ADMIN_API_KEY, WEBHOOK_SECRET_KEY)
openssl rand -hex 32

# Generate a 16-byte random salt (for WEBHOOK_ENCRYPTION_SALT)
openssl rand -hex 16
```

---

## Next Steps

<div style={{display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem', marginTop: '2rem'}}>

[**Configuration Guide**](/getting-started/configuration)
Configure Idenplane for your environment

[**Installation**](/getting-started/installation)
Detailed installation instructions

[**Deployment**](/deployment/docker)
Deploy to production with Docker

</div>

---

<p align="center">
  <a href="https://idenplane.com">idenplane.com</a> &middot;
  <a href="https://github.com/idenplane/idenplane">GitHub</a> &middot;
  <a href="https://discord.gg/idenplane">Discord</a>
</p>