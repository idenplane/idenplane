---
id: quickstart
title: Quickstart
description: Generate unique local credentials and start Idenplane with Docker Compose.
---

# Quickstart

Generate local credentials, start the services and wait for readiness.

---

## Docker Hub (Recommended)

Requires Docker Compose v2.20+ and Node.js 24 for the setup helper. On Windows use `curl.exe` instead of `curl`:

```bash
curl --fail --location -o docker-compose.yml https://raw.githubusercontent.com/idenplane/idenplane/main/docker-compose.yml
curl --fail --location -o setup-env.cjs https://raw.githubusercontent.com/idenplane/idenplane/main/scripts/setup-env.cjs
node setup-env.cjs
docker compose up -d --wait --wait-timeout 180
```

Once the services are healthy, open:

| URL | Description |
|-----|-------------|
| http://localhost:3000/console | Admin Console |
| http://localhost:3000/api | Swagger API Docs |
| http://localhost:3000/health/live | Health Check |
| http://localhost:3000/metrics | Prometheus Metrics |

### Generated Credentials

Sign in with the credentials generated in your local `.env` file:

| Field | Value |
|-------|-------|
| Username | `admin` |
| Password | Value of `ADMIN_PASSWORD` in `.env` |
| API Key | Value of `ADMIN_API_KEY` in your `.env` file |

:::warning
Keep `.env` private and back it up: changing its webhook encryption keys makes stored webhook secrets unreadable. The helper never overwrites an existing file. Changing POSTGRES_PASSWORD in `.env` does not rotate a password in an existing database. Local services bind to localhost; configure HTTPS, backups and a pinned release image before production use.
:::

---

## What's Next?

<div style={{display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem', marginTop: '2rem'}}>

[**Installation Guide**](/getting-started/installation)
Detailed installation instructions for Docker, Kubernetes, and bare metal

[**Admin Console**](/getting-started/admin-console)
Learn how to configure realms, users, and clients

[**First Application**](/guides/first-app)
Register your first OAuth client and integrate with your app

</div>

---

## From Source

If you prefer to build from source, you'll need:

**Prerequisites:** Node.js 24, PostgreSQL 16+

```bash
git clone https://github.com/idenplane/idenplane.git
cd idenplane

# Install dependencies
npm install
cd admin-ui && npm install && cd ..

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

## Development Mode

For local development with hot-reload:

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

## Troubleshooting

### Container fails to start

Check the logs:
```bash
docker compose logs idenplane
```

Ensure port 3000 is not already in use:
```bash
lsof -i :3000
```

### Cannot connect to database

If using an external PostgreSQL instance, verify your `DATABASE_URL` in `.env`:
```
DATABASE_URL=postgresql://user:password@host:5432/idenplane
```

### Health check fails

Wait 10-15 seconds for the server to fully initialize, then check:
```bash
curl http://localhost:3000/health/ready
```

---

## Horizontal Scaling

Idenplane is fully stateless — all state is stored in PostgreSQL (and optionally Redis). Scale horizontally:

```bash
# Using the cluster compose file (2 instances + Nginx LB)
docker compose -f docker-compose.cluster.yml up -d

# Or scale manually
docker compose up -d --scale app=3
```

For production clusters, enable Redis for shared session storage:

```bash
SESSION_STORE=redis
REDIS_URL=redis://your-redis:6379
```

---

<p align="center">
  <a href="https://idenplane.com">idenplane.com</a> &middot;
  <a href="https://github.com/idenplane/idenplane">GitHub</a> &middot;
  <a href="https://discord.gg/idenplane">Discord</a>
</p>
