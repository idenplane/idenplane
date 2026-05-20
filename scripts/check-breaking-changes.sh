#!/usr/bin/env bash
# check-breaking-changes.sh
#
# Compares the OpenAPI (Swagger) JSON spec between the current branch and the
# target base branch (default: main).  Exits with code 1 if breaking changes
# are detected so that CI can block the PR.
#
# Usage:
#   ./scripts/check-breaking-changes.sh [base-branch]
#
# Requirements:
#   - Node 18+ (for built-in fetch / node --input-type=module)
#   - @openapitools/openapi-diff  OR  oasdiff installed as a dev dependency
#     or available globally.  The script auto-detects which tool is present.
#
# Environment variables (optional):
#   PORT          Port the dev server listens on (default: 3000)
#   SPEC_URL      Full URL to the Swagger JSON endpoint (overrides PORT)
#   BASE_SPEC     Path to a pre-generated baseline spec JSON file

set -euo pipefail

BASE_BRANCH="${1:-main}"
PORT="${PORT:-3000}"
SPEC_URL="${SPEC_URL:-http://localhost:${PORT}/api-json}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "${SCRIPT_DIR}")"
TMP_DIR=$(mktemp -d)
CURRENT_SPEC="${TMP_DIR}/current.json"
BASE_SPEC_FILE="${TMP_DIR}/base.json"

cleanup() { rm -rf "${TMP_DIR}"; }
trap cleanup EXIT

echo "==> Checking for breaking API changes vs ${BASE_BRANCH}"

# -----------------------------------------------------------------------
# 1. Generate spec for the current (PR) branch
# -----------------------------------------------------------------------
if [[ -n "${BASE_SPEC:-}" && -f "${BASE_SPEC}" ]]; then
  echo "  Using provided baseline spec: ${BASE_SPEC}"
  cp "${BASE_SPEC}" "${BASE_SPEC_FILE}"
else
  echo "  Generating spec for base branch '${BASE_BRANCH}'..."
  BRANCH_SPEC_SCRIPT="${TMP_DIR}/gen-spec.mjs"
  cat > "${BRANCH_SPEC_SCRIPT}" << 'EOF'
// Minimal script: generate OpenAPI spec by importing the NestJS app and
// calling SwaggerModule.createDocument(), then write it to stdout.
// This runs in the repository root after `npm ci && npx prisma generate`.
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './dist/app.module.js';

const app = await NestFactory.create(AppModule, { logger: false });
const config = new DocumentBuilder()
  .setTitle('Idenplane')
  .setVersion('0.1.0')
  .build();
const doc = SwaggerModule.createDocument(app, config);
process.stdout.write(JSON.stringify(doc));
await app.close();
EOF

  # Stash current work, checkout base, build, generate spec, restore
  git -C "${REPO_ROOT}" stash push --quiet --message "breaking-change-check-stash" || true
  git -C "${REPO_ROOT}" fetch --quiet origin "${BASE_BRANCH}"
  git -C "${REPO_ROOT}" checkout --quiet "origin/${BASE_BRANCH}" -- .

  (cd "${REPO_ROOT}" && npm ci --silent && npx prisma generate --silent && npm run build --silent) \
    || { echo "ERROR: Failed to build base branch"; exit 1; }

  node "${BRANCH_SPEC_SCRIPT}" > "${BASE_SPEC_FILE}" 2>/dev/null \
    || { echo "ERROR: Failed to generate spec for base branch"; exit 1; }

  # Restore the PR branch
  git -C "${REPO_ROOT}" checkout --quiet -
  git -C "${REPO_ROOT}" stash pop --quiet || true

  echo "  Generating spec for current branch..."
  (cd "${REPO_ROOT}" && npm ci --silent && npx prisma generate --silent && npm run build --silent) \
    || { echo "ERROR: Failed to build current branch"; exit 1; }

  node "${BRANCH_SPEC_SCRIPT}" > "${CURRENT_SPEC}" 2>/dev/null \
    || { echo "ERROR: Failed to generate spec for current branch"; exit 1; }
fi

# -----------------------------------------------------------------------
# 2. Diff the two specs
# -----------------------------------------------------------------------
BREAKING_FOUND=0

if command -v oasdiff &> /dev/null; then
  echo "  Using oasdiff for comparison..."
  if ! oasdiff breaking "${BASE_SPEC_FILE}" "${CURRENT_SPEC}" --format text; then
    BREAKING_FOUND=1
  fi
elif npx --yes @openapitools/openapi-diff --version &> /dev/null 2>&1; then
  echo "  Using openapi-diff for comparison..."
  DIFF_OUT="${TMP_DIR}/diff.json"
  npx @openapitools/openapi-diff "${BASE_SPEC_FILE}" "${CURRENT_SPEC}" \
    --json "${DIFF_OUT}" || true

  # openapi-diff exits 0 even with breaking changes; parse the JSON output
  BREAKING=$(node -e "
    const fs = require('fs');
    const r = JSON.parse(fs.readFileSync('${DIFF_OUT}', 'utf8'));
    const n = (r.breakingChanges || []).length;
    console.log(n);
  " 2>/dev/null || echo "0")

  if [[ "${BREAKING}" -gt "0" ]]; then
    echo ""
    echo "  Breaking changes detected:"
    node -e "
      const fs = require('fs');
      const r = JSON.parse(fs.readFileSync('${DIFF_OUT}', 'utf8'));
      for (const c of r.breakingChanges || []) {
        console.log('    [BREAKING]', c.id, '-', c.message || '');
      }
    " 2>/dev/null || true
    BREAKING_FOUND=1
  fi
else
  echo "  WARNING: Neither 'oasdiff' nor '@openapitools/openapi-diff' found."
  echo "  Falling back to naive field-count diff..."

  CURRENT_PATHS=$(node -e "
    const s = require('${CURRENT_SPEC}');
    console.log(Object.keys(s.paths || {}).length);
  " 2>/dev/null || echo "0")
  BASE_PATHS=$(node -e "
    const s = require('${BASE_SPEC_FILE}');
    console.log(Object.keys(s.paths || {}).length);
  " 2>/dev/null || echo "0")

  if [[ "${CURRENT_PATHS}" -lt "${BASE_PATHS}" ]]; then
    echo "  BREAKING: Fewer paths in current spec (${CURRENT_PATHS}) than base (${BASE_PATHS})"
    BREAKING_FOUND=1
  else
    echo "  Path count OK: base=${BASE_PATHS}, current=${CURRENT_PATHS}"
  fi
fi

# -----------------------------------------------------------------------
# 3. Report
# -----------------------------------------------------------------------
echo ""
if [[ "${BREAKING_FOUND}" -eq "1" ]]; then
  echo "RESULT: Breaking API changes detected. Please:"
  echo "  1. Bump the API version (add /api/v2/...) instead of modifying existing v1 endpoints."
  echo "  2. Keep the v1 endpoint with a deprecation notice until the next major release."
  echo "  3. Update the API changelog."
  exit 1
else
  echo "RESULT: No breaking API changes detected."
  exit 0
fi
