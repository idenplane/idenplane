#!/bin/sh
set -e

# ── NODE_ENV ───────────────────────────────────────────────────────────────────
# Default to production when the variable is absent so that the application
# never starts in an unintentionally permissive mode.
if [ -z "$NODE_ENV" ]; then
  echo "WARNING: NODE_ENV is not set — defaulting to 'production'"
  NODE_ENV=production
  export NODE_ENV
fi

# ── Required environment variables ────────────────────────────────────────────
if [ -z "$DATABASE_URL" ]; then
  echo ""
  echo "============================================"
  echo "  ERROR: DATABASE_URL is not set"
  echo "============================================"
  echo ""
  echo "  Idenplane requires PostgreSQL to run."
  echo "  Use docker compose instead of docker run:"
  echo ""
  echo "  1. Create a docker-compose.yml (see README)"
  echo "  2. Run: docker compose up -d"
  echo ""
  echo "  Or provide DATABASE_URL manually:"
  echo "  docker run -e DATABASE_URL=postgresql://user:pass@host:5432/idenplane islamawad/idenplane"
  echo ""
  echo "============================================"
  exit 1
fi

# ── Block startup when sensitive variables use insecure defaults ──────────────

# ADMIN_API_KEY unset in production — block startup
if [ -z "$ADMIN_API_KEY" ]; then
  if [ "$NODE_ENV" = "production" ]; then
    echo ""
    echo "============================================"
    echo "  ERROR: ADMIN_API_KEY is not set"
    echo "============================================"
    echo ""
    echo "  The admin API requires a strong, randomly"
    echo "  generated secret.  Refusing to start in"
    echo "  production without ADMIN_API_KEY set."
    echo ""
    echo "  Generate a secure key with:"
    echo "  openssl rand -base64 32"
    echo ""
    echo "============================================"
    exit 1
  fi
  echo ""
  echo "============================================"
  echo "  WARNING: ADMIN_API_KEY is not set"
  echo "============================================"
  echo ""
  echo "  The admin API will be unprotected or use a"
  echo "  default key.  Set ADMIN_API_KEY to a strong,"
  echo "  randomly generated secret before exposing"
  echo "  this instance to a network."
  echo ""
  echo "============================================"
  echo ""
fi

if [ "$ADMIN_API_KEY" = "changeme" ]; then
  if [ "$NODE_ENV" = "production" ]; then
    echo ""
    echo "============================================"
    echo "  ERROR: ADMIN_API_KEY is set to the"
    echo "  insecure default value 'changeme'"
    echo "============================================"
    echo ""
    echo "  Change ADMIN_API_KEY to a strong, randomly"
    echo "  generated secret before exposing this"
    echo "  instance to a network."
    echo ""
    echo "  Generate a secure key with:"
    echo "  openssl rand -base64 32"
    echo ""
    echo "============================================"
    exit 1
  fi
  echo ""
  echo "============================================"
  echo "  WARNING: ADMIN_API_KEY is set to the"
  echo "  insecure default value 'changeme'"
  echo "============================================"
  echo ""
  echo "  Change ADMIN_API_KEY to a strong, randomly"
  echo "  generated secret before exposing this"
  echo "  instance to a network."
  echo ""
  echo "============================================"
  echo ""
fi

if [ "$ADMIN_PASSWORD" = "admin" ]; then
  if [ "$NODE_ENV" = "production" ]; then
    echo ""
    echo "============================================"
    echo "  ERROR: ADMIN_PASSWORD is set to the"
    echo "  weak default value 'admin'"
    echo "============================================"
    echo ""
    echo "  Change ADMIN_PASSWORD to a strong password"
    echo "  before exposing this instance to a network."
    echo ""
    echo "============================================"
    exit 1
  fi
  echo ""
  echo "============================================"
  echo "  WARNING: ADMIN_PASSWORD is set to the"
  echo "  weak default value 'admin'"
  echo "============================================"
  echo ""
  echo "  Change ADMIN_PASSWORD to a strong password"
  echo "  before exposing this instance to a network."
  echo ""
  echo "============================================"
  echo ""
fi

echo "Running Prisma migrations..."
# Prisma 7 requires prisma.config.ts with both schema path AND datasource URL.
# The production image has no TypeScript compiler, so we generate a JS equivalent.
if [ ! -f prisma.config.js ]; then
  cat > prisma.config.js << JSEOF
const { defineConfig } = require('prisma/config');
module.exports = defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: { url: process.env.DATABASE_URL },
});
JSEOF
fi

npx prisma migrate deploy

echo "Starting Idenplane..."
exec node dist/main.js
