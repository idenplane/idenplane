#!/usr/bin/env bash
# Runs the steps of docs/docs/contributing/development-setup.mdx, in order,
# the way a new contributor would, and fails if any of them doesn't do what
# the page says. CI runs it on Linux, macOS and Windows (WSL 2) — see
# .github/workflows/dev-setup.yml. If you change a step here, change the page
# too (and the other way round).
#
#   DB_MODE=docker    (default) start Postgres with `docker compose up -d db`
#   DB_MODE=external  use a Postgres that is already running at DATABASE_URL
set -euo pipefail

DB_MODE="${DB_MODE:-docker}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
pids=()
cleanup() { for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT

# Wait until `url` answers 2xx, or fail after `seconds`.
wait_for() {
  local url="$1" seconds="$2" log="${3:-}"
  for _ in $(seq 1 "$seconds"); do
    if curl -fsS -o /dev/null "$url"; then return 0; fi
    sleep 1
  done
  echo "Timed out waiting for $url" >&2
  if [ -n "$log" ]; then tail -n 80 "$log" >&2; fi
  return 1
}

# Portable in-place edit of one KEY=value line in .env (GNU and BSD sed).
set_env() {
  local key="$1" value="$2"
  sed -i.bak "s|^${key}=.*|${key}=${value}|" .env && rm -f .env.bak
  grep -q "^${key}=${value}\$" .env || { echo "could not set $key" >&2; exit 1; }
}

step "Prerequisites"
node --version
npm --version
git --version
node -e 'const [maj] = process.versions.node.split("."); if (+maj < 22) { console.error("Node 22+ required"); process.exit(1); }'

step "Backend: npm install"
npm install --no-audit --no-fund

step "Backend: node scripts/setup-env.cjs"
if [ -e .env ]; then
  echo ".env already exists; move it away first (this script follows the guide from a clean checkout)" >&2
  exit 1
fi
node scripts/setup-env.cjs
if grep -n 'REPLACE_ME' .env; then
  echo "setup-env.cjs left a placeholder in .env" >&2
  exit 1
fi
if [ "$DB_MODE" != "docker" ]; then
  # The guide's "own Postgres" section: point DATABASE_URL at that role.
  set_env DATABASE_URL "postgresql://idenplane:idenplane@localhost:5432/idenplane"
fi

if [ "$DB_MODE" = "docker" ]; then
  step "Backend: docker compose up -d db"
  docker compose up -d db
  # Over TCP, not the socket: on first start the image runs a temporary
  # server, socket only, to initialise the database, then restarts. Over the
  # socket that one answers "ready" and then shuts down under the next step.
  for _ in $(seq 1 60); do
    docker compose exec -T db pg_isready -h 127.0.0.1 -U idenplane >/dev/null 2>&1 && break
    sleep 1
  done
  docker compose exec -T db pg_isready -h 127.0.0.1 -U idenplane
else
  step "Backend: using the Postgres already running at DATABASE_URL"
fi

step "Backend: npm run db:setup"
npm run db:setup

step "Backend: npm run start:dev"
npm run start:dev > /tmp/idenplane-backend.log 2>&1 &
pids+=($!)
wait_for http://localhost:3000/health/ready 240 /tmp/idenplane-backend.log
echo "backend is up"

step "Admin console: cd admin-ui && npm install && npm run dev"
(
  cd admin-ui
  npm install --no-audit --no-fund
  npm run dev -- --strictPort > /tmp/idenplane-console.log 2>&1 &
  echo $! > /tmp/idenplane-console.pid
)
pids+=("$(cat /tmp/idenplane-console.pid)")
wait_for http://localhost:5173/console/ 120 /tmp/idenplane-console.log
# The console reaches the backend through Vite's proxy.
wait_for http://localhost:5173/health/ready 30 /tmp/idenplane-console.log
echo "console is up and proxies to the backend"

step "Tests: npm test (no database needed)"
npm test -- --silent

step "Docs: cd docs && npm install && npm run build"
(
  cd docs
  npm install --no-audit --no-fund
  npm run build
)

step "Every step of the development setup guide worked"
