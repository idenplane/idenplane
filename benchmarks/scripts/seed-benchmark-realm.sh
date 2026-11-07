#!/usr/bin/env bash
# Creates the realm, confidential client and user the k6 scenarios sign in
# with, through the admin API of a running Idenplane. Rate limiting and
# brute-force lockout are off for this realm only, so the load isn't answered
# with 429s or locked accounts.
#
#   TARGET_URL      admin API base (default http://localhost:3001)
#   ADMIN_API_KEY   required
#   REALM_NAME, TEST_CLIENT_ID, TEST_USERNAME, TEST_PASSWORD  (defaults below)
#
# Prints KEY=value lines (including the generated TEST_CLIENT_SECRET) for the
# caller to export; in GitHub Actions they are appended to $GITHUB_ENV.
set -euo pipefail

TARGET_URL="${TARGET_URL:-http://localhost:3001}"
REALM_NAME="${REALM_NAME:-benchmark}"
TEST_CLIENT_ID="${TEST_CLIENT_ID:-benchmark-client}"
TEST_USERNAME="${TEST_USERNAME:-benchuser}"
TEST_PASSWORD="${TEST_PASSWORD:-Bench-$(openssl rand -hex 12)}"
: "${ADMIN_API_KEY:?Set ADMIN_API_KEY}"

api() {
  local method="$1" path="$2" body="$3"
  curl -fsS -X "$method" "${TARGET_URL}${path}" \
    -H "x-admin-api-key: ${ADMIN_API_KEY}" \
    -H 'Content-Type: application/json' \
    -d "$body"
}

api POST /admin/realms "$(cat <<JSON
{"name":"${REALM_NAME}","enabled":true,"rateLimitEnabled":false,"bruteForceEnabled":false}
JSON
)" >/dev/null

client_json="$(api POST "/admin/realms/${REALM_NAME}/clients" "$(cat <<JSON
{"clientId":"${TEST_CLIENT_ID}","clientType":"CONFIDENTIAL","enabled":true,
 "grantTypes":["password","refresh_token","client_credentials"],
 "redirectUris":["http://localhost/callback"]}
JSON
)")"
TEST_CLIENT_SECRET="$(printf '%s' "$client_json" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const s=JSON.parse(d).clientSecret;if(!s){process.exit(1)}process.stdout.write(s)})')"

api POST "/admin/realms/${REALM_NAME}/users" "$(cat <<JSON
{"username":"${TEST_USERNAME}","email":"${TEST_USERNAME}@example.com","enabled":true,
 "password":"${TEST_PASSWORD}"}
JSON
)" >/dev/null

# Prove the scenario's credentials work before any load is generated.
curl -fsS -o /dev/null -X POST \
  "${TARGET_URL}/realms/${REALM_NAME}/protocol/openid-connect/token" \
  --data-urlencode grant_type=password \
  --data-urlencode "client_id=${TEST_CLIENT_ID}" \
  --data-urlencode "client_secret=${TEST_CLIENT_SECRET}" \
  --data-urlencode "username=${TEST_USERNAME}" \
  --data-urlencode "password=${TEST_PASSWORD}" \
  --data-urlencode scope=openid

out="REALM_NAME=${REALM_NAME}
TEST_CLIENT_ID=${TEST_CLIENT_ID}
TEST_CLIENT_SECRET=${TEST_CLIENT_SECRET}
TEST_USERNAME=${TEST_USERNAME}
TEST_PASSWORD=${TEST_PASSWORD}"
if [ -n "${GITHUB_ENV:-}" ]; then
  echo "::add-mask::${TEST_CLIENT_SECRET}"
  echo "::add-mask::${TEST_PASSWORD}"
  printf '%s\n' "$out" >> "$GITHUB_ENV"
else
  printf '%s\n' "$out"
fi
echo "Seeded realm ${REALM_NAME}; a password-grant sign-in works." >&2
