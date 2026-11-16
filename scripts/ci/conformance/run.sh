#!/usr/bin/env bash
# Runs the OpenID Foundation conformance suite against Idenplane.
#
#   PLANS   which plans to run (default: both)
#             basic   oidcc-basic-certification-test-plan
#                     [server_metadata=discovery][client_registration=static_client]
#             config  oidcc-config-certification-test-plan
#   IDENPLANE_IMAGE   image to test (default: build this checkout)
#   OUT_DIR           results (default ./conformance-out): results.json,
#                     summary.md, the suite's exported plan archives, logs
#
# The conformance-suite release is pinned, by tag and digest, on the FROM line
# of Dockerfile.suite. The scripts (run-test-plan.py) are cloned from that same
# release, and docker-compose.yml's suite nginx image must carry the same tag.
#
# Topology, all on one private Docker network with nothing published:
#   suite: server (trusts a throwaway CA) + nginx + mongo
#   idenplane: postgres + app + Caddy serving https://idp.conformance.test
#              with a certificate from that CA
#
# Exit status: 1 if any module FAILED, was INTERRUPTED or did not run.
# Needs Docker (with compose), git and openssl.
set -euo pipefail
source "$(dirname "$0")/../lib/common.sh"

PLANS="${PLANS:-basic config}"
OUT_DIR="${OUT_DIR:-$PWD/conformance-out}"
HERE="$CI_DIR/conformance"
# Read the release from the pinned image rather than the environment, so the
# scripts and the images can't come from different releases.
SUITE_REPO='registry.gitlab.com/openid/conformance-suite'
SUITE_VERSION="$(sed -n "s|^FROM ${SUITE_REPO}:\([^@]*\)@sha256:.*|\1|p" "$HERE/Dockerfile.suite")"
if [ -z "$SUITE_VERSION" ]; then
  echo "Dockerfile.suite has no digest-pinned ${SUITE_REPO} FROM line" >&2
  exit 1
fi
if ! grep -qF "image: ${SUITE_REPO}/nginx:${SUITE_VERSION}@sha256:" "$HERE/docker-compose.yml"; then
  echo "docker-compose.yml's suite nginx image is not pinned to ${SUITE_VERSION}" >&2
  exit 1
fi
WORK_DIR="$(mktemp -d)"
SUITE_DIR="$WORK_DIR/suite"
mkdir -p "$OUT_DIR/export" "$WORK_DIR/export" && chmod -R 777 "$OUT_DIR" "$WORK_DIR"
export SUITE_VERSION WORK_DIR SUITE_DIR CI_DIR
COMPOSE=(docker compose --project-directory "$WORK_DIR" -f "$WORK_DIR/docker-compose.yml")

cleanup() {
  "${COMPOSE[@]}" logs --no-color app > "$OUT_DIR/idenplane.log" 2>&1 || true
  "${COMPOSE[@]}" logs --no-color server > "$OUT_DIR/suite-server.log" 2>&1 || true
  "${COMPOSE[@]}" --profile runner down --volumes --remove-orphans >/dev/null 2>&1 || true
  # Containers ran as root and may have left root-owned files behind.
  docker run --rm -v "$WORK_DIR:/w" python:3.12-slim sh -c 'rm -rf /w/* /w/.[!.]*' >/dev/null 2>&1 || true
  rm -rf "$WORK_DIR" || true
}
trap cleanup EXIT

ci_secret POSTGRES_PASSWORD
ci_secret ADMIN_API_KEY
ci_secret ADMIN_PASSWORD "Adm1n-"
ci_secret WEBHOOK_SECRET_KEY
ci_secret WEBHOOK_ENCRYPTION_SALT
ci_image

ci_log "conformance suite $SUITE_VERSION against $IDENPLANE_IMAGE"
cp "$HERE/docker-compose.yml" "$HERE/Caddyfile" "$HERE/Dockerfile.suite" "$WORK_DIR/"

# A CA that lives for this run only, and the TLS certificate Caddy serves.
mkdir -p "$WORK_DIR/certs" && (
  cd "$WORK_DIR/certs"
  openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj "/CN=Idenplane conformance run CA" \
    -keyout ca.key -out ca.crt -addext "basicConstraints=critical,CA:TRUE" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" 2>/dev/null
  openssl req -newkey rsa:2048 -nodes -subj "/CN=idp.conformance.test" -keyout idp.key -out idp.csr 2>/dev/null
  printf 'subjectAltName=DNS:idp.conformance.test\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n' > ext.cnf
  openssl x509 -req -in idp.csr -CA ca.crt -CAkey ca.key -CAcreateserial -days 2 -out idp.crt -extfile ext.cnf 2>/dev/null
  rm -f ca.key idp.csr ext.cnf ca.srl
  chmod 644 ./*
)

# run-test-plan.py and its requirements, from the same release as the image.
git clone -q --depth 1 --branch "$SUITE_VERSION" https://gitlab.com/openid/conformance-suite.git "$SUITE_DIR"

"${COMPOSE[@]}" build -q server
"${COMPOSE[@]}" up -d --wait --wait-timeout 300 db app
"${COMPOSE[@]}" up -d mongodb server nginx caddy
"${COMPOSE[@]}" run --rm -T seed /ci/conformance/seed.mjs

# The suite's Spring server takes a while; run-test-plan.py waits for it too.
declare -A PLAN_SPEC=(
  [basic]='oidcc-basic-certification-test-plan[server_metadata=discovery][client_registration=static_client]'
  [config]='oidcc-config-certification-test-plan'
)
plan_ids=()
for plan in $PLANS; do
  spec="${PLAN_SPEC[$plan]:?unknown plan $plan}"
  ci_log "plan $plan: $spec"
  rc=0
  "${COMPOSE[@]}" --profile runner run --rm -T -e CONFORMANCE_MAX_CONSECUTIVE_FAILURES=100 runner sh -c \
    "pip install -q --disable-pip-version-check -r scripts/requirements.txt >/dev/null 2>&1 && \
     python3 scripts/run-test-plan.py --export-dir /work/export --verbose '$spec' /work/config.json" \
    > "$OUT_DIR/run-$plan.log" 2>&1 || rc=$?
  tail -5 "$OUT_DIR/run-$plan.log"
  echo "run-test-plan.py ($plan) exited $rc (non-zero also for WARNING/REVIEW; the verdict comes from collect.py)"
  id="$(grep -oE 'Created test plan, new id: [A-Za-z0-9]+' "$OUT_DIR/run-$plan.log" | awk '{print $NF}' | tail -1)"
  if [ -z "$id" ]; then echo "::error::plan $plan did not start; see run-$plan.log"; tail -40 "$OUT_DIR/run-$plan.log"; exit 1; fi
  plan_ids+=("$id")
done

ci_log "collect results"
cp "$HERE/collect.py" "$WORK_DIR/collect.py"
status=0
"${COMPOSE[@]}" --profile runner run --rm -T --entrypoint python3 runner /work/collect.py /work "${plan_ids[@]}" > /dev/null || status=$?
cp "$WORK_DIR/results.json" "$WORK_DIR/summary.md" "$OUT_DIR/"
cp -r "$WORK_DIR/export/." "$OUT_DIR/export/" 2>/dev/null || true
cat "$OUT_DIR/summary.md"
[ -n "${GITHUB_STEP_SUMMARY:-}" ] && cat "$OUT_DIR/summary.md" >> "$GITHUB_STEP_SUMMARY"
# Never upload the run's credentials (they are throwaway, but still).
for v in "$ADMIN_API_KEY" "$POSTGRES_PASSWORD"; do
  if grep -rqF "$v" "$OUT_DIR" 2>/dev/null; then
    grep -rlF "$v" "$OUT_DIR" | xargs sed -i "s|${v}|REDACTED|g"
  fi
done
exit "$status"
