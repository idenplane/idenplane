#!/usr/bin/env bash
# DAST: OWASP ZAP against a production-mode Idenplane built from this checkout.
#
#   SCAN=baseline   passive baseline scan of the hosted pages: login (via the
#                   authorization endpoint), registration, and the account
#                   page with a signed-in session
#   SCAN=api        active API scan driven by the app's own OpenAPI document
#                   (/api-json), authenticated with the admin API key
#   SCAN=all        both (default)
#
# Rules: .zap/rules.tsv; every ignore or accept there carries its reason.
# Reports (HTML, JSON, Markdown) land in OUT_DIR (default ./zap-out). Exits
# non-zero when any alert is neither ignored nor accepted there (gate.mjs),
# or when ZAP itself fails.
#
#   IDENPLANE_IMAGE      image to scan (default: build this checkout)
#   ZAP_IMAGE            default ghcr.io/zaproxy/zaproxy:2.17.0 (rules.tsv was reviewed against it)
#   ZAP_API_MAX_MINUTES  cap on the active scan (default 45)
set -euo pipefail
source "$(dirname "$0")/../lib/common.sh"

SCAN="${SCAN:-all}"
ZAP_IMAGE="${ZAP_IMAGE:-ghcr.io/zaproxy/zaproxy:2.17.0}"
ZAP_API_MAX_MINUTES="${ZAP_API_MAX_MINUTES:-45}"
OUT_DIR="${OUT_DIR:-$PWD/zap-out}"
NET="idp-zap-$$"
APP="zap-app-$$"
DB="zap-db-$$"
# Every run has its own network, so the app's name on it can be fixed.
export APP_ALIAS=zap-app
mkdir -p "$OUT_DIR" && chmod 777 "$OUT_DIR"
WORK="$(mktemp -d)" && chmod 777 "$WORK"

cleanup() {
  docker logs "$APP" > "$OUT_DIR/idenplane.log" 2>&1 || true
  docker rm -f "$APP" "$DB" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  rm -rf "$WORK" || true
}
trap cleanup EXIT

ci_common_secrets
ci_image
ci_net_up "$NET"
docker pull -q "$ZAP_IMAGE" >/dev/null

ci_log "start Idenplane ($IDENPLANE_IMAGE), production mode"
ci_pg_start "$DB" "$NET"
ci_app_start "$APP" "$NET" "$IDENPLANE_IMAGE" "$DB"
ci_app_wait "$APP"
ci_node "$NET" "$WORK" zap/seed.mjs -e IDENPLANE_URL=http://zap-app:3000
# shellcheck disable=SC1091
source "$WORK/targets.env"
SESSION_COOKIE="$(cat "$WORK/session-cookie.txt")"
[ -n "${GITHUB_ACTIONS:-}" ] && echo "::add-mask::${SESSION_COOKIE#IDENPLANE_SESSION=}"
cp "$REPO_ROOT/.zap/rules.tsv" "$OUT_DIR/rules.tsv"

declare -A RESULTS=()
zap() {
  local name="$1"; shift
  local rc=0
  ci_log "ZAP $name"
  docker run --rm --network "$NET" -v "$OUT_DIR:/zap/wrk:rw" "$@" || rc=$?
  RESULTS[$name]=$rc
  echo "ZAP $name exit code: $rc (0 pass, 1 FAIL, 2 WARN, 3 error)"
}

if [ "$SCAN" = baseline ] || [ "$SCAN" = all ]; then
  zap baseline-login "$ZAP_IMAGE" zap-baseline.py -t "$LOGIN_URL" \
    -c rules.tsv -m 2 -r baseline-login.html -J baseline-login.json -w baseline-login.md
  zap baseline-register "$ZAP_IMAGE" zap-baseline.py -t "$REGISTER_URL" \
    -c rules.tsv -m 1 -r baseline-register.html -J baseline-register.json -w baseline-register.md
  # Signed in. The Cookie header is injected only towards the app.
  zap baseline-account \
    -e ZAP_AUTH_HEADER=Cookie -e ZAP_AUTH_HEADER_VALUE="$SESSION_COOKIE" -e ZAP_AUTH_HEADER_SITE=zap-app \
    "$ZAP_IMAGE" zap-baseline.py -t "$ACCOUNT_URL" \
    -c rules.tsv -m 1 -r baseline-account.html -J baseline-account.json -w baseline-account.md
fi

if [ "$SCAN" = api ] || [ "$SCAN" = all ]; then
  ci_node "$NET" "$OUT_DIR" zap/prepare-openapi.mjs -e IDENPLANE_URL=http://zap-app:3000
  zap api \
    -e ZAP_AUTH_HEADER=x-admin-api-key -e ZAP_AUTH_HEADER_VALUE="$ADMIN_API_KEY" -e ZAP_AUTH_HEADER_SITE=zap-app \
    "$ZAP_IMAGE" zap-api-scan.py -t /zap/wrk/openapi.json -f openapi \
    -c rules.tsv -r api.html -J api.json -w api.md \
    -z "-config scanner.maxScanDurationInMins=${ZAP_API_MAX_MINUTES} -config scanner.maxRuleDurationInMins=8 -config scanner.threadPerHost=6"
fi

# The verdict, per alert, against .zap/rules.tsv (see gate.mjs).
gate_rc=0
docker run --rm -v "$CI_DIR:/ci:ro" -v "$OUT_DIR:/out" "$NODE_IMAGE"   node /ci/zap/gate.mjs /out /out/rules.tsv "${!RESULTS[@]}" > "$OUT_DIR/summary.md" || gate_rc=$?
cat "$OUT_DIR/summary.md"
[ -n "${GITHUB_STEP_SUMMARY:-}" ] && cat "$OUT_DIR/summary.md" >> "$GITHUB_STEP_SUMMARY"
# The admin key and the session must never end up in an uploaded report.
for value in "$ADMIN_API_KEY" "${SESSION_COOKIE#IDENPLANE_SESSION=}"; do
  if grep -rqF "$value" "$OUT_DIR"; then
    echo "scrubbing a credential from the reports"
    grep -rlF "$value" "$OUT_DIR" | xargs sed -i "s|${value}|REDACTED|g"
  fi
done

failed=0
for name in "${!RESULTS[@]}"; do
  rc="${RESULTS[$name]}"
  # 1 = a FAIL-level rule, 3 = ZAP itself failed. 2 (warnings) is left to
  # the gate, which looks at each alert.
  if [ "$rc" = 1 ] || [ "$rc" = 3 ]; then echo "::error::ZAP $name exited $rc"; failed=1; fi
done
[ "$gate_rc" -eq 0 ] || { echo "::error::ZAP gate: open alerts (see the summary)"; failed=1; }
exit "$failed"
