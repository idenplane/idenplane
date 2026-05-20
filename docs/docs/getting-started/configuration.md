---
id: configuration
title: Configuration
sidebar_position: 2
description: Complete reference for all Idenplane configuration options and environment variables.
---

# Configuration

Idenplane is configured through environment variables. This guide covers all available options.

---

## Core Settings

### Database

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `DATABASE_URL` | — | Yes | PostgreSQL/MySQL/SQLite connection string |
| `DATABASE_URL` | `file:./dev.db` | No | SQLite file path (development only) |

Idenplane supports three database providers:

```bash
# PostgreSQL (recommended for production)
DATABASE_URL=postgresql://idenplane:idenplane@localhost:5432/idenplane

# MySQL 8+ / MariaDB 10.5+
DATABASE_URL=mysql://idenplane:idenplane@localhost:3306/idenplane

# SQLite (development / CI only)
DATABASE_URL=file:./dev.db
```

:::tip
Switch databases using the provided scripts:
- `./scripts/use-mysql.sh` — Configure for MySQL
- `./scripts/use-sqlite.sh` — Configure for SQLite
:::

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
| `ADMIN_API_KEY` | — | Yes (prod) | API key for admin endpoints (32+ characters) |
| `ADMIN_USER` | `admin` | No | Initial admin username |
| `ADMIN_PASSWORD` | `admin` | No | Initial admin password |

```bash
# Generate a secure API key
ADMIN_API_KEY=$(openssl rand -hex 32)
```

### Webhook Encryption

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `WEBHOOK_SECRET_KEY` | — | Yes (prod) | 32-byte AES-256-GCM key for encrypting webhook secrets |
| `WEBHOOK_ENCRYPTION_SALT` | — | Yes (prod) | 16-byte salt for key derivation |

```bash
# Generate webhook encryption key
WEBHOOK_SECRET_KEY=$(openssl rand -hex 32)

# Generate encryption salt
WEBHOOK_ENCRYPTION_SALT=$(openssl rand -hex 16)
```

:::warning
If `WEBHOOK_SECRET_KEY` changes, all stored webhook secrets become unreadable. Rotate with care.
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
# Trust specific proxies
TRUSTED_PROXIES=10.0.0.1,172.16.0.0/12

# Trust all proxies (only if network prevents direct access)
TRUSTED_PROXIES=*
```

:::warning
Setting `TRUSTED_PROXIES=*` is only safe when the network layer prevents direct public access to the app process.
:::

---

## Example Production Configuration

Here's a complete production `.env` file:

```bash
# ─── Database ──────────────────────────────────────────────────────────────────
# PostgreSQL (recommended for production):
DATABASE_URL=postgresql://idenplane:secure_password@db.example.com:5432/idenplane

# ─── Server ────────────────────────────────────────────────────────────────────
PORT=3000
NODE_ENV=production
BASE_URL=https://auth.example.com

# ─── Security (REQUIRED) ───────────────────────────────────────────────────────
# Generate with: openssl rand -hex 32
ADMIN_API_KEY=your_secure_admin_api_key_here

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

### Complete List

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `DATABASE_URL` | — | Yes | PostgreSQL/MySQL/SQLite connection string |
| `PORT` | `3000` | No | Server port |
| `NODE_ENV` | `development` | No | Environment mode |
| `BASE_URL` | `http://localhost:3000` | No | Public URL for redirects |
| `ADMIN_API_KEY` | — | Yes (prod) | Admin API key |
| `ADMIN_USER` | `admin` | No | Initial admin username |
| `ADMIN_PASSWORD` | `admin` | No | Initial admin password |
| `WEBHOOK_SECRET_KEY` | — | Yes (prod) | AES-256-GCM webhook encryption key |
| `WEBHOOK_ENCRYPTION_SALT` | — | Yes (prod) | Key derivation salt |
| `REDIS_URL` | — | No | Redis connection string |
| `REDIS_SENTINEL_HOSTS` | — | No | Comma-separated Sentinel nodes |
| `REDIS_SENTINEL_NAME` | — | No | Sentinel master name |
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

[**Deployment**](/docs/deployment/docker)
Deploy Idenplane to production with Docker

[**First Application**](/docs/guides/first-app)
Register your first OAuth client

[**SDK Guides**](/docs/guides/sdks/react)
Integrate Idenplane with your application

</div>

---

<p align="center">
  <a href="https://idenplane.dev">idenplane.dev</a> &middot;
  <a href="https://github.com/idenplane/idenplane">GitHub</a> &middot;
  <a href="https://discord.gg/idenplane">Discord</a>
</p>