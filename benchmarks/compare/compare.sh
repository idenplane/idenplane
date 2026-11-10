#!/usr/bin/env bash
# Benchmarks ONE identity server on this machine and writes the raw results
# to $RESULTS_DIR/<target>/. Run it once per target, then compare with
# report.mjs. Only one target stack is up at a time, and the server, its
# database and the load generator are pinned to separate CPUs.
#
#   bash benchmarks/compare/compare.sh idenplane
#   bash benchmarks/compare/compare.sh keycloak
#   bash benchmarks/compare/compare.sh keycloak-argon2-parity
#   node benchmarks/compare/report.mjs          # or: see README
#
# Knobs (environment): SCENARIOS, RUNS, VUS, DURATION, WARMUP, TARGET_MEM,
# TARGET_CPUS / DB_CPUS / K6_CPUS, IDENPLANE_IMAGE, KEYCLOAK_IMAGE,
# K6_IMAGE, RESULTS_DIR. Needs docker (with compose), curl and openssl.
set -euo pipefail

TARGET="${1:?usage: compare.sh idenplane|keycloak|keycloak-argon2-parity}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

SCENARIOS="${SCENARIOS:-discovery jwks client_credentials introspect password}"
RUNS="${RUNS:-3}"
export VUS="${VUS:-32}" DURATION="${DURATION:-60s}"
WARMUP="${WARMUP:-20s}"
export TARGET_MEM="${TARGET_MEM:-2g}"
export IDENPLANE_IMAGE="${IDENPLANE_IMAGE:-islamawad/idenplane:0.6.0}"
export KEYCLOAK_IMAGE="${KEYCLOAK_IMAGE:-quay.io/keycloak/keycloak:26.8.2}"
# Defaults for these two live in their target files; compare.sh only needs
# the resolved names, which it reads back from compose below.
export AUTHENTIK_IMAGE="${AUTHENTIK_IMAGE:-}" ZITADEL_IMAGE="${ZITADEL_IMAGE:-}"
K6_IMAGE="${K6_IMAGE:-grafana/k6:2.3.0}"
RESULTS_DIR="${RESULTS_DIR:-$ROOT/benchmarks/results/compare}"
export PUBLIC_PORT="${PUBLIC_PORT:-18080}" HEALTH_PORT="${HEALTH_PORT:-19000}"

log() { printf '\n\033[1m== %s\033[0m\n' "$*" >&2; }
now_ms() { date +%s%3N; }
# A path as docker on this host expects it: unchanged except under Git Bash.
host_path() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }

# ── CPU split: server | database | load generator ───────────────────────────
# The CPUs the containers can use, which is the Docker VM's count on Docker
# Desktop, not the host's.
cpus="$(docker info --format '{{.NCPU}}' 2>/dev/null || nproc)"
if [ -z "${TARGET_CPUS:-}" ]; then
  if   [ "$cpus" -ge 8 ]; then TARGET_CPUS=0-3 DB_CPUS=4-5 K6_CPUS=6-$((cpus - 1))
  elif [ "$cpus" -ge 4 ]; then TARGET_CPUS=0-1 DB_CPUS=2   K6_CPUS=3-$((cpus - 1))
  else echo "Need at least 4 CPUs (have $cpus)" >&2; exit 1; fi
fi
export TARGET_CPUS DB_CPUS K6_CPUS

# ── node, or node in a container when the host has none ─────────────────────
if ! command -v node >/dev/null 2>&1; then
  # Only $ROOT is mounted, and the container sees only the variables named in
  # NODE_PASS_ENV, so a script run this way reads its input from those and
  # writes its output to stdout.
  shim="$(mktemp -d)"
  cat >"$shim/node" <<EOF
#!/bin/sh
pass=""
for v in \$NODE_PASS_ENV; do pass="\$pass -e \$v"; done
exec docker run --rm -i \$pass -v "$ROOT:$ROOT" -w "\$PWD" node:24-alpine node "\$@"
EOF
  chmod +x "$shim/node"
  PATH="$shim:$PATH"
fi

# ── throwaway secrets ────────────────────────────────────────────────────────
export ADMIN_API_KEY="$(openssl rand -hex 32)" WEBHOOK_SECRET_KEY="$(openssl rand -hex 32)"
export ADMIN_PASSWORD="Bench-$(openssl rand -hex 16)" WEBHOOK_ENCRYPTION_SALT="Bench-$(openssl rand -hex 16)"
REALM=benchmark CLIENT_ID=benchmark-client USERNAME=benchuser
PASSWORD="Bench-$(openssl rand -hex 12)"
CLIENT_SECRET="$(openssl rand -hex 24)"

# Where each endpoint is and how the client authenticates. Empty means the
# Keycloak-style default in k6/scenario.js; a target's seed script can set
# any of them, along with the scenarios the server cannot run (UNSUPPORTED),
# how it stored the user's password (HASH_INFO) and notes for the report.
export DISCOVERY_PATH="" JWKS_PATH="" TOKEN_PATH="" INTROSPECT_PATH="" CLIENT_AUTH="" TOKEN_SCOPE=""
export INTROSPECT_CLIENT_ID="" INTROSPECT_CLIENT_SECRET="" INTROSPECT_AUTH="" INTROSPECT_TOKEN_GRANT=""
UNSUPPORTED="" HASH_INFO="" NOTES=""

OUT="$RESULTS_DIR/$TARGET"
rm -rf "$OUT" && mkdir -p "$OUT" && chmod 777 "$OUT"   # k6 runs as non-root

case "$TARGET" in
  idenplane)
    FILES=(-f "$HERE/targets/idenplane.yml")
    IMAGE="$IDENPLANE_IMAGE" PORT_IN=3000
    READY_URL="http://127.0.0.1:$PUBLIC_PORT/health/ready" ;;
  keycloak|keycloak-argon2-parity)
    FILES=(-f "$HERE/targets/keycloak.yml")
    [ "$TARGET" = keycloak-argon2-parity ] && FILES+=(-f "$HERE/targets/keycloak-argon2-parity.yml")
    IMAGE="$KEYCLOAK_IMAGE" PORT_IN=8080
    READY_URL="http://127.0.0.1:$HEALTH_PORT/health/ready"
    # Keycloak imports the realm at startup. The plain-text password is
    # hashed on import with whatever hashing settings the server runs with.
    # Keycloak 26 only introspects tokens whose audience includes the
    # caller, so the client gets the audience mapper a resource server has.
    export KEYCLOAK_IMPORT_DIR="$(mktemp -d)"
    chmod 755 "$KEYCLOAK_IMPORT_DIR"
    cat >"$KEYCLOAK_IMPORT_DIR/benchmark-realm.json" <<JSON
{
  "realm": "$REALM", "enabled": true, "bruteForceProtected": false,
  "clients": [{
    "clientId": "$CLIENT_ID", "enabled": true, "publicClient": false,
    "secret": "$CLIENT_SECRET", "standardFlowEnabled": false,
    "directAccessGrantsEnabled": true, "serviceAccountsEnabled": true,
    "redirectUris": ["http://localhost/callback"],
    "protocolMappers": [{
      "name": "audience", "protocol": "openid-connect",
      "protocolMapper": "oidc-audience-mapper",
      "config": { "included.client.audience": "$CLIENT_ID",
                  "access.token.claim": "true", "introspection.token.claim": "true" }
    }]
  }],
  "users": [{
    "username": "$USERNAME", "enabled": true, "email": "$USERNAME@example.com",
    "emailVerified": true, "firstName": "Bench", "lastName": "User",
    "credentials": [{ "type": "password", "value": "$PASSWORD", "temporary": false }]
  }]
}
JSON
    chmod 644 "$KEYCLOAK_IMPORT_DIR/benchmark-realm.json" ;;
  authentik)
    FILES=(-f "$HERE/targets/authentik.yml")
    IMAGE="$AUTHENTIK_IMAGE" PORT_IN=9000
    READY_URL="http://127.0.0.1:$PUBLIC_PORT/-/health/ready/"
    export AUTHENTIK_SECRET_KEY="$(openssl rand -hex 32)" AUTHENTIK_BOOTSTRAP_TOKEN="$(openssl rand -hex 32)" ;;
  zitadel)
    FILES=(-f "$HERE/targets/zitadel.yml")
    IMAGE="$ZITADEL_IMAGE" PORT_IN=8080
    READY_URL="http://127.0.0.1:$PUBLIC_PORT/debug/ready"
    # The admin PAT that start-from-init writes for the seed lands here. The
    # image runs as non-root, and Docker Desktop needs a Windows host path.
    pat_dir="$(mktemp -d)"; chmod 777 "$pat_dir"
    export ZITADEL_MASTERKEY="$(openssl rand -hex 16)" ZITADEL_PAT_DIR="$(host_path "$pat_dir")" ;;
  *) echo "Unknown target: $TARGET" >&2; exit 1 ;;
esac

COMPOSE=(docker compose "${FILES[@]}")
PROJECT="$("${COMPOSE[@]}" config --format json | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>process.stdout.write(JSON.parse(d).name))')"
NETWORK="${PROJECT}_default"
# A target file may carry its own default image; record what compose resolved.
[ -n "$IMAGE" ] || IMAGE="$("${COMPOSE[@]}" config --format json | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>process.stdout.write(JSON.parse(d).services.target.image))')"

# The server under test is every service but its database: one for most,
# a server and a worker for Authentik. They boot, restart and are measured
# together.
SERVER_SVCS=()
for svc in $("${COMPOSE[@]}" config --services); do [ "$svc" = db ] || SERVER_SVCS+=("$svc"); done

teardown() { "${COMPOSE[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true; }
trap teardown EXIT
teardown

wait_ready() {
  local deadline=$(( $(date +%s) + 300 ))
  until curl -fsS -o /dev/null "$READY_URL" 2>/dev/null; do
    if [ "$(date +%s)" -ge "$deadline" ]; then
      "${COMPOSE[@]}" logs --tail 80 target >&2
      echo "target never became ready at $READY_URL" >&2; return 1
    fi
    sleep 0.2
  done
}

# ── 1. images (pulled up front so startup timing excludes downloads) ───────
log "$TARGET: pulling images"
# An image already present is used as it is, so a locally built
# IDENPLANE_IMAGE (one that exists in no registry) can be benchmarked.
for image in $("${COMPOSE[@]}" config --images) "$K6_IMAGE"; do
  docker image inspect "$image" >/dev/null 2>&1 || docker pull --quiet "$image" >/dev/null
done

# ── 2. first boot on an empty database, then a restart ──────────────────────
log "$TARGET: database"
"${COMPOSE[@]}" up -d --wait db

log "$TARGET: first boot"
t0=$(now_ms); "${COMPOSE[@]}" up -d --no-deps "${SERVER_SVCS[@]}"; wait_ready; first_boot_ms=$(( $(now_ms) - t0 ))
echo "ready after ${first_boot_ms} ms" >&2

if [ "$TARGET" = idenplane ]; then
  log "$TARGET: seeding through the admin API"
  seeded="$(GITHUB_ENV= TARGET_URL="http://127.0.0.1:$PUBLIC_PORT" REALM_NAME="$REALM" \
    TEST_CLIENT_ID="$CLIENT_ID" TEST_USERNAME="$USERNAME" TEST_PASSWORD="$PASSWORD" \
    bash "$ROOT/benchmarks/scripts/seed-benchmark-realm.sh")"
  CLIENT_SECRET="$(printf '%s\n' "$seeded" | sed -n 's/^TEST_CLIENT_SECRET=//p')"
elif [ -f "$HERE/seed/$TARGET.sh" ]; then
  # The seed creates the client and user through the server's own API and
  # prints KEY=VALUE lines saying where its endpoints are and what it cannot
  # do (the defaults are at the top). Only known keys are taken.
  log "$TARGET: seeding through its API"
  seeded="$(PUBLIC_URL="http://127.0.0.1:$PUBLIC_PORT" REALM="$REALM" CLIENT_ID="$CLIENT_ID" \
    CLIENT_SECRET="$CLIENT_SECRET" USERNAME="$USERNAME" PASSWORD="$PASSWORD" \
    COMPOSE="${COMPOSE[*]}" bash "$HERE/seed/$TARGET.sh")"
  while IFS= read -r line; do
    key="${line%%=*}" value="${line#*=}"
    case "$key" in
      CLIENT_ID|CLIENT_SECRET|DISCOVERY_PATH|JWKS_PATH|TOKEN_PATH|INTROSPECT_PATH|CLIENT_AUTH|\
      TOKEN_SCOPE|INTROSPECT_CLIENT_ID|INTROSPECT_CLIENT_SECRET|INTROSPECT_AUTH|\
      INTROSPECT_TOKEN_GRANT|UNSUPPORTED|HASH_INFO|NOTES) printf -v "$key" '%s' "$value" ;;
    esac
  done <<<"$seeded"
fi

log "$TARGET: restart"
"${COMPOSE[@]}" stop "${SERVER_SVCS[@]}" >/dev/null
t0=$(now_ms); "${COMPOSE[@]}" start "${SERVER_SVCS[@]}" >/dev/null; wait_ready; restart_ms=$(( $(now_ms) - t0 ))
echo "ready after ${restart_ms} ms" >&2

# Scenarios this server cannot run faithfully are reported, not measured.
RUN_SCENARIOS=""
for s in $SCENARIOS; do
  case " $UNSUPPORTED " in
    *" $s "*) log "$TARGET: $s not supported, skipped" ;;
    *) RUN_SCENARIOS+="$s " ;;
  esac
done

# ── 3. evidence: how the server actually stored the password ────────────────
if [ -n "$HASH_INFO" ]; then
  hash_info="$HASH_INFO"
elif [ "$TARGET" = idenplane ]; then
  hash_info="$("${COMPOSE[@]}" exec -T db psql -U idenplane -d idenplane -tAc \
    "select split_part(password_hash, '\$', 2) || ' ' || split_part(password_hash, '\$', 4) from users where username = '$USERNAME'")"
else
  hash_info="$("${COMPOSE[@]}" exec -T db psql -U keycloak -d keycloak -tAc \
    "select c.credential_data from credential c join user_entity u on u.id = c.user_id where u.username = '$USERNAME' and c.type = 'password'")"
fi
echo "password hash: $hash_info" >&2

# Every container of the server under test except its database (Authentik
# runs a server and a worker), summed into one "<n>MiB / -|<cpu>%" line.
# With a single container the line is docker's own, as before.
CIDS=()
for svc in "${SERVER_SVCS[@]}"; do CIDS+=("$("${COMPOSE[@]}" ps -q "$svc")"); done
stats_once() {
  if [ "${#CIDS[@]}" -eq 1 ]; then
    docker stats --no-stream --format '{{.MemUsage}}|{{.CPUPerc}}' "${CIDS[0]}"
    return
  fi
  docker stats --no-stream --format '{{.MemUsage}}|{{.CPUPerc}}' "${CIDS[@]}" | awk -F'|' '
    function mib(v,  n, u) {
      n = v + 0; u = v; sub(/^[0-9.]+/, "", u)
      if (u == "GiB") return n * 1024;  if (u == "KiB") return n / 1024
      if (u == "B")   return n / 1048576
      if (u == "GB")  return n * 1e9 / 1048576; if (u == "MB") return n * 1e6 / 1048576
      if (u == "kB")  return n * 1e3 / 1048576
      return n
    }
    { split($1, m, " / "); mem += mib(m[1]); cpu += $2 + 0 }
    END { printf "%.1fMiB / -|%.2f%%\n", mem, cpu }'
}

# ── 4. idle memory, after the server has settled ────────────────────────────
log "$TARGET: idle memory (30 s settle, 10 samples)"
sleep 30
for _ in $(seq 10); do stats_once; sleep 1; done >"$OUT/idle.stats"

# ── 5. load ──────────────────────────────────────────────────────────────────
k6_run() { # <scenario> <duration> <summary file or empty>
  local export_args=() threshold_args=(--no-thresholds)
  [ -n "$3" ] && export_args=(--summary-export "/out/$3")
  [ -n "${PREFLIGHT:-}" ] && threshold_args=()
  # Git Bash on Windows rewrites container paths such as /scripts/scenario.js
  # into host paths; turn that off here and hand docker Windows host paths.
  MSYS_NO_PATHCONV=1 docker run --rm --network "$NETWORK" --cpuset-cpus "$K6_CPUS" \
    -v "$(host_path "$HERE/k6"):/scripts:ro" -v "$(host_path "$OUT"):/out" \
    -e SCENARIO="$1" -e DURATION="$2" -e VUS \
    -e BASE_URL="http://target:$PORT_IN" -e REALM="$REALM" -e CLIENT_ID="$CLIENT_ID" \
    -e CLIENT_SECRET="$CLIENT_SECRET" -e USERNAME="$USERNAME" -e PASSWORD="$PASSWORD" \
    -e DISCOVERY_PATH -e JWKS_PATH -e TOKEN_PATH -e INTROSPECT_PATH -e CLIENT_AUTH -e TOKEN_SCOPE \
    -e INTROSPECT_CLIENT_ID -e INTROSPECT_CLIENT_SECRET -e INTROSPECT_AUTH -e INTROSPECT_TOKEN_GRANT \
    -e PREFLIGHT \
    "$K6_IMAGE" run --quiet "${threshold_args[@]}" "${export_args[@]}" /scripts/scenario.js
}

# Every scenario must pass a few times before any load: a misconfigured
# target fails here, loudly, instead of being measured.
log "$TARGET: preflight"
for s in $RUN_SCENARIOS; do
  PREFLIGHT=1 k6_run "$s" 10s "" >/dev/null || { echo "preflight failed: $s" >&2; exit 1; }
done

for s in $RUN_SCENARIOS; do
  log "$TARGET: $s (warm-up $WARMUP, then $RUNS x $DURATION at $VUS VUs)"
  k6_run "$s" "$WARMUP" "" >/dev/null
  for i in $(seq "$RUNS"); do
    ( while :; do stats_once; done ) >"$OUT/$s-$i.stats" &
    sampler=$!
    k6_run "$s" "$DURATION" "$s-$i.json" >/dev/null
    kill "$sampler" 2>/dev/null; wait "$sampler" 2>/dev/null || true
  done
done

# ── 6. what was measured, on what ───────────────────────────────────────────
digest="$(docker image inspect -f '{{index .RepoDigests 0}}' "$IMAGE" 2>/dev/null || echo "$IMAGE")"
size="$(docker image inspect -f '{{.Size}}' "$IMAGE")"
TARGET="$TARGET" IMAGE="$IMAGE" DIGEST="$digest" SIZE="$size" FIRST_BOOT_MS="$first_boot_ms" \
RESTART_MS="$restart_ms" HASH_INFO="$hash_info" SCENARIOS="$SCENARIOS" RUNS="$RUNS" WARMUP="$WARMUP" \
HOST_CPUS="$cpus" HOST_MEM="$(free -b 2>/dev/null | awk '/^Mem:/{print $2}')" \
CPU_MODEL="$(grep -m1 'model name' /proc/cpuinfo 2>/dev/null | cut -d: -f2- | sed 's/^ *//')" \
K6_IMAGE="$K6_IMAGE" UNSUPPORTED="$UNSUPPORTED" NOTES="$NOTES" INTROSPECT_TOKEN_GRANT="$INTROSPECT_TOKEN_GRANT" \
NODE_PASS_ENV="TARGET IMAGE DIGEST SIZE FIRST_BOOT_MS RESTART_MS HASH_INFO SCENARIOS RUNS WARMUP VUS DURATION TARGET_CPUS DB_CPUS K6_CPUS TARGET_MEM HOST_CPUS HOST_MEM CPU_MODEL K6_IMAGE UNSUPPORTED NOTES INTROSPECT_TOKEN_GRANT" \
node -e '
const e = process.env;
process.stdout.write(JSON.stringify({
  target: e.TARGET, image: e.IMAGE, digest: e.DIGEST, imageBytes: Number(e.SIZE),
  firstBootMs: Number(e.FIRST_BOOT_MS), restartMs: Number(e.RESTART_MS),
  passwordHash: e.HASH_INFO.trim(),
  scenarios: e.SCENARIOS.split(/\s+/).filter(Boolean), runs: Number(e.RUNS),
  vus: Number(e.VUS), duration: e.DURATION, warmup: e.WARMUP,
  cpus: { target: e.TARGET_CPUS, db: e.DB_CPUS, k6: e.K6_CPUS }, targetMem: e.TARGET_MEM,
  host: { cpus: Number(e.HOST_CPUS), memBytes: Number(e.HOST_MEM) || null, cpuModel: e.CPU_MODEL || null },
  unsupported: e.UNSUPPORTED.split(/\s+/).filter(Boolean),
  introspectTokenGrant: e.INTROSPECT_TOKEN_GRANT, notes: e.NOTES || null,
  k6: e.K6_IMAGE, finishedAt: new Date().toISOString(),
}, null, 2));
' >"$OUT/meta.json"
log "$TARGET: done -> $OUT"
