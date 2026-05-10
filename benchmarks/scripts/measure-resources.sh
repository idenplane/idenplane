#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# benchmarks/scripts/measure-resources.sh
#
# Measures resource usage (memory, CPU, startup time) for AuthMe container.
#
# What it does:
#   1. Validates AuthMe container is running
#   2. Captures current memory usage (RSS, working set)
#   3. Captures current CPU usage percentage
#   4. Measures startup time (time since container started)
#   5. Outputs results to JSON file
#
# Usage:
#   ./benchmarks/scripts/measure-resources.sh
#   ./benchmarks/scripts/measure-resources.sh --container authme-benchmark-target
#   ./benchmarks/scripts/measure-resources.sh --output /path/to/results.json
#
# Options:
#   --container NAME  - Container name to measure (default: authme-benchmark-target)
#   --output PATH    - Output file path (default: results/YYYY-MM-DDTHH-MM-SS-resources.json)
#   --json           - Output results as JSON to stdout
#   --verbose        - Show detailed measurements
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Script directory ───────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BENCHMARKS_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
RESULTS_DIR="${BENCHMARKS_DIR}/results"
COMPOSE_FILE="${BENCHMARKS_DIR}/docker-compose.benchmarks.yml"

# ── Load environment variables ─────────────────────────────────────────────────
ENV_FILE="${BENCHMARKS_DIR}/.env"
if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
fi

# ── Defaults ──────────────────────────────────────────────────────────────────
CONTAINER_NAME="${CONTAINER_NAME:-authme-benchmark-target}"
OUTPUT_FILE=""
OUTPUT_JSON=false
VERBOSE=false

# ── Parse arguments ─────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case $1 in
    --container)
      CONTAINER_NAME="$2"
      shift 2
      ;;
    --output)
      OUTPUT_FILE="$2"
      shift 2
      ;;
    --json)
      OUTPUT_JSON=true
      shift
      ;;
    --verbose)
      VERBOSE=true
      shift
      ;;
    --help|-h)
      echo "Usage: $0 [--container NAME] [--output PATH] [--json] [--verbose]"
      echo ""
      echo "Options:"
      echo "  --container NAME  Container to measure (default: authme-benchmark-target)"
      echo "  --output PATH    Output file path"
      echo "  --json           Output JSON to stdout"
      echo "  --verbose        Show detailed measurements"
      echo "  --help, -h      Show this help message"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Use --help for usage information" >&2
      exit 1
      ;;
  esac
done

# ── Set default output file if not specified ───────────────────────────────────
if [[ -z "${OUTPUT_FILE}" ]]; then
  TIMESTAMP=$(date -u +"%Y-%m-%dT%H-%M-%SZ")
  mkdir -p "${RESULTS_DIR}"
  OUTPUT_FILE="${RESULTS_DIR}/${TIMESTAMP}-resources.json"
fi

# ── Initialize variables ────────────────────────────────────────────────────────
MEMORY_RSS_MB=0
MEMORY_WORKING_SET_MB=0
MEMORY_LIMIT_MB=0
MEMORY_USAGE_PERCENT="0%"
CPU_PERCENT="0%"
STARTED_AT=""
STARTUP_TIME_SECONDS=0
CONTAINER_STATUS="unknown"

echo ""
echo "═══════════════════════════════════════════════════════════════════════════"
echo "  AuthMe Resource Measurement"
echo "═══════════════════════════════════════════════════════════════════════════"
echo ""
echo "  Container: ${CONTAINER_NAME}"
echo "  Output:    ${OUTPUT_FILE}"
echo ""

# ── Validate container is running ────────────────────────────────────────────────
echo "[1/5] Validating container..."

# Check if container exists and is running
CONTAINER_EXISTS=$(docker ps --filter "name=${CONTAINER_NAME}" --filter "status=running" --format '{{.Names}}' 2>/dev/null || echo "")

if [[ -z "${CONTAINER_EXISTS}" ]]; then
  echo "ERROR: Container ${CONTAINER_NAME} is not running" >&2
  echo ""
  echo "  Please start the benchmark stack first:"
  echo "    ./benchmarks/scripts/setup.sh"
  echo ""
  exit 1
fi

echo "  ✓ Container ${CONTAINER_NAME} is running"

# ── Get container status ────────────────────────────────────────────────────────
echo ""
echo "[2/5] Getting container metadata..."

# Get container created time and status
CONTAINER_JSON=$(docker inspect "${CONTAINER_NAME}" --format '{{json .}}' 2>/dev/null || echo "{}")

# Extract created time
STARTED_AT=$(echo "${CONTAINER_JSON}" | grep -oP '"StartedAt":"[^"]*"' | cut -d'"' -f4 || echo "")
CONTAINER_STATUS=$(echo "${CONTAINER_JSON}" | grep -oP '"Status":"[^"]*"' | cut -d'"' -f4 || echo "unknown")

# Calculate startup time (time since container started)
if [[ -n "${STARTED_AT}" ]] && [[ "${STARTED_AT}" != "0001-01-01T00:00:00Z" ]]; then
  STARTED_EPOCH=$(date -u -d "${STARTED_AT}" +%s 2>/dev/null || echo "0")
  NOW_EPOCH=$(date -u +%s)
  STARTUP_TIME_SECONDS=$((NOW_EPOCH - STARTED_EPOCH))
fi

echo "  ✓ Status:    ${CONTAINER_STATUS}"
echo "  ✓ Started:   ${STARTED_AT}"
echo "  ✓ Uptime:    ${STARTUP_TIME_SECONDS} seconds"

# ── Measure memory usage ────────────────────────────────────────────────────────
echo ""
echo "[3/5] Measuring memory usage..."

# Get memory stats using docker stats
MEMORY_STATS=$(docker stats "${CONTAINER_NAME}" --no-stream --format '{{.MemUsage}} {{.MemPerc}}' 2>/dev/null || echo "0 MB / 0 MB 0%")

# Parse memory usage: "123.4MiB / 512MiB" -> 123.4 MB used, 512 MB limit
MEMORY_USAGE=$(echo "${MEMORY_STATS}" | awk '{print $1}')
MEMORY_LIMIT=$(echo "${MEMORY_STATS}" | awk '{print $3}')
MEMORY_USAGE_PERCENT=$(echo "${MEMORY_STATS}" | awk '{print $5}')

# Convert memory values to MB (handle both MiB and MB suffixes)
parse_memory_mb() {
  local value="$1"
  local num part
  num=$(echo "${value}" | grep -oP '^\d+\.?\d*' || echo "0")
  part=$(echo "${value}" | grep -oP '[A-Za-z]+$' | tr '[:lower:]' '[:upper:]' || echo "MB")

  case "${part}" in
    "MIB"|"MI"|"M")
      echo "${num}" | awk '{printf "%.2f", $1}'
      ;;
    "GIB"|"GI"|"G")
      echo "${num}" | awk '{printf "%.2f", $1 * 1024}'
      ;;
    "KIB"|"KI"|"K")
      echo "${num}" | awk '{printf "%.2f", $1 / 1024}'
      ;;
    "B"|"B ")
      echo "${num}" | awk '{printf "%.2f", $1 / 1024 / 1024}'
      ;;
    *)
      echo "${num}" | awk '{printf "%.2f", $1}'
      ;;
  esac
}

MEMORY_RSS_MB=$(parse_memory_mb "${MEMORY_USAGE}")
MEMORY_LIMIT_MB=$(parse_memory_mb "${MEMORY_LIMIT}")

echo "  ✓ Memory RSS:        ${MEMORY_RSS_MB} MB"
echo "  ✓ Memory Limit:      ${MEMORY_LIMIT_MB} MB"
echo "  ✓ Memory Usage:      ${MEMORY_USAGE_PERCENT}"

# ── Measure CPU usage ────────────────────────────────────────────────────────────
echo ""
echo "[4/5] Measuring CPU usage..."

# Get CPU percentage
CPU_STATS=$(docker stats "${CONTAINER_NAME}" --no-stream --format '{{.CPUPerc}}' 2>/dev/null || echo "0.00%")
CPU_PERCENT=$(echo "${CPU_STATS}" | grep -oP '\d+\.?\d*%' || echo "0%")

echo "  ✓ CPU Usage: ${CPU_PERCENT}"

# ── Additional metrics if verbose ───────────────────────────────────────────────
if [[ "${VERBOSE}" == true ]]; then
  echo ""
  echo "[5/5] Collecting additional metrics..."

  # Network I/O
  NETWORK_IO=$(docker stats "${CONTAINER_NAME}" --no-stream --format '{{.NetIO}}' 2>/dev/null || echo "0 B / 0 B")
  echo "  ✓ Network I/O: ${NETWORK_IO}"

  # Block I/O
  BLOCK_IO=$(docker stats "${CONTAINER_NAME}" --no-stream --format '{{.BlockIO}}' 2>/dev/null || echo "0 B / 0 B")
  echo "  ✓ Block I/O: ${BLOCK_IO}"

  # PIDs
  PIDS=$(docker stats "${CONTAINER_NAME}" --no-stream --format '{{.PIDs}}' 2>/dev/null || echo "0")
  echo "  ✓ PIDs: ${PIDS}"
fi

# ── Write results ───────────────────────────────────────────────────────────────
echo ""
echo "[6/6] Writing results..."

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Build JSON output
JSON_OUTPUT=$(cat << EOF
{
  "timestamp": "${TIMESTAMP}",
  "container_name": "${CONTAINER_NAME}",
  "container_status": "${CONTAINER_STATUS}",
  "started_at": "${STARTED_AT}",
  "startup_time_seconds": ${STARTUP_TIME_SECONDS},
  "memory": {
    "rss_mb": ${MEMORY_RSS_MB},
    "limit_mb": ${MEMORY_LIMIT_MB},
    "usage_percent": "${MEMORY_USAGE_PERCENT}"
  },
  "cpu": {
    "usage_percent": "${CPU_PERCENT}"
  }
EOF
)

# Add verbose metrics if requested
if [[ "${VERBOSE}" == true ]]; then
  NETWORK_IN=$(echo "${NETWORK_IO}" | awk '{print $1}')
  NETWORK_OUT=$(echo "${NETWORK_IO}" | awk '{print $3}')
  BLOCK_READ=$(echo "${BLOCK_IO}" | awk '{print $1}')
  BLOCK_WRITE=$(echo "${BLOCK_IO}" | awk '{print $3}')

  JSON_OUTPUT=$(echo "${JSON_OUTPUT}" | sed 's/}$/,/')
  JSON_OUTPUT="${JSON_OUTPUT}
  \"network\": {
    \"input\": \"${NETWORK_IN}\",
    \"output\": \"${NETWORK_OUT}\"
  },
  \"block_io\": {
    \"read\": \"${BLOCK_READ}\",
    \"write\": \"${BLOCK_WRITE}\"
  },
  \"pids\": ${PIDS}
}"
fi

JSON_OUTPUT="${JSON_OUTPUT}
}"

# Write to file
echo "${JSON_OUTPUT}" > "${OUTPUT_FILE}"
echo "  ✓ Results saved to: ${OUTPUT_FILE}"

# Output to stdout if requested
if [[ "${OUTPUT_JSON}" == true ]]; then
  echo ""
  echo "--- JSON Output ---"
  echo "${JSON_OUTPUT}"
  echo "--- End JSON Output ---"
fi

echo ""
echo "═══════════════════════════════════════════════════════════════════════════"
echo "  Measurement Complete"
echo "═══════════════════════════════════════════════════════════════════════════"
echo ""
echo "  Summary:"
echo "    - Memory RSS:  ${MEMORY_RSS_MB} MB"
echo "    - CPU:        ${CPU_PERCENT}"
echo "    - Startup:    ${STARTUP_TIME_SECONDS} seconds"
echo ""
echo "═══════════════════════════════════════════════════════════════════════════"
echo ""
