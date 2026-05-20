#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# benchmarks/scripts/teardown.sh
#
# Stops and cleans up the Idenplane benchmark environment.
#
# What it does:
#   1. Stops the benchmark Docker Compose stack
#   2. Removes containers, networks, and optionally volumes
#   3. Offers to archive results before cleanup
#
# Usage:
#   ./benchmarks/scripts/teardown.sh
#   ./benchmarks/scripts/teardown.sh --keep-results
#   ./benchmarks/scripts/teardown.sh --full-cleanup
#
# Options:
#   --keep-results  - Keep results files (default behavior)
#   --full-cleanup - Remove volumes and all data
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Script directory ───────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BENCHMARKS_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
RESULTS_DIR="${BENCHMARKS_DIR}/results"
COMPOSE_FILE="${BENCHMARKS_DIR}/docker-compose.benchmarks.yml"

# ── Parse arguments ────────────────────────────────────────────────────────────
KEEP_RESULTS=false
FULL_CLEANUP=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --keep-results)
      KEEP_RESULTS=true
      shift
      ;;
    --full-cleanup)
      FULL_CLEANUP=true
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

echo ""
echo "═══════════════════════════════════════════════════════════════════════════"
echo "  Idenplane Benchmark Teardown"
echo "═══════════════════════════════════════════════════════════════════════════"
echo ""

# ── Check if stack is running ──────────────────────────────────────────────────
echo "[1/4] Checking benchmark stack status..."

if ! docker compose -f "${COMPOSE_FILE}" ps &>/dev/null; then
  echo "  ⚠ No benchmark stack is currently running"
  echo "  ✓ Nothing to teardown"
  exit 0
fi

# Show running services
RUNNING_SERVICES=$(docker compose -f "${COMPOSE_FILE}" ps --format json 2>/dev/null | \
  grep -o '"Name":"[^"]*"' | cut -d'"' -f4 | tr '\n' ', ' || echo "")

if [[ -n "${RUNNING_SERVICES}" ]]; then
  echo "  Running services: ${RUNNING_SERVICES%, }"
fi

echo "  ✓ Stack is running"

# ── Archive results (optional) ─────────────────────────────────────────────────
echo ""
echo "[2/4] Checking results..."

if [[ -d "${RESULTS_DIR}" ]] && [[ -n "$(ls -A "${RESULTS_DIR}" 2>/dev/null)" ]]; then
  RESULT_COUNT=$(find "${RESULTS_DIR}" -type f \( -name "*.json" -o -name "*.html" \) 2>/dev/null | wc -l)
  echo "  Found ${RESULT_COUNT} result file(s) in ${RESULTS_DIR}"

  if [[ "${KEEP_RESULTS}" == "false" ]]; then
    # Archive with timestamp
    TIMESTAMP=$(date -u +"%Y-%m-%dT%H%M%S")
    ARCHIVE_DIR="${RESULTS_DIR}/archive"
    mkdir -p "${ARCHIVE_DIR}"
    ARCHIVE_FILE="${ARCHIVE_DIR}/results-${TIMESTAMP}.tar.gz"

    tar -czf "${ARCHIVE_FILE}" -C "${RESULTS_DIR}" \
      --exclude='archive' \
      --exclude='*.tar.gz' \
      . 2>/dev/null || true

    if [[ -f "${ARCHIVE_FILE}" ]]; then
      echo "  ✓ Results archived to: ${ARCHIVE_FILE}"
    fi
  else
    echo "  ✓ Results preserved in ${RESULTS_DIR}"
  fi
else
  echo "  ✓ No results files found"
fi

# ── Stop Docker Compose stack ───────────────────────────────────────────────────
echo ""
echo "[3/4] Stopping benchmark stack..."

echo "  Stopping containers..."
docker compose -f "${COMPOSE_FILE}" down 2>&1 || true

if [[ "${FULL_CLEANUP}" == "true" ]]; then
  echo "  Removing volumes..."
  docker compose -f "${COMPOSE_FILE}" down -v 2>&1 || true
  echo "  ✓ Volumes removed"
fi

echo "  ✓ Stack stopped"

# ── Final status ────────────────────────────────────────────────────────────────
echo ""
echo "[4/4] Final cleanup..."

# Remove any orphaned containers
ORPHANS=$(docker ps -a --filter "name=idenplane-benchmark" --format '{{.Names}}' 2>/dev/null || echo "")
if [[ -n "${ORPHANS}" ]]; then
  echo "  Removing orphaned containers..."
  echo "${ORPHANS}" | xargs docker rm -f 2>/dev/null || true
fi

echo "  ✓ Cleanup complete"

echo ""
echo "═══════════════════════════════════════════════════════════════════════════"
echo "  Teardown Complete"
echo "═══════════════════════════════════════════════════════════════════════════"
echo ""

if [[ "${FULL_CLEANUP}" == "true" ]]; then
  echo "  Status:"
  echo "    - Containers:     removed"
  echo "    - Volumes:       removed"
  echo "    - Results:       ${KEEP_RESULTS:-archived}"
else
  echo "  Status:"
  echo "    - Containers:     removed"
  echo "    - Volumes:       preserved"
  echo "    - Results:       preserved"
fi

echo ""
echo "  To start fresh:"
echo "    ./benchmarks/scripts/setup.sh"
echo ""
echo "═══════════════════════════════════════════════════════════════════════════"
echo ""