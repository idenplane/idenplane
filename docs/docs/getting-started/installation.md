---
id: installation
title: Installation
sidebar_position: 1
description: Learn how to install Idenplane using Docker, Docker Compose, or from source.
---

# Installation

Idenplane supports multiple installation methods to fit your environment and workflow.

---

## Prerequisites

Before installing Idenplane, ensure you have:

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| **Docker** | 20.10+ | 24.x+ |
| **Docker Compose** | 2.0+ | 2.20+ |
| **Database** | PostgreSQL 14 | PostgreSQL 16 |
| **RAM** | 512 MB | 2 GB |
| **Disk** | 1 GB | 10 GB |

:::tip
For local development, SQLite is supported without requiring a separate database server. See [From Source](#from-source) below.
:::

---

## Docker Hub (Recommended)

The fastest way to get started is using our pre-built Docker image from Docker Hub:

```bash
# Pull and run with default settings
docker pull islamawad/idenplane:latest

# Start with Docker Compose
curl -o docker-compose.yml https://raw.githubusercontent.com/idenplane/idenplane/main/docker-compose.yml
docker compose up -d
```

### Environment Configuration

Create a `.env` file for customization:

```bash
# Database configuration
DATABASE_URL=postgresql://idenplane:idenplane@localhost:5432/idenplane

# Server settings
PORT=3000
NODE_ENV=production
BASE_URL=https://auth.example.com

# Security (REQUIRED in production)
ADMIN_API_KEY=REPLACE_ME_WITH_A_STRONG_RANDOM_SECRET
WEBHOOK_SECRET_KEY=REPLACE_ME_WITH_A_STRONG_RANDOM_SECRET
WEBHOOK_ENCRYPTION_SALT=REPLACE_ME_WITH_A_UNIQUE_RANDOM_SALT
```

:::warning
Never use the placeholder values in production. Generate secure secrets using:

```bash
# Generate a secure API key
openssl rand -hex 32

# Generate webhook encryption key
openssl rand -hex 32

# Generate encryption salt
openssl rand -hex 16
```
:::

---

## Docker Compose

Create a production-ready `docker-compose.yml`:

```yaml
version: '3.8'

services:
  idenplane:
    image: islamawad/idenplane:latest
    container_name: idenplane
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgresql://idenplane:idenplane@db:5432/idenplane
      - PORT=3000
      - NODE_ENV=production
      - BASE_URL=http://localhost:3000
      - ADMIN_API_KEY=${ADMIN_API_KEY}
      - WEBHOOK_SECRET_KEY=${WEBHOOK_SECRET_KEY}
      - WEBHOOK_ENCRYPTION_SALT=${WEBHOOK_ENCRYPTION_SALT}
    depends_on:
      db:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health/live"]
      interval: 30s
      timeout: 10s
      retries: 3

  db:
    image: postgres:16-alpine
    container_name: idenplane-db
    restart: unless-stopped
    environment:
      - POSTGRES_USER=idenplane
      - POSTGRES_PASSWORD=idenplane
      - POSTGRES_DB=idenplane
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U idenplane"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
```

Start the stack:

```bash
docker compose up -d
```

---

## From Source

For development or custom deployments, build from source.

### Prerequisites

| Requirement | Version |
|-------------|---------|
| **Node.js** | 22.x LTS |
| **npm** | 10.x+ |
| **PostgreSQL** | 16+ |

### Installation Steps

1. **Clone the repository:**

   ```bash
   git clone https://github.com/idenplane/idenplane.git
   cd Idenplane
   ```

2. **Install dependencies:**

   ```bash
   npm install
   cd admin-ui && npm install && cd ..
   ```

3. **Configure environment:**

   ```bash
   cp .env.example .env
   # Edit .env with your settings
   ```

4. **Setup database:**

   ```bash
   # Generate Prisma client
   npm run prisma:generate

   # Run migrations
   npm run prisma:migrate

   # Optional: Seed with sample data
   npm run prisma:seed
   ```

5. **Build and start:**

   ```bash
   # Build all packages
   npm run build:all

   # Start in production mode
   npm run start:prod
   ```

### Development Mode

For active development with hot-reload:

```bash
# Start PostgreSQL via Docker
docker compose up db -d

# Start backend in watch mode
npm run start:dev

# Start admin UI (separate terminal)
npm run admin:dev
```

---

## Database Options

Idenplane supports multiple database providers:

### PostgreSQL (Recommended)

```bash
DATABASE_URL=postgresql://idenplane:idenplane@localhost:5432/idenplane
```

PostgreSQL is recommended for production deployments.

### MySQL / MariaDB

```bash
# Before switching, run the conversion script
./scripts/use-mysql.sh

DATABASE_URL=mysql://idenplane:idenplane@localhost:3306/idenplane
```

Requires MySQL 8+ or MariaDB 10.5+.

### SQLite (Development Only)

```bash
# Before switching, run the conversion script
./scripts/use-sqlite.sh

DATABASE_URL=file:./dev.db
```

:::warning
SQLite is intended for development and CI only. It does not support production workloads with concurrent connections.
:::

---

## Verifying Installation

After starting Idenplane, verify the installation:

| Endpoint | Description | Expected Response |
|----------|-------------|------------------|
| http://localhost:3000/health/live | Liveness check | `{"status":"ok"}` |
| http://localhost:3000/health/ready | Readiness check | `{"status":"ok"}` |
| http://localhost:3000/console | Admin Console | Login page |
| http://localhost:3000/api | Swagger API Docs | API documentation |

### Default Credentials

| Field | Default Value | Note |
|-------|---------------|------|
| Username | `admin` | Change immediately |
| Password | `admin` | Change immediately |
| API Key | Value from `ADMIN_API_KEY` env | Generated by you |

---

## Next Steps

<div style={{display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem', marginTop: '2rem'}}>

[**Configuration**](/docs/getting-started/configuration)
Learn about all configuration options and environment variables

[**Quickstart**](/docs/quickstart)
Get started with Idenplane authentication in your first application

[**Admin Console**](/docs/getting-started/admin-console)
Configure realms, users, and clients

</div>

---

<p align="center">
  <a href="https://idenplane.dev">idenplane.dev</a> &middot;
  <a href="https://github.com/idenplane/idenplane">GitHub</a> &middot;
  <a href="https://discord.gg/idenplane">Discord</a>
</p>