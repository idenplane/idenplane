# shellcheck shell=bash
# Shared shell helpers for the CI drills (sourced, not executed).
#
# Everything runs in containers on one user-defined Docker network, so the
# same script works on a GitHub runner and on any host with only Docker:
# no published ports, no Node or PostgreSQL client on the host.

CI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$CI_DIR/../.." && pwd)"
NODE_IMAGE="${NODE_IMAGE:-node:24-alpine}"
PG_IMAGE="${PG_IMAGE:-postgres:16-alpine}"

ci_log() { printf '\n==> %s\n' "$*"; }

# ci_secret NAME [PREFIX] — a random throwaway value, exported and masked.
ci_secret() {
  local name="$1" prefix="${2:-}" value
  value="${prefix}$(openssl rand -hex 24)"
  [ -n "${GITHUB_ACTIONS:-}" ] && echo "::add-mask::${value}"
  export "${name}=${value}"
}

ci_net_up() {
  docker network inspect "$1" >/dev/null 2>&1 || docker network create "$1" >/dev/null
}

# ci_pg_start NAME NETWORK — PostgreSQL 16 with a database "idenplane".
ci_pg_start() {
  local name="$1" net="$2"
  docker run -d --name "$name" --network "$net" \
    -e POSTGRES_USER=idenplane -e POSTGRES_PASSWORD="$PG_PASSWORD" -e POSTGRES_DB=idenplane \
    "$PG_IMAGE" >/dev/null
  for _ in $(seq 1 60); do
    # TCP, not the socket: during initdb the image runs a temporary server
    # that only listens on the socket, then restarts.
    docker exec "$name" pg_isready -h 127.0.0.1 -U idenplane -d idenplane >/dev/null 2>&1 && return 0
    sleep 1
  done
  echo "::error::PostgreSQL container $name did not become ready"; docker logs "$name" | tail -50; return 1
}

# ci_app_start NAME NETWORK IMAGE DB_HOST [extra docker run args...]
# Production mode with the keys from the environment, so stored secrets are
# encrypted the way a real deployment encrypts them. The app is reachable as
# http://$APP_ALIAS:3000 (default: NAME), which is also its BASE_URL: keep the
# alias when one instance replaces another, or the token issuer changes.
ci_app_start() {
  local name="$1" net="$2" image="$3" dbhost="$4"; shift 4
  local alias="${APP_ALIAS:-$name}"
  docker run -d --name "$name" --network "$net" --network-alias "$alias" \
    -e DATABASE_URL="postgresql://idenplane:${PG_PASSWORD}@${dbhost}:5432/idenplane" \
    -e NODE_ENV=production -e PORT=3000 \
    -e BASE_URL="http://${alias}:3000" \
    -e ADMIN_API_KEY="$ADMIN_API_KEY" -e ADMIN_USER=admin -e ADMIN_PASSWORD="$ADMIN_PASSWORD" \
    -e WEBHOOK_SECRET_KEY="$WEBHOOK_SECRET_KEY" -e WEBHOOK_ENCRYPTION_SALT="$WEBHOOK_ENCRYPTION_SALT" \
    -e THROTTLE_LIMIT=100000 -e ADMIN_API_KEY_RL_PER_MINUTE=100000 -e ADMIN_API_KEY_RL_PER_HOUR=1000000 \
    "$@" "$image" >/dev/null
}

# ci_app_wait NAME [SECONDS] — waits for /health/ready; fails if the
# container exits first.
ci_app_wait() {
  local name="$1" limit="${2:-180}"
  for _ in $(seq 1 "$limit"); do
    if [ "$(docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null)" != "true" ]; then
      echo "::error::container $name exited before it was ready"; docker logs "$name" 2>&1 | tail -80; return 1
    fi
    docker exec "$name" wget -q -O /dev/null http://localhost:3000/health/ready 2>/dev/null && return 0
    sleep 1
  done
  echo "::error::$name not ready after ${limit}s"; docker logs "$name" 2>&1 | tail -80; return 1
}

# ci_expect_startup_failure NAME TEXT — the container NAME must stop with a
# non-zero exit code without ever being ready, and say why exactly once: as
# its last stdout line, a JSON log line at error level (50) in context
# "Startup" whose msg contains TEXT, and nowhere on stderr (no bare Node
# stack). The logs are read into files first: `docker logs | grep -q` under
# pipefail fails at random, as grep exits on the first match and docker logs
# then dies writing the rest into a closed pipe.
ci_expect_startup_failure() {
  local name="$1" text="$2" dir out err code count last
  for _ in $(seq 1 180); do
    [ "$(docker inspect -f '{{.State.Running}}' "$name")" = "true" ] || break
    if docker exec "$name" wget -q -O /dev/null http://localhost:3000/health/ready 2>/dev/null; then
      echo "::error::$name became ready; it was expected to refuse to start"; return 1
    fi
    sleep 1
  done
  code="$(docker inspect -f '{{.State.ExitCode}}' "$name")"
  if [ "$(docker inspect -f '{{.State.Running}}' "$name")" != "false" ] || [ "$code" = 0 ]; then
    echo "::error::$name did not stop with an error (running: $(docker inspect -f '{{.State.Running}}' "$name"), exit code $code)"; return 1
  fi
  dir="$(mktemp -d)"; out="$dir/stdout"; err="$dir/stderr"
  docker logs "$name" >"$out" 2>"$err"
  count="$(grep -cF -- "$text" "$out" || true)"
  last="$(grep -v '^[[:space:]]*$' "$out" | tail -n 1)"
  if [ "$count" != 1 ]; then
    echo "::error::$name: expected the reason exactly once on stdout, found it $count time(s): $text"
    tail -n 20 "$out"; echo "--- stderr"; tail -n 40 "$err"; return 1
  fi
  case "$last" in
    *'"level":50'*'"context":"Startup"'*) ;;
    *) echo "::error::$name: the last log line is not the startup failure at error level"; echo "$last"; return 1 ;;
  esac
  case "$last" in
    *"$text"*) ;;
    *) echo "::error::$name: the last log line is not this failure"; echo "$last"; return 1 ;;
  esac
  if grep -qF -- "$text" "$err"; then
    echo "::error::$name: the reason was also written to stderr"; tail -n 40 "$err"; return 1
  fi
  echo "$name stopped with exit code $code; reason logged once, last, at error level"
  rm -rf "$dir"
}

# ci_node NETWORK OUT_DIR SCRIPT [env args...] — runs a scripts/ci Node script
# in a throwaway container; OUT_DIR is mounted at /out.
ci_node() {
  local net="$1" out="$2" script="$3"; shift 3
  docker run --rm --network "$net" \
    -v "$CI_DIR:/ci:ro" -v "$out:/out" \
    -e ADMIN_API_KEY="$ADMIN_API_KEY" -e GITHUB_STEP_SUMMARY=/out/summary.md \
    "$@" "$NODE_IMAGE" node "/ci/$script"
}

# Appends what a Node step wrote to the job summary, when there is one.
ci_flush_summary() {
  local out="$1"
  if [ -f "$out/summary.md" ]; then
    [ -n "${GITHUB_STEP_SUMMARY:-}" ] && cat "$out/summary.md" >> "$GITHUB_STEP_SUMMARY"
    cat "$out/summary.md"; rm -f "$out/summary.md"
  fi
}

# Builds the image from this checkout unless IDENPLANE_IMAGE names one.
ci_image() {
  if [ -n "${IDENPLANE_IMAGE:-}" ]; then
    docker image inspect "$IDENPLANE_IMAGE" >/dev/null 2>&1 || docker pull -q "$IDENPLANE_IMAGE" >/dev/null
  else
    IDENPLANE_IMAGE=idenplane:ci-drill
    ci_log "building $IDENPLANE_IMAGE from $REPO_ROOT"
    docker build -q -t "$IDENPLANE_IMAGE" "$REPO_ROOT" >/dev/null
  fi
  export IDENPLANE_IMAGE
}

ci_common_secrets() {
  ci_secret PG_PASSWORD
  ci_secret ADMIN_API_KEY
  ci_secret ADMIN_PASSWORD "Adm1n-"
  ci_secret WEBHOOK_SECRET_KEY
  ci_secret WEBHOOK_ENCRYPTION_SALT
}
