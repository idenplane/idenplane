#!/usr/bin/env bash
# Image-level test of unattended bootstrap (BOOTSTRAP_FILE / BOOTSTRAP_JSON),
# with the Docker image alone, as `docker run` / Docker Compose run it:
#
#  1. two containers start together on an empty database with the same
#     mounted bootstrap file: the realm is created once, the wizard is closed,
#     the declared client gets tokens, and no secret reaches the logs;
#  2. a restart changes nothing;
#  3. on another empty database, an invalid BOOTSTRAP_JSON stops the
#     container before it is ever ready and writes nothing; fixed, the next
#     start applies it.
#
# Needs only Docker; nothing is published on the host. Set IDENPLANE_IMAGE to
# test a built image, or the image is built from this checkout.
set -euo pipefail
source "$(dirname "$0")/../lib/common.sh"

NET="idp-bootstrap-$$"
DB="bootstrap-db-$$"
DB2="bootstrap-db2-$$"
APPS=()
WORK="$(mktemp -d)"
chmod 755 "$WORK"

cleanup() {
  docker rm -f "${APPS[@]}" "$DB" "$DB2" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  rm -rf "$WORK" || true
}
trap cleanup EXIT

ci_common_secrets
ci_secret CLIENT_SECRET "ci-client-"
ci_secret OWNER_PASSWORD "ci-owner-"
ci_image
ci_net_up "$NET"

REALM=acme
CLIENT_ID=acme-service

cat > "$WORK/bootstrap.json" <<JSON
{
  "version": 1,
  "realms": [
    {
      "version": 2,
      "realm": { "name": "$REALM", "displayName": "Acme" },
      "roles": [{ "name": "app-admin" }],
      "clients": [
        {
          "clientId": "$CLIENT_ID",
          "clientSecret": "\${env:ACME_CLIENT_SECRET}",
          "redirectUris": ["https://app.example.com/callback"],
          "grantTypes": ["authorization_code", "client_credentials"]
        }
      ],
      "users": [
        {
          "username": "owner",
          "email": "owner@example.com",
          "initialPassword": "\${env:ACME_OWNER_PASSWORD}",
          "roles": [{ "name": "app-admin" }]
        }
      ]
    }
  ]
}
JSON
chmod 644 "$WORK/bootstrap.json"

# start NAME DB [extra docker run args...]
start() {
  local name="$1" db="$2"; shift 2
  APPS+=("$name")
  APP_ALIAS="$name" ci_app_start "$name" "$NET" "$IDENPLANE_IMAGE" "$db" \
    -e ACME_CLIENT_SECRET="$CLIENT_SECRET" -e ACME_OWNER_PASSWORD="$OWNER_PASSWORD" "$@"
}
with_file=(-v "$WORK/bootstrap.json:/etc/idenplane/bootstrap.json:ro"
  -e BOOTSTRAP_FILE=/etc/idenplane/bootstrap.json)

check() {
  ci_node "$NET" "$WORK" bootstrap/check.mjs \
    -e IDENPLANE_URL="http://$1:3000" -e REALM="$REALM" \
    -e CLIENT_ID="$CLIENT_ID" -e CLIENT_SECRET="$CLIENT_SECRET"
}

no_secrets_in_logs() {
  for app in "$@"; do
    for value in "$CLIENT_SECRET" "$OWNER_PASSWORD"; do
      if docker logs "$app" 2>&1 | grep -qF "$value"; then
        echo "::error::a bootstrap secret appears in the logs of $app"; exit 1
      fi
    done
  done
}

ci_log "1. two instances start together on an empty database"
ci_pg_start "$DB" "$NET"
start app-a "$DB" "${with_file[@]}"
start app-b "$DB" "${with_file[@]}"
ci_app_wait app-a
ci_app_wait app-b
applied=$( (docker logs app-a 2>&1; docker logs app-b 2>&1) | grep -c "Instance bootstrapped from BOOTSTRAP_FILE" || true)
skipped=$( (docker logs app-a 2>&1; docker logs app-b 2>&1) | grep -c "Setup is already complete; BOOTSTRAP_FILE" || true)
echo "applied: $applied, found complete: $skipped"
[ "$applied" = 1 ] && [ "$skipped" = 1 ] || { echo "::error::expected exactly one instance to apply the bootstrap"; exit 1; }
check app-a
check app-b
no_secrets_in_logs app-a app-b

ci_log "2. a restart changes nothing"
# docker logs keeps the output of the first run, which may or may not be
# the one that applied it: compare the counts before and after.
count_applied() { docker logs app-a 2>&1 | grep -c 'Instance bootstrapped from' || true; }
count_complete() { docker logs app-a 2>&1 | grep -c 'Setup is already complete; BOOTSTRAP_FILE' || true; }
applied_before="$(count_applied)"; complete_before="$(count_complete)"
docker restart app-a >/dev/null
ci_app_wait app-a
[ "$(count_applied)" = "$applied_before" ] || { echo "::error::bootstrap applied again on restart"; exit 1; }
[ "$(count_complete)" = "$((complete_before + 1))" ] || { echo "::error::the restart did not report setup complete"; exit 1; }
check app-a

ci_log "3. an invalid BOOTSTRAP_JSON stops the container and writes nothing"
ci_pg_start "$DB2" "$NET"
bad="$(sed 's/"clientSecret": "${env:ACME_CLIENT_SECRET}",//' "$WORK/bootstrap.json")"
start app-bad "$DB2" -e BOOTSTRAP_JSON="$bad"
for _ in $(seq 1 180); do
  [ "$(docker inspect -f '{{.State.Running}}' app-bad)" = "true" ] || break
  if docker exec app-bad wget -q -O /dev/null http://localhost:3000/health/ready 2>/dev/null; then
    echo "::error::the instance became ready with an invalid bootstrap"; exit 1
  fi
  sleep 1
done
code="$(docker inspect -f '{{.State.ExitCode}}' app-bad)"
[ "$(docker inspect -f '{{.State.Running}}' app-bad)" = "false" ] && [ "$code" != 0 ] \
  || { echo "::error::the container did not stop (exit code $code)"; exit 1; }
docker logs app-bad 2>&1 | grep -q "Instance bootstrap (BOOTSTRAP_JSON) failed; nothing was applied" \
  || { echo "::error::no bootstrap failure in the log"; docker logs app-bad 2>&1 | tail -40; exit 1; }
echo "stopped with exit code $code"
realms="$(docker exec "$DB2" psql -U idenplane -d idenplane -tAc "SELECT count(*) FROM realms WHERE name = '$REALM'")"
[ "$realms" = 0 ] || { echo "::error::the failed bootstrap left a realm behind"; exit 1; }
no_secrets_in_logs app-bad

ci_log "3b. fixed, the next start applies it"
start app-fixed "$DB2" -e BOOTSTRAP_JSON="$(cat "$WORK/bootstrap.json")"
ci_app_wait app-fixed
check app-fixed
no_secrets_in_logs app-fixed

ci_log "unattended bootstrap: all checks passed"
