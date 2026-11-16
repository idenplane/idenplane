#!/usr/bin/env bash
# Backup -> restore drill.
#
#   1. Start Idenplane (image from this checkout, or IDENPLANE_IMAGE) on a
#      PostgreSQL 16 database and seed it: a realm, a confidential client, a
#      password user and a TOTP user, a live refresh token.
#   2. Back it up the way the docs and the built-in upgrade backup do: pg_dump
#      custom format (-Fc), using the pg_dump that ships in the image.
#   3. Throw the database away. Restore the archive into a brand-new
#      PostgreSQL with pg_restore --clean --if-exists --no-owner.
#   4. Start Idenplane against the restore with the same keys and check
#      sign-in (password, password + TOTP), client_credentials with the old
#      secret, the old refresh token, and that tokens are signed with the
#      same keys as before.
#   5. Start it once more with a DIFFERENT WEBHOOK_SECRET_KEY and check it
#      refuses to start: the restore is only usable with the original keys.
#
# Needs only Docker and openssl. Writes to OUT_DIR (default ./drill-out):
# the archive's table of contents and container logs; never the secrets.
set -euo pipefail
source "$(dirname "$0")/lib/common.sh"

OUT_DIR="${OUT_DIR:-$PWD/drill-out}"
NET="idp-drill-$$"
mkdir -p "$OUT_DIR" && chmod 777 "$OUT_DIR"
WORK="$(mktemp -d)" && chmod 777 "$WORK"
STATE="/out/state.json"

cleanup() {
  for c in drill-app-a drill-app-b drill-app-wrongkey drill-db-a drill-db-b; do
    docker logs "$c" > "$OUT_DIR/$c.log" 2>&1 || true
    docker rm -f "$c" >/dev/null 2>&1 || true
  done
  docker network rm "$NET" >/dev/null 2>&1 || true
  rm -rf "$WORK" || true
}
trap cleanup EXIT

ci_common_secrets
ci_image
ci_net_up "$NET"
export APP_ALIAS=drill-app

ci_log "1/5 seed: $IDENPLANE_IMAGE on PostgreSQL 16"
ci_pg_start drill-db-a "$NET"
ci_app_start drill-app-a "$NET" "$IDENPLANE_IMAGE" drill-db-a
ci_app_wait drill-app-a
ci_node "$NET" "$WORK" drill/seed.mjs -e IDENPLANE_URL=http://drill-app:3000 -e STATE_FILE="$STATE"

ci_log "2/5 backup: pg_dump --format=custom (the image's own pg_dump)"
docker run --rm --network "$NET" --entrypoint pg_dump -v "$WORK:/out" \
  -e PGPASSWORD="$PG_PASSWORD" "$IDENPLANE_IMAGE" \
  --format=custom --file=/out/idenplane.dump \
  --host=drill-db-a --username=idenplane --dbname=idenplane
docker run --rm --entrypoint pg_dump "$IDENPLANE_IMAGE" --version
docker run --rm --entrypoint pg_restore -v "$WORK:/out:ro" "$IDENPLANE_IMAGE" --list /out/idenplane.dump > "$OUT_DIR/backup-toc.txt"
echo "archive: $(du -h "$WORK/idenplane.dump" | cut -f1), $(grep -c 'TABLE DATA' "$OUT_DIR/backup-toc.txt") tables with data"

ci_log "3/5 lose the original, restore into a fresh database"
docker rm -f drill-app-a drill-db-a >/dev/null
ci_pg_start drill-db-b "$NET"
docker run --rm --network "$NET" --entrypoint pg_restore -v "$WORK:/out:ro" \
  -e PGPASSWORD="$PG_PASSWORD" "$IDENPLANE_IMAGE" \
  --clean --if-exists --no-owner --no-privileges --single-transaction --exit-on-error \
  --host=drill-db-b --username=idenplane --dbname=idenplane /out/idenplane.dump

ci_log "4/5 start against the restore with the same keys, and verify"
ci_app_start drill-app-b "$NET" "$IDENPLANE_IMAGE" drill-db-b
ci_app_wait drill-app-b
status=0
ci_node "$NET" "$WORK" drill/verify.mjs -e IDENPLANE_URL=http://drill-app:3000 -e STATE_FILE="$STATE" \
  -e VERIFY_LABEL="Restore drill: after restore into a fresh database" || status=1
ci_flush_summary "$WORK"
docker rm -f drill-app-b >/dev/null
[ "$status" -eq 0 ] || { echo "::error::restore drill: checks failed against the restored database"; exit 1; }

ci_log "5/5 the same restore with a different encryption key must refuse to start"
WRONG_KEY="$(openssl rand -hex 32)"
ci_app_start drill-app-wrongkey "$NET" "$IDENPLANE_IMAGE" drill-db-b -e WEBHOOK_SECRET_KEY="$WRONG_KEY"
refused=false
for _ in $(seq 1 120); do
  if [ "$(docker inspect -f '{{.State.Running}}' drill-app-wrongkey)" != "true" ]; then refused=true; break; fi
  if docker exec drill-app-wrongkey wget -q -O /dev/null http://localhost:3000/health/ready 2>/dev/null; then break; fi
  sleep 1
done
if [ "$refused" != true ]; then
  echo "::error::Idenplane started on the restored data with the wrong WEBHOOK_SECRET_KEY"
  docker logs drill-app-wrongkey 2>&1 | tail -40
  exit 1
fi
# Not `docker logs | grep -q`: under pipefail, grep -q exiting at the first
# match makes docker logs die of SIGPIPE and the pipeline report failure.
wrongkey_log="$(docker logs drill-app-wrongkey 2>&1 || true)"
if ! grep -q 'StoredSecretsKeyError' <<< "$wrongkey_log"; then
  echo "::error::Idenplane stopped, but not because of the key check"; docker logs drill-app-wrongkey 2>&1 | tail -40; exit 1
fi
echo "refused to start with the wrong key (StoredSecretsKeyError), as it should"

summary="Restore drill passed: pg_dump -Fc -> fresh PostgreSQL 16 -> same keys: sign-in, TOTP, client secret, refresh token and signing keys all survived; a wrong key is refused."
echo "$summary"
[ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "$summary" >> "$GITHUB_STEP_SUMMARY"
exit 0
