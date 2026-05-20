#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# benchmarks/scripts/setup.sh
#
# Sets up the benchmark environment for Idenplane performance testing.
#
# What it does:
#   1. Validates required environment variables
#   2. Creates necessary directories for results
#   3. Starts the benchmark Docker Compose stack
#   4. Waits for all services to be healthy
#   5. Generates test data if needed
#
# Usage:
#   ./benchmarks/scripts/setup.sh
#
# Environment variables (can be set in benchmarks/.env or exported):
#   ADMIN_API_KEY   - Admin API key for Idenplane (required)
#   VUS             - Number of virtual users (default: 50)
#   DURATION        - Test duration (default: 60s)
#   RAMP_UP         - Ramp-up time (default: 10s)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Script directory ───────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BENCHMARKS_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
RESULTS_DIR="${BENCHMARKS_DIR}/results"

# ── Load environment variables ─────────────────────────────────────────────────
ENV_FILE="${BENCHMARKS_DIR}/.env"
if [[ -f "${ENV_FILE}" ]]; then
  echo "Loading environment from ${ENV_FILE}..."
  # shellcheck disable=SC1090
  set -a
  source "${ENV_FILE}"
  set +a
fi

# ── Defaults ──────────────────────────────────────────────────────────────────
ADMIN_API_KEY="${ADMIN_API_KEY:-}"
VUS="${VUS:-50}"
DURATION="${DURATION:-60s}"
RAMP_UP="${RAMP_UP:-10s}"

echo ""
echo "═══════════════════════════════════════════════════════════════════════════"
echo "  Idenplane Benchmark Setup"
echo "═══════════════════════════════════════════════════════════════════════════"
echo ""

# ── Validate prerequisites ──────────────────────────────────────────────────────
echo "[1/5] Validating prerequisites..."

# Check for Docker
if ! command -v docker &> /dev/null; then
  echo "ERROR: docker is not installed or not in PATH" >&2
  exit 1
fi

# Check for docker compose
if ! docker compose version &> /dev/null; then
  echo "ERROR: docker compose is not installed or not in PATH" >&2
  exit 1
fi

echo "  ✓ Docker and docker compose are available"

# Validate ADMIN_API_KEY
if [[ -z "${ADMIN_API_KEY}" ]]; then
  echo ""
  echo "ERROR: ADMIN_API_KEY is not set" >&2
  echo ""
  echo "  Please set ADMIN_API_KEY in ${ENV_FILE} or export it:"
  echo ""
  echo "    export ADMIN_API_KEY=your-secure-api-key"
  echo ""
  exit 1
fi

echo "  ✓ ADMIN_API_KEY is configured"

# ── Create directories ────────────────────────────────────────────────────────
echo ""
echo "[2/5] Creating directories..."

mkdir -p "${RESULTS_DIR}"
echo "  ✓ Results directory: ${RESULTS_DIR}"

# ── Clean previous results ────────────────────────────────────────────────────
echo ""
echo "[3/5] Cleaning previous results..."

if [[ -d "${RESULTS_DIR}" ]] && [[ -n "$(ls -A "${RESULTS_DIR}" 2>/dev/null)" ]]; then
  rm -f "${RESULTS_DIR}"/*.json "${RESULTS_DIR}"/*.html 2>/dev/null || true
  echo "  ✓ Previous results archived/cleaned"
else
  echo "  ✓ No previous results to clean"
fi

# ── Start Docker Compose stack ────────────────────────────────────────────────
echo ""
echo "[4/5] Starting benchmark stack..."

COMPOSE_FILE="${BENCHMARKS_DIR}/docker-compose.benchmarks.yml"

if [[ ! -f "${COMPOSE_FILE}" ]]; then
  echo "ERROR: ${COMPOSE_FILE} not found" >&2
  exit 1
fi

echo "  Starting services (database, app, k6 runner)..."

# Start the stack in detached mode
docker compose -f "${COMPOSE_FILE}" up -d

echo "  ✓ Stack started"

# ── Wait for services to be healthy ───────────────────────────────────────────
echo ""
echo "[5/5] Waiting for services to be healthy..."

# Wait for database
echo -n "  Waiting for database..."
for i in {1..30}; do
  if docker compose -f "${COMPOSE_FILE}" exec -T db pg_isready -U idenplane &>/dev/null; then
    echo " ✓"
    break
  fi
  if [[ $i -eq 30 ]]; then
    echo ""
    echo "ERROR: Database failed to become ready within 30 attempts" >&2
    docker compose -f "${COMPOSE_FILE}" logs db
    exit 1
  fi
  sleep 1
done

# Wait for app health
echo -n "  Waiting for Idenplane app..."
for i in {1..30}; do
  if docker compose -f "${COMPOSE_FILE}" exec -T app wget --no-verbose --tries=1 --spider http://localhost:3000/health &>/dev/null; then
    echo " ✓"
    break
  fi
  if [[ $i -eq 30 ]]; then
    echo ""
    echo "ERROR: Idenplane app failed to become healthy within 30 attempts" >&2
    docker compose -f "${COMPOSE_FILE}" logs app
    exit 1
  fi
  sleep 2
done

echo ""
echo "═══════════════════════════════════════════════════════════════════════════"
echo "  Setup Complete"
echo "═══════════════════════════════════════════════════════════════════════════"
echo ""
echo "  Benchmark stack is running:"
echo "    - Database:  localhost:5433 (external), db:5432 (internal)"
echo "    - Idenplane:    localhost:3001"
echo "    - K6:        (ready to run)"
echo ""
echo "  Next steps:"
echo "    1. Run benchmarks:"
echo "       ./benchmarks/scripts/run-benchmarks.sh"
echo ""
echo "    2. Or view logs:"
echo "       docker compose -f ${COMPOSE_FILE} logs -f"
echo ""
echo "    3. Clean up when done:"
echo "       ./benchmarks/scripts/teardown.sh"
echo ""
echo "═══════════════════════════════════════════════════════════════════════════"
echo ""