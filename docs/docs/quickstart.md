---
id: quickstart
title: Quickstart
description: Get Idenplane up and running in under 30 seconds with Docker Compose.
---

# Quickstart

Get Idenplane up and running in under 30 seconds.

---

## Docker Hub (Recommended)

The fastest way to get started is with Docker Compose:

```bash
curl -o docker-compose.yml https://raw.githubusercontent.com/Islamawad132/Authme/main/docker-compose.yml
docker compose up -d
```

That's it. Idenplane is now running:

| URL | Description |
|-----|-------------|
| http://localhost:3000/console | Admin Console |
| http://localhost:3000/api | Swagger API Docs |
| http://localhost:3000/health/live | Health Check |
| http://localhost:3000/metrics | Prometheus Metrics |

### Default Credentials

After starting Idenplane, you can access the Admin Console with these default credentials:

| Field | Value |
|-------|-------|
| Username | `admin` |
| Password | `admin` |
| API Key | Value of `ADMIN_API_KEY` in your `.env` file |

:::warning
**Important:** Change the default password and API key before exposing Idenplane to the internet. You can update these in the Admin Console under **Realm Settings > User Management**.
:::

---

## What's Next?

<div style={{display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem', marginTop: '2rem'}}>

[**Installation Guide**](/docs/getting-started/installation)
Detailed installation instructions for Docker, Kubernetes, and bare metal

[**Admin Console**](/docs/getting-started/admin-console)
Learn how to configure realms, users, and clients

[**First Application**](/docs/guides/first-app)
Register your first OAuth client and integrate with your app

</div>

---

## From Source

If you prefer to build from source, you'll need:

**Prerequisites:** Node.js 22+, PostgreSQL 16+

```bash
git clone https://github.com/Islamawad132/Authme.git
cd Authme

# Install dependencies
npm install
cd admin-ui && npm install && cd ..

# Configure
cp .env.example .env
# Edit .env with your DATABASE_URL

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
  <a href="https://idenplane.dev">idenplane.dev</a> &middot;
  <a href="https://github.com/Islamawad132/Authme">GitHub</a> &middot;
  <a href="https://discord.gg/idenplane">Discord</a>
</p>
