#!/usr/bin/env bash
# Seeds a fresh Zitadel (targets/zitadel.yml) for the comparison benchmark
# through its v2 APIs, authenticated with the admin PAT that start-from-init
# wrote to $ZITADEL_PAT_DIR/admin.pat:
#
#   - a project;
#   - a machine user with a client secret and JWT access tokens, which is how
#     Zitadel does client_credentials;
#   - an API application (basic auth) in that project, whose credentials are
#     what Zitadel's introspection endpoint takes;
#   - a human user $USERNAME / $PASSWORD, only so the stored password hash
#     can be reported (Zitadel has no password grant).
#
# Input (env): PUBLIC_URL, ZITADEL_PAT_DIR, USERNAME, PASSWORD, COMPOSE.
# ADMIN_PASSWORD, REALM, CLIENT_ID and CLIENT_SECRET are accepted but Zitadel
# generates its own client ids and secrets, which are printed instead.
# Output: KEY=VALUE lines on stdout, logs on stderr. Needs curl and node
# (JSON goes to node on stdin only, so compare.sh's container shim works).
set -euo pipefail

: "${PUBLIC_URL:?}" "${ZITADEL_PAT_DIR:?}" "${PASSWORD:?}" "${COMPOSE:?}"
USERNAME="${USERNAME:-benchuser}"
CLIENT_ID="${CLIENT_ID:-benchmark-client}"
# Zitadel picks the instance by Host; this is its ExternalDomain:ExternalPort.
ZITADEL_HOST="${ZITADEL_HOST:-target:8080}"

log() { printf '[seed-zitadel] %s\n' "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

# jget <dotted.path>: reads JSON on stdin, prints that field (empty if absent).
jget() {
  node -e '
let d = ""; process.stdin.on("data", c => d += c).on("end", () => {
  let v; try { v = JSON.parse(d); } catch { v = undefined; }
  for (const k of process.argv[1].split(".")) v = v == null ? v : v[k];
  process.stdout.write(v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
});' "$1"
}
# A JSON string literal for a shell value.
jstr() { local s=${1//\\/\\\\}; s=${s//\"/\\\"}; printf '"%s"' "$s"; }

# ── admin PAT ────────────────────────────────────────────────────────────────
pat_file="$ZITADEL_PAT_DIR/admin.pat"
for _ in $(seq 100); do [ -s "$pat_file" ] && break; sleep 0.2; done
[ -s "$pat_file" ] || die "no PAT at $pat_file"
PAT="$(tr -d '\r\n' <"$pat_file")"

# api <METHOD> <path> [json body]: prints the body; fails on a non-2xx.
api() {
  local out code
  out="$(curl -sS -X "$1" "$PUBLIC_URL$2" -H "Host: $ZITADEL_HOST" \
    -H "Authorization: Bearer $PAT" -H 'Content-Type: application/json' \
    ${3:+--data "$3"} -w '\n%{http_code}')"
  code="${out##*$'\n'}"; out="${out%$'\n'*}"
  case "$code" in 2??) printf '%s' "$out" ;; *) die "$1 $2 -> HTTP $code: $out" ;; esac
}

# ── org of the admin (the first instance's default org) ─────────────────────
# /debug/ready turns green a moment before the REST gateway in front of the
# gRPC APIs can reach them (it answers 503 until then), so wait for it.
deadline=$(( $(date +%s) + 60 ))
until curl -fsS -o /dev/null "$PUBLIC_URL/management/v1/orgs/me" -H "Host: $ZITADEL_HOST" \
      -H "Authorization: Bearer $PAT" 2>/dev/null; do
  [ "$(date +%s)" -ge "$deadline" ] && break   # api below reports the error
  sleep 0.3
done
ORG_ID="$(api GET /management/v1/orgs/me | jget org.id)"
[ -n "$ORG_ID" ] || die "could not read the org id"
log "org $ORG_ID"

# ── project ──────────────────────────────────────────────────────────────────
# The v2 project and application services are served over Connect only.
PROJECT_ID="$(api POST /zitadel.project.v2.ProjectService/CreateProject \
  "{\"organizationId\":\"$ORG_ID\",\"name\":\"benchmark\"}" | jget projectId)"
[ -n "$PROJECT_ID" ] || die "no project id"
log "project $PROJECT_ID"

# ── API application: the credentials introspection takes ────────────────────
app="$(api POST /zitadel.application.v2.ApplicationService/CreateApplication \
  "{\"projectId\":\"$PROJECT_ID\",\"name\":\"benchmark-api\",\"apiConfiguration\":{\"authMethodType\":\"API_AUTH_METHOD_TYPE_BASIC\"}}")"
INTROSPECT_CLIENT_ID="$(printf '%s' "$app" | jget apiConfiguration.clientId)"
INTROSPECT_CLIENT_SECRET="$(printf '%s' "$app" | jget apiConfiguration.clientSecret)"
[ -n "$INTROSPECT_CLIENT_SECRET" ] || die "no API app secret: $app"
log "API app client $INTROSPECT_CLIENT_ID"

# ── machine user: the client_credentials client ─────────────────────────────
# Its username is the client_id. JWT access tokens for parity with Keycloak
# and Idenplane (Zitadel's default for machine users is opaque).
MACHINE_ID="$(api POST /v2/users/new \
  "{\"organizationId\":\"$ORG_ID\",\"username\":$(jstr "$CLIENT_ID"),\"machine\":{\"name\":\"benchmark client\",\"accessTokenType\":\"ACCESS_TOKEN_TYPE_JWT\"}}" | jget id)"
[ -n "$MACHINE_ID" ] || die "no machine user id"
M_CLIENT_SECRET="$(api POST "/v2/users/$MACHINE_ID/secret" '{}' | jget clientSecret)"
[ -n "$M_CLIENT_SECRET" ] || die "no machine user secret"
log "machine user $CLIENT_ID ($MACHINE_ID)"

# ── human user, for the password-hash evidence only ─────────────────────────
HUMAN_ID="$(api POST /v2/users/human "{
  \"username\":$(jstr "$USERNAME"),
  \"organization\":{\"orgId\":\"$ORG_ID\"},
  \"profile\":{\"givenName\":\"Bench\",\"familyName\":\"User\"},
  \"email\":{\"email\":$(jstr "$USERNAME@example.com"),\"isVerified\":true},
  \"password\":{\"password\":$(jstr "$PASSWORD"),\"changeRequired\":false}}" | jget userId)"
[ -n "$HUMAN_ID" ] || die "no human user id"
log "human user $USERNAME ($HUMAN_ID)"

# ── prove the credentials work (projections are eventually consistent) ──────
TOKEN_SCOPE="openid urn:zitadel:iam:org:project:id:$PROJECT_ID:aud"
token_req() { # <post|basic>
  local auth=(--data-urlencode "client_id=$CLIENT_ID" --data-urlencode "client_secret=$M_CLIENT_SECRET")
  [ "$1" = basic ] && auth=(-u "$CLIENT_ID:$M_CLIENT_SECRET")
  curl -sS -X POST "$PUBLIC_URL/oauth/v2/token" -H "Host: $ZITADEL_HOST" "${auth[@]}" \
    --data-urlencode grant_type=client_credentials --data-urlencode "scope=$TOKEN_SCOPE"
}
ACCESS_TOKEN="" CLIENT_AUTH=""
deadline=$(( $(date +%s) + 60 ))
while :; do
  for mode in post basic; do
    ACCESS_TOKEN="$(token_req "$mode" | jget access_token)"
    [ -n "$ACCESS_TOKEN" ] && { CLIENT_AUTH="$mode"; break 2; }
  done
  [ "$(date +%s)" -ge "$deadline" ] && die "client_credentials never worked: $(token_req post)"
  sleep 0.5
done
log "client_credentials works with CLIENT_AUTH=$CLIENT_AUTH"
# Both methods are reported in NOTES if both work.
other=basic; [ "$CLIENT_AUTH" = basic ] && other=post
other_ok=no; [ -n "$(token_req "$other" | jget access_token)" ] && other_ok=yes

dots="${ACCESS_TOKEN//[^.]/}"
if [ "${#dots}" -eq 2 ]; then TOKEN_KIND=JWT; else TOKEN_KIND=opaque; fi
log "access token is $TOKEN_KIND"

deadline=$(( $(date +%s) + 60 ))
until [ "$(curl -sS -X POST "$PUBLIC_URL/oauth/v2/introspect" -H "Host: $ZITADEL_HOST" \
      -u "$INTROSPECT_CLIENT_ID:$INTROSPECT_CLIENT_SECRET" --data-urlencode "token=$ACCESS_TOKEN" | jget active)" = true ]; do
  [ "$(date +%s)" -ge "$deadline" ] && die "introspection never returned active=true"
  sleep 0.5
done
log "introspection returns active=true"

# ── evidence: how the human user's password is stored ───────────────────────
# Zitadel 4 keeps it in no projection table: it lives only in the event
# store, as encodedHash on the user's latest password-setting event.
psql() { eval "$COMPOSE exec -T db psql -U postgres -d zitadel -tAc \"\$1\""; }
table=eventstore.events2
hash=""
for _ in $(seq 100); do
  hash="$(psql "select payload->>'encodedHash' from $table where aggregate_id='$HUMAN_ID' and payload->>'encodedHash' is not null order by position desc limit 1" | tr -d '\r\n')"
  [ -n "$hash" ] && break; sleep 0.3
done
[ -n "$hash" ] || die "no password hash for $USERNAME in $table"
case "$hash" in
  '$2a$'*|'$2b$'*|'$2y$'*) HASH_INFO="bcrypt cost $(printf '%s' "$hash" | cut -d'$' -f3) ($(printf '%s' "$hash" | cut -c1-7)...) in $table" ;;
  *) HASH_INFO="$(printf '%s' "$hash" | cut -d'$' -f2) ($(printf '%s' "$hash" | cut -c1-24)...) in $table" ;;
esac
log "password hash: $HASH_INFO"

cat <<EOF
DISCOVERY_PATH=/.well-known/openid-configuration
JWKS_PATH=/oauth/v2/keys
TOKEN_PATH=/oauth/v2/token
INTROSPECT_PATH=/oauth/v2/introspect
CLIENT_ID=$CLIENT_ID
CLIENT_SECRET=$M_CLIENT_SECRET
CLIENT_AUTH=$CLIENT_AUTH
INTROSPECT_CLIENT_ID=$INTROSPECT_CLIENT_ID
INTROSPECT_CLIENT_SECRET=$INTROSPECT_CLIENT_SECRET
INTROSPECT_AUTH=basic
TOKEN_SCOPE=$TOKEN_SCOPE
INTROSPECT_TOKEN_GRANT=client_credentials
UNSUPPORTED=password
HASH_INFO=$HASH_INFO
NOTES=introspection checks a machine-user (client_credentials) token, not a user token; access tokens are $TOKEN_KIND; client secrets (machine user and API app) are bcrypt cost 4 and verified on every token and introspection request; token endpoint also accepts CLIENT_AUTH=$other: $other_ok
EOF
