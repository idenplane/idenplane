#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/use-mysql.sh
#
# Activates the MySQL / MariaDB Prisma schema.
#
# What it does:
#   1. Backs up the current prisma/schema.prisma → prisma/schema.prisma.bak
#   2. Copies prisma/schema.mysql.prisma → prisma/schema.prisma
#   3. Prints next steps.
#
# Usage:
#   ./scripts/use-mysql.sh
#
# To revert back to PostgreSQL:
#   git checkout prisma/schema.prisma
#   (or: cp prisma/schema.prisma.bak prisma/schema.prisma)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCHEMA_SRC="${REPO_ROOT}/prisma/schema.mysql.prisma"
SCHEMA_DEST="${REPO_ROOT}/prisma/schema.prisma"
SCHEMA_BAK="${REPO_ROOT}/prisma/schema.prisma.bak"

echo "Activating MySQL schema..."

# Verify the source schema exists
if [[ ! -f "${SCHEMA_SRC}" ]]; then
  echo "ERROR: ${SCHEMA_SRC} not found." >&2
  exit 1
fi

# Back up the current active schema
if [[ -f "${SCHEMA_DEST}" ]]; then
  cp "${SCHEMA_DEST}" "${SCHEMA_BAK}"
  echo "  Backed up current schema → prisma/schema.prisma.bak"
fi

# Install the MySQL schema
cp "${SCHEMA_SRC}" "${SCHEMA_DEST}"
echo "  Copied schema.mysql.prisma → prisma/schema.prisma"

# Update migration_lock.toml to match the target provider
LOCK_FILE="${REPO_ROOT}/prisma/migrations/migration_lock.toml"
if [[ -f "${LOCK_FILE}" ]]; then
  sed -i 's/^provider = .*/provider = "mysql"/' "${LOCK_FILE}"
  echo "  Updated migration_lock.toml provider → mysql"
fi

echo ""
echo "Done. Next steps:"
echo ""
echo "  1. Set DATABASE_URL in your .env file:"
echo '     DATABASE_URL="mysql://user:pass@localhost:3306/idenplane"'
echo ""
echo "  2. Ensure your MySQL server uses the utf8mb4 character set:"
echo "     CREATE DATABASE idenplane CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
echo ""
echo "  3. Run migrations:"
echo "     npx prisma migrate dev --name init"
echo ""
echo "  4. (Optional) Seed the database:"
echo "     npx ts-node prisma/seed.ts"
echo ""
echo "To revert to PostgreSQL:"
echo "  git checkout prisma/schema.prisma"
echo "  # or: cp prisma/schema.prisma.bak prisma/schema.prisma"
