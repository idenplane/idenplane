#!/usr/bin/env bash
# Installs the Helm chart on the current kube context (a throwaway kind
# cluster in CI), signs in with the generated admin password, upgrades the
# release and checks that the generated keys survived the upgrade.
#
# Input (environment):
#   IMAGE_REPOSITORY, IMAGE_TAG  image already loaded into the cluster
#   RELEASE                      release name (default: idp)
set -euo pipefail

RELEASE="${RELEASE:-idp}"
CHART="$(cd "$(dirname "$0")/.." && pwd)/helm/idenplane"
: "${IMAGE_REPOSITORY:?Set IMAGE_REPOSITORY}"
: "${IMAGE_TAG:?Set IMAGE_TAG}"

step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
pf_pid=""
cleanup() { [ -n "$pf_pid" ] && kill "$pf_pid" 2>/dev/null || true; }
trap cleanup EXIT

diagnose() {
  kubectl get pods -o wide || true
  kubectl describe pods -l "app.kubernetes.io/instance=$RELEASE" | tail -n 60 || true
  kubectl logs -l "app.kubernetes.io/name=idenplane,app.kubernetes.io/instance=$RELEASE" --tail=120 || true
  for component in postgresql redis; do
    kubectl logs -l "app.kubernetes.io/component=$component,app.kubernetes.io/instance=$RELEASE" --tail=60 --all-containers || true
    kubectl logs -l "app.kubernetes.io/component=$component,app.kubernetes.io/instance=$RELEASE" --tail=60 --previous || true
  done
}

keys() {
  kubectl get secret "$RELEASE-idenplane-keys" -o jsonpath='{.data}'
}

secret_value() {
  kubectl get secret "$RELEASE-idenplane-keys" -o jsonpath="{.data.$1}" | base64 -d
}

step "Render refuses placeholder credentials"
for bad in "secrets.ADMIN_API_KEY=change-me-in-production" "secrets.ADMIN_PASSWORD=admin"; do
  if helm template "$RELEASE" "$CHART" --set "$bad" >/dev/null 2>&1; then
    echo "helm template accepted --set $bad" >&2
    exit 1
  fi
done
if helm template "$RELEASE" "$CHART" --set postgresql.enabled=false >/dev/null 2>&1; then
  echo "helm template accepted an external database without secrets.DATABASE_URL" >&2
  exit 1
fi

step "helm install with generated keys"
if ! helm install "$RELEASE" "$CHART" \
  --set image.repository="$IMAGE_REPOSITORY" \
  --set image.tag="$IMAGE_TAG" \
  --set image.pullPolicy=Never \
  --set env.BASE_URL=http://localhost:3000 \
  --wait --timeout 10m; then
  diagnose
  exit 1
fi

before="$(keys)"
for key in ADMIN_API_KEY ADMIN_PASSWORD WEBHOOK_SECRET_KEY WEBHOOK_ENCRYPTION_SALT; do
  value="$(secret_value "$key")"
  if [ "${#value}" -lt 32 ]; then
    echo "$key is missing or shorter than 32 characters" >&2
    exit 1
  fi
done

step "Sign in as admin with the generated password"
kubectl port-forward "svc/$RELEASE-idenplane" 18080:3000 >/tmp/helm-port-forward.log 2>&1 &
pf_pid=$!
for _ in $(seq 1 30); do
  curl -fsS -o /dev/null http://127.0.0.1:18080/health/ready && break
  sleep 1
done
curl -fsS http://127.0.0.1:18080/health/ready >/dev/null

password="$(secret_value ADMIN_PASSWORD)"
body="$(node -e 'process.stdout.write(JSON.stringify({username: "admin", password: process.argv[1]}))' "$password")"
status="$(curl -sS -o /tmp/helm-login.json -w '%{http_code}' \
  -H 'Content-Type: application/json' -d "$body" \
  http://127.0.0.1:18080/admin/auth/login)"
if [ "$status" != "200" ] || ! grep -q '"access_token"' /tmp/helm-login.json; then
  echo "admin login with the generated password returned HTTP $status" >&2
  exit 1
fi
wrong="$(curl -sS -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin"}' http://127.0.0.1:18080/admin/auth/login)"
if [ "$wrong" = "200" ]; then
  echo "the default admin/admin password was accepted" >&2
  exit 1
fi
kill "$pf_pid" 2>/dev/null || true
pf_pid=""

step "helm upgrade keeps the generated keys"
if ! helm upgrade "$RELEASE" "$CHART" --reuse-values \
  --set-string env.THROTTLE_LIMIT=150 \
  --wait --timeout 10m; then
  diagnose
  exit 1
fi
after="$(keys)"
if [ "$before" != "$after" ]; then
  echo "helm upgrade changed the generated keys" >&2
  exit 1
fi

step "helm test"
helm test "$RELEASE" --logs

echo "Helm install, sign-in, upgrade and test passed."
