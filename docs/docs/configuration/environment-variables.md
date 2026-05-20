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
| `DATABASE_URL` | — | Yes | PostgreSQL/MySQL/SQLite connection string |
| `PORT` | `3000` | No | Server port |
| `NODE_ENV` | `development` | No | Environment: `development`, `production` |
| `BASE_URL` | `http://localhost:3000` | No | Public URL for redirects and emails |
| `ADMIN_API_KEY` | — | Yes (prod) | API key for admin endpoints |
| `WEBHOOK_SECRET_KEY` | — | Yes (prod) | AES-256-GCM key for webhook secrets |
| `WEBHOOK_ENCRYPTION_SALT` | — | Yes (prod) | Salt for webhook key derivation |
| `REDIS_URL` | — | No | Redis connection string |
| `SESSION_STORE` | `database` | No | Session backend: `database` or `redis` |
| `THROTTLE_TTL` | `60000` | No | Rate limit window (ms) |
| `THROTTLE_LIMIT` | `100` | No | Max requests per window |
| `TRUSTED_PROXIES` | — | No | Trusted proxy IPs or CIDR blocks |

---

## Database

Idenplane supports three database providers. Set `DATABASE_URL` to the connection string matching your environment.

### Supported Providers

| Provider | Recommended For | Notes |
|----------|-----------------|-------|
| **PostgreSQL 16+** | Production | Recommended. Full feature set, excellent performance. |
| **MySQL 8+ / MariaDB 10.5+** | Production | Alternative to PostgreSQL. Run `./scripts/use-mysql.sh` first. |
| **SQLite** | Development / CI | No database server needed. Run `./scripts/use-sqlite.sh` first. |

### Connection Strings

```bash
# PostgreSQL (recommended for production)
DATABASE_URL=postgresql://idenplane:idenplane@localhost:5432/idenplane

# MySQL 8+ / MariaDB 10.5+
DATABASE_URL=mysql://idenplane:idenplane@localhost:3306/idenplane

# SQLite (development / CI only)
DATABASE_URL=file:./dev.db
```

:::tip
Before switching databases, use the provided scripts to update your configuration:
- `./scripts/use-mysql.sh` — Configure for MySQL
- `./scripts/use-sqlite.sh` — Configure for SQLite
:::

---

## Server

Control the server's network and runtime settings.

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `PORT` | `3000` | No | Port the server listens on |
| `NODE_ENV` | `development` | No | Environment: `development`, `production`, `test` |
| `BASE_URL` | `http://localhost:3000` | No | Public URL used for redirects, emails, and OAuth callbacks |

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
| `ADMIN_PASSWORD` | `admin` | No | Initial admin password (only used on first run) |

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
| `WEBHOOK_SECRET_KEY` | — | Yes (prod) | 32-byte (or longer) AES-256-GCM key for encrypting webhook secrets at rest |
| `WEBHOOK_ENCRYPTION_SALT` | — | Yes (prod) | 16-byte salt used when deriving the AES key via scrypt |

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
If `WEBHOOK_SECRET_KEY` changes, all stored webhook secrets become unreadable. Always backup your existing key before rotating.
:::

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

[**Configuration Guide**](/docs/getting-started/configuration)
Configure Idenplane for your environment

[**Installation**](/docs/getting-started/installation)
Detailed installation instructions

[**Deployment**](/docs/deployment/docker)
Deploy to production with Docker

</div>

---

<p align="center">
  <a href="https://idenplane.dev">idenplane.dev</a> &middot;
  <a href="https://github.com/Islamawad132/Authme">GitHub</a> &middot;
  <a href="https://discord.gg/idenplane">Discord</a>
</p>