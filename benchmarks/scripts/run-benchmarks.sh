#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# benchmarks/scripts/run-benchmarks.sh
#
# Executes the AuthMe performance benchmark suite.
#
# What it does:
#   1. Validates that the benchmark stack is running
#   2. Generates baseline metrics (memory, CPU, startup time)
#   3. Runs k6 load tests for each OAuth flow
#   4. Captures and saves results to JSON
#
# Usage:
#   ./benchmarks/scripts/run-benchmarks.sh
#   ./benchmarks/scripts/run-benchmarks.sh --target authme
#
# Options:
#   --target TARGET  - Target to benchmark (authme, keycloak, authentik, zitadel, all)
#                      Default: authme
#   --vus VUS        - Number of virtual users (overrides env)
#   --duration DUR   - Test duration (overrides env)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Script directory ───────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BENCHMARKS_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
RESULTS_DIR="${BENCHMARKS_DIR}/results"
COMPOSE_FILE="${BENCHMARKS_DIR}/docker-compose.benchmarks.yml"

# ── Parse arguments ───────────────────────────────────────────────────────────
TARGET="authme"
VUS_OVERRIDE=""
DURATION_OVERRIDE=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --target)
      TARGET="$2"
      shift 2
      ;;
    --vus)
      VUS_OVERRIDE="$2"
      shift 2
      ;;
    --duration)
      DURATION_OVERRIDE="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

# ── Load environment variables ─────────────────────────────────────────────────
ENV_FILE="${BENCHMARKS_DIR}/.env"
if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
fi

# ── Apply overrides ─────────────────────────────────────────────────────────────
VUS="${VUS_OVERRIDE:-${VUS:-50}}"
DURATION="${DURATION_OVERRIDE:-${DURATION:-60s}}"
RAMP_UP="${RAMP_UP:-10s}"

# ── Validate prerequisites ─────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════════════════════"
echo "  AuthMe Benchmark Runner"
echo "═══════════════════════════════════════════════════════════════════════════"
echo ""
echo "  Target:     ${TARGET}"
echo "  VUs:        ${VUS}"
echo "  Duration:   ${DURATION}"
echo "  Ramp-up:    ${RAMP_UP}"
echo ""

echo "[1/6] Validating benchmark stack..."

# Check if services are running
if ! docker compose -f "${COMPOSE_FILE}" ps &>/dev/null; then
  echo "ERROR: Benchmark stack is not running" >&2
  echo ""
  echo "  Please run setup first:"
  echo "    ./benchmarks/scripts/setup.sh"
  echo ""
  exit 1
fi

# Check if app is healthy
APP_HEALTH=$(docker compose -f "${COMPOSE_FILE}" ps --format json app 2>/dev/null | \
  grep -o '"Health":"[^"]*"' | cut -d'"' -f4 || echo "")

if [[ "${APP_HEALTH}" != "healthy" ]]; then
  echo "WARNING: AuthMe app health check returned: ${APP_HEALTH:-unknown}"
  echo "  Attempting to continue..."
fi

echo "  ✓ Benchmark stack is running"

# ── Create timestamp for results ───────────────────────────────────────────────
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
RUN_ID="${TARGET}-${TIMESTAMP}"

echo ""
echo "[2/6] Preparing results directory..."

mkdir -p "${RESULTS_DIR}"
echo "  ✓ Results will be saved to ${RESULTS_DIR}"

# ── Capture baseline resource metrics ─────────────────────────────────────────
echo ""
echo "[3/6] Capturing baseline resource metrics..."

BASELINE_FILE="${RESULTS_DIR}/${TARGET}-baseline-${TIMESTAMP}.json"

# Get container stats
CONTAINER_STATS=$(docker stats --no-stream --format '{{json .}}' authme-benchmark-target 2>/dev/null || echo "{}")

# Parse memory usage (convert to MB)
MEMORY_RAW=$(echo "${CONTAINER_STATS}" | grep -o '"MemUsage":"[^"]*"' | cut -d'"' -f4 || echo "0MB / 512MB")
MEMORY_USED=$(echo "${MEMORY_RAW}" | grep -oP '^\d+' || echo "0")
MEMORY_PERCENT=$(echo "${CONTAINER_STATS}" | grep -oP '\d+\.\d+%' | head -1 || echo "0%")
CPU_PERCENT=$(echo "${CONTAINER_STATS}" | grep -oP '\d+\.\d+%' | head -1 || echo "0%")

# Create baseline metrics file
cat > "${BASELINE_FILE}" << EOF
{
  "target": "${TARGET}",
  "timestamp": "${TIMESTAMP}",
  "run_id": "${RUN_ID}",
  "memory_mb": ${MEMORY_USED},
  "memory_percent": "${MEMORY_PERCENT}",
  "cpu_percent": "${CPU_PERCENT}",
  "vus": ${VUS},
  "duration": "${DURATION}",
  "ramp_up": "${RAMP_UP}"
}
EOF

echo "  ✓ Baseline metrics saved: ${BASELINE_FILE}"

# ── Run k6 load tests ──────────────────────────────────────────────────────────
echo ""
echo "[4/6] Running k6 load tests..."

# Update k6 config with current parameters
K6_CONFIG="${BENCHMARKS_DIR}/k6/config.js"
if [[ -f "${K6_CONFIG}" ]]; then
  echo "  Using k6 config: ${K6_CONFIG}"
fi

# ── Define test scripts per target ────────────────────────────────────────────
AUTHME_SCRIPTS=(
  "authme-login"
  "authme-token-issuance"
  "authme-token-introspection"
  "authme-userinfo"
)

KEYCLOAK_SCRIPTS=(
  "keycloak-login"
  "keycloak-token-issuance"
  "keycloak-token-introspection"
  "keycloak-userinfo"
)

AUTHENTIK_SCRIPTS=(
  "authentik-login"
  "authentik-token-issuance"
  "authentik-token-introspection"
  "authentik-userinfo"
)

ZITADEL_SCRIPTS=(
  "zitadel-login"
  "zitadel-token-issuance"
  "zitadel-token-introspection"
  "zitadel-userinfo"
)

# ── Select test scripts based on target ───────────────────────────────────────
case "${TARGET}" in
  authme)
    TEST_SCRIPTS=("${AUTHME_SCRIPTS[@]}")
    ;;
  keycloak)
    TEST_SCRIPTS=("${KEYCLOAK_SCRIPTS[@]}")
    ;;
  authentik)
    TEST_SCRIPTS=("${AUTHENTIK_SCRIPTS[@]}")
    ;;
  zitadel)
    TEST_SCRIPTS=("${ZITADEL_SCRIPTS[@]}")
    ;;
  all)
    TEST_SCRIPTS=(
      "${AUTHME_SCRIPTS[@]}"
      "${KEYCLOAK_SCRIPTS[@]}"
      "${AUTHENTIK_SCRIPTS[@]}"
      "${ZITADEL_SCRIPTS[@]}"
    )
    ;;
  *)
    echo "ERROR: Unknown target: ${TARGET}" >&2
    echo "  Valid targets: authme, keycloak, authentik, zitadel, all" >&2
    exit 1
    ;;
esac

# Run each k6 test script
K6_RESULTS_DIR="${RESULTS_DIR}/k6"
mkdir -p "${K6_RESULTS_DIR}"

for script in "${TEST_SCRIPTS[@]}"; do
  SCRIPT_PATH="${BENCHMARKS_DIR}/k6/${script}.js"
  if [[ -f "${SCRIPT_PATH}" ]]; then
    echo "  Running ${script}..."
    OUTPUT_FILE="${K6_RESULTS_DIR}/${script}-${TIMESTAMP}.json"

    docker compose -f "${COMPOSE_FILE}" run --rm \
      -e VUS="${VUS}" \
      -e DURATION="${DURATION}" \
      -e RAMP_UP="${RAMP_UP}" \
      k6 run "${SCRIPT_PATH}" \
        --config "${K6_CONFIG}" \
        --out json="${OUTPUT_FILE}" 2>&1 || true

    echo "    ✓ Results saved: ${OUTPUT_FILE}"
  else
    echo "  ⚠ Skipping ${script} (script not found)"
  fi
done

# ── Aggregate results ──────────────────────────────────────────────────────────
echo ""
echo "[5/6] Aggregating results..."

# Create aggregated summary
SUMMARY_FILE="${RESULTS_DIR}/${TARGET}-summary-${TIMESTAMP}.json"

cat > "${SUMMARY_FILE}" << EOF
{
  "target": "${TARGET}",
  "timestamp": "${TIMESTAMP}",
  "run_id": "${RUN_ID}",
  "config": {
    "vus": ${VUS},
    "duration": "${DURATION}",
    "ramp_up": "${RAMP_UP}"
  },
  "baseline_metrics": {
    "memory_mb": ${MEMORY_USED},
    "memory_percent": "${MEMORY_PERCENT}",
    "cpu_percent": "${CPU_PERCENT}"
  },
  "tests_run": $(printf '%s' "${TEST_SCRIPTS[*]}" | jq -Rs 'split(" ")'),
  "results_directory": "${K6_RESULTS_DIR}"
}
EOF

echo "  ✓ Summary saved: ${SUMMARY_FILE}"

# ── Generate report ────────────────────────────────────────────────────────────
echo ""
echo "[6/6] Generating report..."

if command -v python3 &>/dev/null; then
  GENERATE_SCRIPT="${SCRIPT_DIR}/generate-report.py"
  if [[ -f "${GENERATE_SCRIPT}" ]]; then
    python3 "${GENERATE_SCRIPT}" "${SUMMARY_FILE}" "${RESULTS_DIR}" 2>&1 || echo "  ⚠ Report generation had warnings"
  fi
fi

echo ""
echo "═══════════════════════════════════════════════════════════════════════════"
echo "  Benchmark Run Complete"
echo "═══════════════════════════════════════════════════════════════════════════"
echo ""
echo "  Results:"
echo "    - Baseline:  ${BASELINE_FILE}"
echo "    - Summary:   ${SUMMARY_FILE}"
echo "    - K6 JSON:   ${K6_RESULTS_DIR}/"
echo ""
echo "  Next steps:"
echo "    1. Compare results:"
echo "       ./benchmarks/scripts/compare-results.py ${RESULTS_DIR}/"
echo ""
echo "    2. Clean up when done:"
echo "       ./benchmarks/scripts/teardown.sh"
echo ""
echo "═══════════════════════════════════════════════════════════════════════════"
echo ""