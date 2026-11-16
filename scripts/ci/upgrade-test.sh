#!/usr/bin/env bash
# Upgrade test: previous release -> this commit, same database, same keys.
#
#   1. Run the previous release's published image (PREV_IMAGE, or
#      islamawad/idenplane:<latest v* tag before HEAD>) and seed it.
#   2. Verify the data works on the old version.
#   3. Stop it and start the image built from this commit (or IDENPLANE_IMAGE)
#      on the same database with the same WEBHOOK_SECRET_KEY / SALT. Its
#      entrypoint runs `prisma migrate deploy`.
#   4. Check every migration in prisma/migrations is applied and none failed,
#      the server reports the new version, and sign-in (password and TOTP),
#      the stored client secret, the old refresh token and the signing keys
#      still work.
#
# Needs Docker, openssl and git history with tags (fetch-depth: 0).
set -euo pipefail
source "$(dirname "$0")/lib/common.sh"

OUT_DIR="${OUT_DIR:-$PWD/upgrade-out}"
NET="idp-upgrade-$$"
mkdir -p "$OUT_DIR" && chmod 777 "$OUT_DIR"
WORK="$(mktemp -d)" && chmod 777 "$WORK"
STATE="/out/state.json"

cleanup() {
  for c in upg-app-old upg-app-new upg-db; do
    docker logs "$c" > "$OUT_DIR/$c.log" 2>&1 || true
    docker rm -f "$c" >/dev/null 2>&1 || true
  done
  docker network rm "$NET" >/dev/null 2>&1 || true
  rm -rf "$WORK" || true
}
trap cleanup EXIT

# The latest release tag reachable from HEAD that is not HEAD itself — on a
# tag push, the release being made is excluded and its predecessor is used.
previous_tag() {
  local head_tags
  head_tags="$(git -C "$REPO_ROOT" tag --points-at HEAD --list 'v[0-9]*' || true)"
  git -C "$REPO_ROOT" tag --merged HEAD --list 'v[0-9]*.[0-9]*.[0-9]*' --sort=-v:refname \
    | grep -vxF -f <(printf '%s\n' "$head_tags" | sed '/^$/d'; echo '__none__') \
    | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1
}

if [ -z "${PREV_IMAGE:-}" ]; then
  PREV_TAG="$(previous_tag)"
  [ -n "$PREV_TAG" ] || { echo "::error::no previous v* tag reachable from HEAD (fetch-depth: 0?)"; exit 1; }
  PREV_IMAGE="islamawad/idenplane:${PREV_TAG#v}"
fi
ci_common_secrets
ci_image
NEW_VERSION="$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "$REPO_ROOT/package.json" | head -1)"
EXPECTED_MIGRATIONS="$(find "$REPO_ROOT/prisma/migrations" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
ci_log "upgrade $PREV_IMAGE -> $IDENPLANE_IMAGE ($NEW_VERSION, $EXPECTED_MIGRATIONS migrations)"
docker pull -q "$PREV_IMAGE" >/dev/null
ci_net_up "$NET"
export APP_ALIAS=upg-app

ci_log "1/4 previous release, seeded"
ci_pg_start upg-db "$NET"
ci_app_start upg-app-old "$NET" "$PREV_IMAGE" upg-db
ci_app_wait upg-app-old 240
ci_node "$NET" "$WORK" drill/seed.mjs -e IDENPLANE_URL=http://upg-app:3000 -e STATE_FILE="$STATE"

ci_log "2/4 sanity on the previous release"
ci_node "$NET" "$WORK" drill/verify.mjs -e IDENPLANE_URL=http://upg-app:3000 -e STATE_FILE="$STATE" \
  -e VERIFY_LABEL="Upgrade test: on ${PREV_IMAGE}"
ci_flush_summary "$WORK"

ci_log "3/4 stop it; start this commit's image on the same database and keys"
docker stop -t 30 upg-app-old >/dev/null
docker logs upg-app-old > "$OUT_DIR/upg-app-old.log" 2>&1 || true
docker rm upg-app-old >/dev/null
ci_app_start upg-app-new "$NET" "$IDENPLANE_IMAGE" upg-db
ci_app_wait upg-app-new 300

ci_log "4/4 migrations, version, and the stored data"
status=0
psql_q() { docker exec upg-db psql -U idenplane -d idenplane -tAc "$1"; }
applied="$(psql_q "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL")"
broken="$(psql_q "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL")"
echo "migrations applied: $applied (expected $EXPECTED_MIGRATIONS), failed or rolled back: $broken"
if [ "$applied" != "$EXPECTED_MIGRATIONS" ] || [ "$broken" != "0" ]; then
  echo "::error::migrations after upgrade: applied=$applied expected=$EXPECTED_MIGRATIONS broken=$broken"; status=1
fi
reported="$(docker run --rm --network "$NET" -e K="$ADMIN_API_KEY" "$NODE_IMAGE" node -e "
  fetch('http://upg-app:3000/admin/system/version',{headers:{'x-admin-api-key':process.env.K}})
    .then(r=>r.json()).then(j=>console.log(j.version ?? j.currentVersion ?? JSON.stringify(j)))" || true)"
echo "server reports version: $reported (package.json: $NEW_VERSION)"
if [ -z "${IDENPLANE_IMAGE_IS_EXTERNAL:-}" ] && [ "$reported" != "$NEW_VERSION" ]; then
  echo "::error::upgraded server reports '$reported', expected $NEW_VERSION"; status=1
fi
ci_node "$NET" "$WORK" drill/verify.mjs -e IDENPLANE_URL=http://upg-app:3000 -e STATE_FILE="$STATE" \
  -e VERIFY_LABEL="Upgrade test: after upgrading to this commit" || status=1
ci_flush_summary "$WORK"

if [ "$status" -ne 0 ]; then echo "::error::upgrade test failed"; exit 1; fi
summary="Upgrade test passed: $PREV_IMAGE -> this commit ($NEW_VERSION): $applied migrations applied, sign-in, TOTP, client secret, refresh token and signing keys intact."
echo "$summary"
[ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "$summary" >> "$GITHUB_STEP_SUMMARY"
exit 0
