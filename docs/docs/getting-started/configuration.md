---
id: configuration
title: Configuration
sidebar_position: 2
description: Complete reference for all Idenplane configuration options and environment variables.
---

# Configuration

Idenplane is configured through environment variables. This guide covers the main ones; the full reference is [Environment Variables](../configuration/environment-variables.md).

---

## Core Settings

### Database

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `DATABASE_URL` | — | Yes | PostgreSQL connection string |

Idenplane runs on PostgreSQL 16 or later:

```bash
DATABASE_URL=postgresql://idenplane:idenplane@localhost:5432/idenplane
```

### Server

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `PORT` | `3000` | No | Server port |
| `NODE_ENV` | `development` | No | Environment: `development`, `production` |
| `BASE_URL` | `http://localhost:3000` | No | Public URL for redirects and emails |

```bash
PORT=3000
NODE_ENV=production
BASE_URL=https://auth.example.com
```

---

## Security Settings

:::warning
The following variables are **required in production**. Startup will be blocked if you use placeholder values.
:::

### API Authentication

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `ADMIN_API_KEY` | — | Yes (prod) | API key for admin endpoints. In production at least 32 characters and not a placeholder, or the server exits at startup |
| `ADMIN_USER` | `admin` | No | Initial admin username |
| `ADMIN_PASSWORD` | None (generated) | Yes (prod) | Initial admin password. There is no default: outside production an unset value gets a random password, printed once in the first start's log. `admin` and placeholders are refused. See [How the first admin password is chosen](../configuration/environment-variables.md#how-the-first-admin-password-is-chosen) |

```bash
# Generate a secure API key
ADMIN_API_KEY=$(openssl rand -hex 32)
```

### Webhook Encryption

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `WEBHOOK_SECRET_KEY` | — | Yes (prod) | Key from which the AES-256-GCM key for every stored secret is derived (not only webhooks) |
| `WEBHOOK_ENCRYPTION_SALT` | — | Yes (prod) | 16-byte salt for key derivation |

```bash
# Generate webhook encryption key
WEBHOOK_SECRET_KEY=$(openssl rand -hex 32)

# Generate encryption salt
WEBHOOK_ENCRYPTION_SALT=$(openssl rand -hex 16)
```

:::warning
If `WEBHOOK_SECRET_KEY` or `WEBHOOK_ENCRYPTION_SALT` is simply replaced, every stored secret becomes unreadable and Idenplane refuses to start. To change them, follow [Rotating the encryption key](../deployment/production.md#rotating-the-encryption-key).
:::

---

## Redis (Optional)

Redis is optional but recommended for production deployments with multiple instances.

### Basic Configuration

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `REDIS_URL` | — | No | Redis connection string (e.g., `redis://localhost:6379`) |

```bash
REDIS_URL=redis://localhost:6379
```

### Redis Sentinel (High Availability)

For Redis Sentinel deployments:

```bash
# Comma-separated Sentinel host:port pairs
REDIS_SENTINEL_HOSTS=sentinel1:26379,sentinel2:26379,sentinel3:26379

# Sentinel master name
REDIS_SENTINEL_NAME=mymaster
```

### Session Storage

| Variable | Default | Description |
|----------|---------|-------------|
| `SESSION_STORE` | `database` | Session backend: `database` or `redis` |

```bash
# Use Redis for session storage
SESSION_STORE=redis
```

---

## Rate Limiting

Control request throttling to prevent abuse.

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `THROTTLE_TTL` | `60000` | No | Rate limit window in milliseconds |
| `THROTTLE_LIMIT` | `100` | No | Maximum requests per window |

```bash
# 1 minute window, 100 requests max
THROTTLE_TTL=60000
THROTTLE_LIMIT=100
```

---

## Reverse Proxy Settings

When Idenplane sits behind a reverse proxy (nginx, Cloudflare, load balancer), configure trusted proxies for proper client IP resolution.

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `TRUSTED_PROXIES` | — | No | Comma-separated trusted proxy IPs or CIDR blocks |

```bash
# Trust specific proxies (IPv4/IPv6 addresses, CIDR blocks, or loopback / linklocal / uniquelocal)
TRUSTED_PROXIES=10.0.0.1,172.16.0.0/12

# Trust one hop: the proxy directly in front of the app (only if nothing else can reach it)
TRUSTED_PROXIES=*
```

The client address is read from `X-Forwarded-For` **from the right**: each proxy appends the address it saw, and anything to the left of the entries your proxies added was written by the client. With a list, every hop inside it is skipped and the first one outside it is the client. With `*`, the immediate peer is taken to be the only proxy, and the client is the last entry it appended. For a chain of proxies (a CDN in front of a load balancer, for example), list them rather than using `*`. Rate limits, audit logs and risk signals all use this address.

:::warning
Setting `TRUSTED_PROXIES=*` is only safe when the network layer prevents direct public access to the app process.
:::

---

## Example Production Configuration

Here's a complete production `.env` file:

```bash
# ─── Database ──────────────────────────────────────────────────────────────────
# PostgreSQL 16+ (the only supported database):
DATABASE_URL=postgresql://idenplane:secure_password@db.example.com:5432/idenplane

# ─── Server ────────────────────────────────────────────────────────────────────
PORT=3000
NODE_ENV=production
BASE_URL=https://auth.example.com

# ─── Security (REQUIRED) ───────────────────────────────────────────────────────
# Generate with: openssl rand -hex 32 (production needs 32+ characters)
ADMIN_API_KEY=REPLACE_ME_WITH_A_STRONG_RANDOM_SECRET

# Required on the first production start (12+ characters)
# Generate with: openssl rand -hex 16
ADMIN_PASSWORD=REPLACE_ME_WITH_A_STRONG_PASSWORD

# Generate with: openssl rand -hex 32
WEBHOOK_SECRET_KEY=your_webhook_secret_key_here

# Generate with: openssl rand -hex 16
WEBHOOK_ENCRYPTION_SALT=your_encryption_salt_here

# ─── Redis ─────────────────────────────────────────────────────────────────────
REDIS_URL=redis://redis.example.com:6379
SESSION_STORE=redis

# ─── Rate Limiting ─────────────────────────────────────────────────────────────
THROTTLE_TTL=60000
THROTTLE_LIMIT=100

# ─── Reverse Proxy ─────────────────────────────────────────────────────────────
TRUSTED_PROXIES=10.0.0.1,172.16.0.0/12
```

---

## Environment Variable Reference

### Main Variables

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `DATABASE_URL` | — | Yes | PostgreSQL connection string |
| `PORT` | `3000` | No | Server port |
| `NODE_ENV` | `development` | No | Environment mode |
| `BASE_URL` | `http://localhost:3000` | No | Public URL for redirects |
| `ADMIN_API_KEY` | — | Yes (prod) | Admin API key |
| `ADMIN_USER` | `admin` | No | Initial admin username |
| `ADMIN_PASSWORD` | None (generated) | Yes (prod) | Initial admin password; never defaults to `admin` |
| `WEBHOOK_SECRET_KEY` | — | Yes (prod) | Key for the encryption of stored secrets |
| `WEBHOOK_ENCRYPTION_SALT` | — | Yes (prod) | Key derivation salt |
| `REDIS_URL` | — | No | Redis connection string |
| `REDIS_SENTINEL_HOSTS` | — | No | Comma-separated Sentinel nodes |
| `REDIS_SENTINEL_NAME` | `mymaster` | No | Sentinel master name |
| `SESSION_STORE` | `database` | No | `database` or `redis` |
| `THROTTLE_TTL` | `60000` | No | Rate limit window (ms) |
| `THROTTLE_LIMIT` | `100` | No | Max requests per window |
| `TRUSTED_PROXIES` | — | No | Trusted proxy IPs/CIDR |

---

## Configuration via Admin Console

Most settings can also be configured through the Admin Console at `/console`:

- **Realm Settings** — Email, themes, security options
- **User Management** — Password policies, brute force protection
- **Client Settings** — OAuth clients, redirects, scopes
- **SMTP Configuration** — Email templates and delivery

---

## Next Steps

<div style={{display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem', marginTop: '2rem'}}>

[**Deployment**](/deployment/docker)
Deploy Idenplane to production with Docker

[**First Application**](/guides/first-app)
Register your first OAuth client

[**SDK Guides**](/guides/sdks/react-sdk)
Integrate Idenplane with your application

</div>

---

<p align="center">
  <a href="https://idenplane.com">idenplane.com</a> &middot;
  <a href="https://github.com/idenplane/idenplane">GitHub</a> &middot;
  <a href="https://discord.gg/idenplane">Discord</a>
</p>