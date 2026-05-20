#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# benchmarks/scripts/export-results.sh
#
# Exports benchmark results for CI/CD pipelines and external consumption.
#
# What it does:
#   1. Reads benchmark results from the results directory
#   2. Exports to multiple formats (JSON, CSV, Markdown)
#   3. Generates summary statistics for trend analysis
#   4. Produces CI-compatible output files
#
# Usage:
#   ./benchmarks/scripts/export-results.sh
#   ./benchmarks/scripts/export-results.sh --format json
#   ./benchmarks/scripts/export-results.sh --format all --output ./export
#
# Options:
#   --format FORMAT  - Export format: json, csv, markdown, all (default: all)
#   --output DIR    - Output directory (default: results/export)
#   --target TARGET - Filter by target (idenplane, keycloak, etc.)
#   --latest        - Only export the latest results
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Script directory ───────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BENCHMARKS_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
RESULTS_DIR="${BENCHMARKS_DIR}/results"

# ── Parse arguments ───────────────────────────────────────────────────────────
FORMAT="all"
OUTPUT_DIR="${RESULTS_DIR}/export"
TARGET_FILTER=""
LATEST_ONLY=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --format)
      FORMAT="$2"
      shift 2
      ;;
    --output)
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --target)
      TARGET_FILTER="$2"
      shift 2
      ;;
    --latest)
      LATEST_ONLY=true
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

# ── Validate format ────────────────────────────────────────────────────────────
case "${FORMAT}" in
  json|csv|markdown|all) ;;
  *)
    echo "ERROR: Unknown format: ${FORMAT}" >&2
    echo "  Valid formats: json, csv, markdown, all" >&2
    exit 1
    ;;
esac

echo ""
echo "═══════════════════════════════════════════════════════════════════════════"
echo "  Idenplane Benchmark Results Export"
echo "═══════════════════════════════════════════════════════════════════════════"
echo ""
echo "  Format:     ${FORMAT}"
echo "  Output:     ${OUTPUT_DIR}"
echo "  Target:     ${TARGET_FILTER:-all}"
echo "  Latest:     ${LATEST_ONLY}"
echo ""

# ── Check for results ───────────────────────────────────────────────────────────
echo "[1/5] Checking for results..."

mkdir -p "${OUTPUT_DIR}"

# Find result files
if [[ -n "${TARGET_FILTER}" ]]; then
  RESULT_FILES=$(find "${RESULTS_DIR}" -maxdepth 1 -type f \( -name "*-baseline-*.json" -o -name "*-summary-*.json" -o -name "*-results.json" \) -exec basename {} \; 2>/dev/null | grep "${TARGET_FILTER}" | sort)
else
  RESULT_FILES=$(find "${RESULTS_DIR}" -maxdepth 1 -type f \( -name "*-baseline-*.json" -o -name "*-summary-*.json" -o -name "*-results.json" \) -exec basename {} \; 2>/dev/null | sort)
fi

if [[ -z "${RESULT_FILES}" ]]; then
  echo "WARNING: No result files found in ${RESULTS_DIR}" >&2
  echo "  ✓ Export directory created at ${OUTPUT_DIR}"
  echo "  No results to export."
  exit 0
fi

RESULT_COUNT=$(echo "${RESULT_FILES}" | wc -w)
echo "  ✓ Found ${RESULT_COUNT} result file(s)"

# ── Filter latest results if requested ─────────────────────────────────────────
echo ""
echo "[2/5] Processing results..."

PROCESSED_RESULTS=()

if [[ "${LATEST_ONLY}" == true ]]; then
  # Get the most recent result file
  LATEST_FILE=$(echo "${RESULT_FILES}" | tail -1)
  PROCESSED_RESULTS=("${LATEST_FILE}")
  echo "  ✓ Processing only latest: ${LATEST_FILE}"
else
  while IFS= read -r file; do
    [[ -n "${file}" ]] && PROCESSED_RESULTS+=("${file}")
  done <<< "${RESULT_FILES}"
  echo "  ✓ Processing all ${#PROCESSED_RESULTS[@]} file(s)"
fi

# ── Export JSON format ─────────────────────────────────────────────────────────
export_json() {
  local input_file="$1"
  local output_file="$2"

  if [[ -f "${RESULTS_DIR}/${input_file}" ]]; then
    cat "${RESULTS_DIR}/${input_file}" > "${output_file}"
    echo "  ✓ JSON: ${output_file}"
  fi
}

# ── Export CSV format ───────────────────────────────────────────────────────────
export_csv() {
  local input_file="$1"
  local output_file="$2"
  local csv_content=""

  if [[ ! -f "${RESULTS_DIR}/${input_file}" ]]; then
    return 1
  fi

  # Extract data from JSON and convert to CSV
  # This handles the nested structure in idenplane-baseline.json format
  local json_data
  json_data=$(cat "${RESULTS_DIR}/${input_file}")

  # Get the target name from filename
  local target_name
  target_name=$(echo "${input_file}" | grep -oP '^[a-z]+(?=-)' || echo "unknown")

  # Parse metrics from JSON
  local memory_mb latency_p50 latency_p95 latency_p99 rps errors_rate

  memory_mb=$(echo "${json_data}" | grep -oP '"memory_mb":\s*\d+' | head -1 | grep -oP '\d+' || echo "0")
  latency_p50=$(echo "${json_data}" | grep -oP '"latency_p50_ms":\s*[\d.]+' | head -1 | grep -oP '[\d.]+' || echo "0")
  latency_p95=$(echo "${json_data}" | grep -oP '"latency_p95_ms":\s*[\d.]+' | head -1 | grep -oP '[\d.]+' || echo "0")
  latency_p99=$(echo "${json_data}" | grep -oP '"latency_p99_ms":\s*[\d.]+' | head -1 | grep -oP '[\d.]+' || echo "0")
  rps=$(echo "${json_data}" | grep -oP '"requests_per_second":\s*\d+' | head -1 | grep -oP '\d+' || echo "0")
  errors_rate=$(echo "${json_data}" | grep -oP '"errors_rate":\s*[\d.]+' | head -1 | grep -oP '[\d.]+' || echo "0")

  # Write CSV header if file doesn't exist
  if [[ ! -f "${output_file}" ]]; then
    csv_content="target,memory_mb,latency_p50_ms,latency_p95_ms,latency_p99_ms,requests_per_second,errors_rate\n"
  fi

  csv_content="${csv_content}${target_name},${memory_mb},${latency_p50},${latency_p95},${latency_p99},${rps},${errors_rate}\n"

  echo -e "${csv_content}" >> "${output_file}"
  echo "  ✓ CSV: ${output_file}"
}

# ── Export Markdown format ──────────────────────────────────────────────────────
export_markdown() {
  local input_file="$1"
  local output_file="$2"
  local markdown_content=""

  if [[ ! -f "${RESULTS_DIR}/${input_file}" ]]; then
    return 1
  fi

  local target_name
  target_name=$(echo "${input_file}" | grep -oP '^[a-z]+(?=-)' || echo "unknown")

  local timestamp
  timestamp=$(echo "${input_file}" | grep -oP '\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z' || date -u +"%Y-%m-%dT%H:%M:%SZ")

  # Start markdown table
  markdown_content="# Benchmark Results: ${target_name}\n\n"
  markdown_content="${markdown_content}**Generated:** ${timestamp}\n\n"
  markdown_content="${markdown_content}| Metric | Value |\n"
  markdown_content="${markdown_content}|--------|-------|\n"

  # Parse and add metrics
  local json_data
  json_data=$(cat "${RESULTS_DIR}/${input_file}")

  # Memory
  local memory_mb
  memory_mb=$(echo "${json_data}" | grep -oP '"memory_mb":\s*\d+' | head -1 | grep -oP '\d+' || echo "N/A")
  markdown_content="${markdown_content}| Memory (MB) | ${memory_mb} |\n"

  # Latency
  local p50 p95 p99
  p50=$(echo "${json_data}" | grep -oP '"latency_p50_ms":\s*[\d.]+' | head -1 | grep -oP '[\d.]+' || echo "N/A")
  p95=$(echo "${json_data}" | grep -oP '"latency_p95_ms":\s*[\d.]+' | head -1 | grep -oP '[\d.]+' || echo "N/A")
  p99=$(echo "${json_data}" | grep -oP '"latency_p99_ms":\s*[\d.]+' | head -1 | grep -oP '[\d.]+' || echo "N/A")
  markdown_content="${markdown_content}| Latency p50 (ms) | ${p50} |\n"
  markdown_content="${markdown_content}| Latency p95 (ms) | ${p95} |\n"
  markdown_content="${markdown_content}| Latency p99 (ms) | ${p99} |\n"

  # Throughput
  local rps
  rps=$(echo "${json_data}" | grep -oP '"requests_per_second":\s*\d+' | head -1 | grep -oP '\d+' || echo "N/A")
  markdown_content="${markdown_content}| Requests/sec | ${rps} |\n"

  # Errors
  local errors_rate
  errors_rate=$(echo "${json_data}" | grep -oP '"errors_rate":\s*[\d.]+' | head -1 | grep -oP '[\d.]+' || echo "N/A")
  markdown_content="${markdown_content}| Error Rate | ${errors_rate} |\n"

  echo -e "${markdown_content}" > "${output_file}"
  echo "  ✓ Markdown: ${output_file}"
}

# ── Generate summary report ─────────────────────────────────────────────────────
generate_summary() {
  local summary_file="${OUTPUT_DIR}/summary.json"
  local summary_json="{\"export_timestamp\":\"$(date -u +"%Y-%m-%dT%H:%M:%SZ")\",\"format\":\"${FORMAT}\",\"results\":[]}"

  echo "  Generating summary report..."

  # Build summary from all processed results
  local results_array="["
  local first=true
  for file in "${PROCESSED_RESULTS[@]}"; do
    if [[ -f "${RESULTS_DIR}/${file}" ]]; then
      local content
      content=$(cat "${RESULTS_DIR}/${file}")
      if [[ "${first}" == true ]]; then
        first=false
      else
        results_array="${results_array},"
      fi
      # Extract target name
      local target_name
      target_name=$(echo "${file}" | grep -oP '^[a-z]+(?=-)' || echo "unknown")
      results_array="${results_array}{\"file\":\"${file}\",\"target\":\"${target_name}\"}"
    fi
  done
  results_array="${results_array}]"

  summary_json="{\"export_timestamp\":\"$(date -u +"%Y-%m-%dT%H:%M:%SZ")\",\"format\":\"${FORMAT}\",\"file_count\":${#PROCESSED_RESULTS[@]},\"results\":${results_array}}"

  echo "${summary_json}" > "${summary_file}"
  echo "  ✓ Summary: ${summary_file}"
}

# ── Export all formats ──────────────────────────────────────────────────────────
echo ""
echo "[3/5] Exporting results..."

TIMESTAMP=$(date -u +"%Y-%m-%dT%H%M%S")

for file in "${PROCESSED_RESULTS[@]}"; do
  # Generate output filenames
  base_name=$(basename "${file}" .json)

  case "${FORMAT}" in
    json)
      export_json "${file}" "${OUTPUT_DIR}/${base_name}.json"
      ;;
    csv)
      export_csv "${file}" "${OUTPUT_DIR}/metrics.csv"
      ;;
    markdown)
      export_markdown "${file}" "${OUTPUT_DIR}/${base_name}.md"
      ;;
    all)
      export_json "${file}" "${OUTPUT_DIR}/${base_name}.json"
      export_csv "${file}" "${OUTPUT_DIR}/metrics.csv"
      export_markdown "${file}" "${OUTPUT_DIR}/${base_name}.md"
      ;;
  esac
done

# ── Generate CI-compatible outputs ─────────────────────────────────────────────
echo ""
echo "[4/5] Generating CI-compatible outputs..."

# Generate CI metrics file (Gatling/Neoload compatible format)
CI_METRICS_FILE="${OUTPUT_DIR}/ci-metrics.json"
cat > "${CI_METRICS_FILE}" << EOF
{
  "exported_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "build_url": "${BUILD_URL:-unknown}",
  "commit_sha": "${COMMIT_SHA:-unknown}",
  "results_count": ${#PROCESSED_RESULTS[@]},
  "files": $(printf '%s\n' "${PROCESSED_RESULTS[@]}" | jq -Rs 'split("\n")[:-1]')
}
EOF
echo "  ✓ CI metrics: ${CI_METRICS_FILE}"

# Generate JUnit XML for CI integration
JUNIT_FILE="${OUTPUT_DIR}/benchmark-results.xml"
cat > "${JUNIT_FILE}" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="idenplane-benchmarks" tests="${#PROCESSED_RESULTS[@]}" time="$(date +%s)">
  <properties>
    <property name="exported_at" value="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"/>
  </properties>
$(for file in "${PROCESSED_RESULTS[@]}"; do
  target_name=$(echo "${file}" | grep -oP '^[a-z]+(?=-)' || echo "unknown")
  echo "  <testcase name=\"benchmark.${target_name}\" classname=\"idenplane.benchmarks\"/>"
done)
</testsuite>
EOF
echo "  ✓ JUnit XML: ${JUNIT_FILE}"

# Generate summary
generate_summary

# ── Create artifacts manifest ────────────────────────────────────────────────────
echo ""
echo "[5/5] Creating artifacts manifest..."

ARTIFACTS_FILE="${OUTPUT_DIR}/artifacts.json"
ARTIFACT_LIST=$(find "${OUTPUT_DIR}" -type f -exec basename {} \; | jq -Rs 'split("\n")[:-1]')

cat > "${ARTIFACTS_FILE}" << EOF
{
  "manifest_version": "1.0",
  "export_timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "format": "${FORMAT}",
  "results_directory": "${RESULTS_DIR}",
  "output_directory": "${OUTPUT_DIR}",
  "artifacts": ${ARTIFACT_LIST}
}
EOF
echo "  ✓ Artifacts manifest: ${ARTIFACTS_FILE}"

echo ""
echo "═══════════════════════════════════════════════════════════════════════════"
echo "  Export Complete"
echo "═══════════════════════════════════════════════════════════════════════════"
echo ""
echo "  Output directory: ${OUTPUT_DIR}"
echo ""
echo "  Artifacts:"
find "${OUTPUT_DIR}" -type f -exec basename {} \; | while read -r f; do
  echo "    - ${f}"
done
echo ""
echo "  CI Integration:"
echo "    - JUnit XML: ${JUNIT_FILE}"
echo "    - CI Metrics: ${CI_METRICS_FILE}"
echo ""
echo "═══════════════════════════════════════════════════════════════════════════"
echo ""
