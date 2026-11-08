#!/usr/bin/env bash
# Seeds a fresh Authentik (benchmarks/compare/targets/authentik.yml) through
# its REST API, the way an operator would, and prints what the load
# generator needs as KEY=VALUE lines on stdout. Everything else goes to
# stderr.
#
# Input (environment): PUBLIC_URL, ADMIN_PASSWORD, AUTHENTIK_BOOTSTRAP_TOKEN,
# REALM, CLIENT_ID, CLIENT_SECRET, USERNAME, PASSWORD, COMPOSE.
# Needs curl and node (or python3/python) for JSON; jq is not used.
#
# What it creates:
#   - an OAuth2/OIDC provider: confidential client $CLIENT_ID/$CLIENT_SECRET,
#     signed with the default "authentik Self-signed Certificate" (RS256),
#     the default implicit-consent authorization flow and the default
#     invalidation flow, the managed openid/email/profile scope mappings,
#     grant types client_credentials, authorization_code and refresh_token;
#   - an application with slug $REALM bound to it (no policy bindings, so
#     every user and the client's service account may use it);
#   - user $USERNAME with password $PASSWORD (hashed by Authentik's
#     default Django hasher).
#
# client_credentials uses Authentik's standard mode: client_id plus the
# provider's client_secret, which issues the token to an auto-created
# service account ("ak-<provider>-client_credentials"). The other modes
# (username + app-password token, base64 "user:apppassword" as the secret,
# or a JWT client assertion) are Authentik specific and not what a normal
# machine client sends.
set -euo pipefail

: "${PUBLIC_URL:?}" "${AUTHENTIK_BOOTSTRAP_TOKEN:?}" "${REALM:?}" "${CLIENT_ID:?}"
: "${CLIENT_SECRET:?}" "${USERNAME:?}" "${PASSWORD:?}"
COMPOSE="${COMPOSE:-}"

log() { printf '[seed-authentik] %s\n' "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

API="$PUBLIC_URL/api/v3"
AUTH="Authorization: Bearer $AUTHENTIK_BOOTSTRAP_TOKEN"
PROVIDER_NAME="$REALM-provider"
SELF_SIGNED="authentik Self-signed Certificate"

# ── JSON without jq ──────────────────────────────────────────────────────────
# jget <path>: reads JSON on stdin and prints the value at a dotted path such
# as "results.0.pk" (strings raw, other values as JSON, nothing when the path
# is missing or null). Both the path and the input travel as an argument and
# stdin, so this also works through compare.sh's containerised node shim.
# jstr <value>: the value as a JSON string literal.
if command -v node >/dev/null 2>&1; then
  jget() {
    node -e '
      let s = ""; process.stdin.on("data", c => s += c).on("end", () => {
        let v; try { v = JSON.parse(s); } catch { process.exit(3); }
        for (const k of process.argv[1].split(".")) v = v == null ? undefined : v[k];
        if (v === undefined || v === null) return;
        process.stdout.write(typeof v === "string" ? v : JSON.stringify(v));
      });' "$1"
  }
  jstr() { node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$1"; }
else
  # The first interpreter that actually runs (on Windows `python3` may be the
  # Microsoft Store stub, which exits 49).
  PY=""
  for c in python3 python; do
    if command -v "$c" >/dev/null 2>&1 && "$c" -I -c 'import json' >/dev/null 2>&1; then PY="$c"; break; fi
  done
  [ -n "$PY" ] || die "need node or python to parse JSON"
  jget() {
    "$PY" -I -c '
import json, sys
try: v = json.load(sys.stdin)
except Exception: sys.exit(3)
for k in sys.argv[1].split("."):
    if isinstance(v, list):
        v = v[int(k)] if k.isdigit() and int(k) < len(v) else None
    elif isinstance(v, dict):
        v = v.get(k)
    else:
        v = None
if v is not None:
    sys.stdout.write(v if isinstance(v, str) else json.dumps(v))' "$1"
  }
  jstr() { "$PY" -I -c 'import json,sys; sys.stdout.write(json.dumps(sys.argv[1]))' "$1"; }
fi
# The first result's pk of a list response, or nothing.
first_pk() { jget results.0.pk; }

# ── HTTP ─────────────────────────────────────────────────────────────────────
# api <method> <path> [json body]: prints the body; fails on non-2xx with the
# response on stderr.
api() {
  local method="$1" path="$2" body="${3:-}" out code
  out="$(mktemp)"
  if [ -n "$body" ]; then
    code="$(curl -sS -o "$out" -w '%{http_code}' -X "$method" -H "$AUTH" \
      -H 'Content-Type: application/json' --data-binary "$body" "$API$path")" || code=000
  else
    code="$(curl -sS -o "$out" -w '%{http_code}' -X "$method" -H "$AUTH" "$API$path")" || code=000
  fi
  if [ "${code:0:1}" != 2 ]; then
    log "$method $path -> HTTP $code: $(head -c 600 "$out")"
    rm -f "$out"; return 1
  fi
  cat "$out"; rm -f "$out"
}
urlenc() { printf '%s' "$1" | sed 's/ /%20/g'; }

# Retries a lookup until it yields a value (the worker applies the default
# blueprints asynchronously after first boot).
wait_for() { # <description> <command...>
  local what="$1"; shift
  local deadline=$(( $(date +%s) + 300 )) v
  while :; do
    v="$("$@" 2>/dev/null || true)"
    [ -n "$v" ] && { printf '%s' "$v"; return 0; }
    [ "$(date +%s)" -ge "$deadline" ] && die "timed out waiting for $what"
    sleep 1
  done
}

# ── 0. the worker must run: it bootstraps the admin token, flows and keys ──
if [ -n "$COMPOSE" ]; then
  if [ -z "$(eval "$COMPOSE ps -q --status running worker" 2>/dev/null)" ]; then
    log "starting the worker (it applies the bootstrap blueprints)"
    eval "$COMPOSE up -d --no-deps worker" >&2
  fi
fi

log "waiting for the bootstrap API token"
wait_for "the bootstrap token to be accepted" api GET /core/users/me/ >/dev/null

lookup_flow() { api GET "/flows/instances/?slug=$1" | first_pk; }
lookup_cert() { api GET "/crypto/certificatekeypairs/?name=$(urlenc "$SELF_SIGNED")&has_key=true" | first_pk; }
lookup_scope() { api GET "/propertymappings/provider/scope/?managed=goauthentik.io/providers/oauth2/scope-$1" | first_pk; }

log "waiting for the default flows, signing key and scope mappings"
AUTHZ_FLOW="$(wait_for "default-provider-authorization-implicit-consent" lookup_flow default-provider-authorization-implicit-consent)"
INVAL_FLOW="$(wait_for "default-provider-invalidation-flow" lookup_flow default-provider-invalidation-flow)"
CERT="$(wait_for "the self-signed certificate" lookup_cert)"
SCOPES=""
for s in openid email profile; do
  pk="$(wait_for "scope mapping $s" lookup_scope "$s")"
  SCOPES="$SCOPES${SCOPES:+,}$(jstr "$pk")"
done

# ── 1. provider ──────────────────────────────────────────────────────────────
PROVIDER_BODY="{
  \"name\": $(jstr "$PROVIDER_NAME"),
  \"authorization_flow\": $(jstr "$AUTHZ_FLOW"),
  \"invalidation_flow\": $(jstr "$INVAL_FLOW"),
  \"client_type\": \"confidential\",
  \"client_id\": $(jstr "$CLIENT_ID"),
  \"client_secret\": $(jstr "$CLIENT_SECRET"),
  \"grant_types\": [\"client_credentials\", \"authorization_code\", \"refresh_token\"],
  \"signing_key\": $(jstr "$CERT"),
  \"redirect_uris\": [{\"matching_mode\": \"strict\", \"url\": \"http://localhost/callback\"}],
  \"property_mappings\": [$SCOPES],
  \"sub_mode\": \"hashed_user_id\",
  \"issuer_mode\": \"per_provider\"
}"
existing="$(api GET "/providers/oauth2/?client_id=$CLIENT_ID" | first_pk)"
if [ -n "$existing" ]; then
  log "provider exists (pk $existing), updating it"
  api PUT "/providers/oauth2/$existing/" "$PROVIDER_BODY" >/dev/null
  PROVIDER_PK="$existing"
else
  PROVIDER_PK="$(api POST /providers/oauth2/ "$PROVIDER_BODY" | jget pk)"
  log "provider created (pk $PROVIDER_PK)"
fi

# ── 2. application ──────────────────────────────────────────────────────────
APP_BODY="{\"name\": $(jstr "$REALM"), \"slug\": $(jstr "$REALM"), \"provider\": $PROVIDER_PK,
  \"policy_engine_mode\": \"any\"}"
if api GET "/core/applications/$REALM/" >/dev/null 2>&1; then
  api PUT "/core/applications/$REALM/" "$APP_BODY" >/dev/null
  log "application $REALM updated"
else
  api POST /core/applications/ "$APP_BODY" >/dev/null
  log "application $REALM created"
fi

# ── 3. user ──────────────────────────────────────────────────────────────────
USER_PK="$(api GET "/core/users/?username=$USERNAME" | first_pk)"
if [ -z "$USER_PK" ]; then
  USER_PK="$(api POST /core/users/ "{\"username\": $(jstr "$USERNAME"), \"name\": \"Bench User\",
    \"email\": $(jstr "$USERNAME@example.com"), \"is_active\": true, \"type\": \"internal\"}" | jget pk)"
  log "user $USERNAME created (pk $USER_PK)"
fi
api POST "/core/users/$USER_PK/set_password/" "{\"password\": $(jstr "$PASSWORD")}" >/dev/null
log "password set for $USERNAME"

# ── 4. prove every measured endpoint works (through the published port) ────
DISCOVERY_PATH="/application/o/$REALM/.well-known/openid-configuration"
JWKS_PATH="/application/o/$REALM/jwks/"
TOKEN_PATH="/application/o/token/"
INTROSPECT_PATH="/application/o/introspect/"

issuer="$(curl -fsS "$PUBLIC_URL$DISCOVERY_PATH" | jget issuer)" || die "discovery failed"
[ -n "$issuer" ] || die "discovery has no issuer"
log "discovery ok, issuer $issuer"
alg="$(curl -fsS "$PUBLIC_URL$JWKS_PATH" | jget keys.0.alg)" || die "jwks failed"
[ -n "$alg" ] || die "jwks has no keys"
[ "$alg" = RS256 ] || log "warning: signing key alg is $alg, not RS256"
log "jwks ok, alg $alg"
tok_json="$(curl -sS -X POST "$PUBLIC_URL$TOKEN_PATH" \
  --data-urlencode grant_type=client_credentials --data-urlencode "client_id=$CLIENT_ID" \
  --data-urlencode "client_secret=$CLIENT_SECRET")"
access_token="$(printf '%s' "$tok_json" | jget access_token || true)"
[ -n "$access_token" ] || die "client_credentials failed: $tok_json"
log "client_credentials ok"
active="$(curl -sS -X POST "$PUBLIC_URL$INTROSPECT_PATH" --data-urlencode "token=$access_token" \
  --data-urlencode "client_id=$CLIENT_ID" --data-urlencode "client_secret=$CLIENT_SECRET" | jget active)"
[ "$active" = true ] || die "introspection did not return active=true"
log "introspection ok"

# ── 5. evidence: how the user's password is stored ──────────────────────────
HASH_INFO="unknown, COMPOSE not set"
if [ -n "$COMPOSE" ]; then
  raw="$(eval "$COMPOSE exec -T db psql -U authentik -d authentik -tAc \
    \"select password from authentik_core_user where username = '$USERNAME'\"" | tr -d '\r')"
  # Django format: <algorithm>$<iterations>$<salt>$<hash> (pbkdf2), or
  # argon2$argon2id$v=19$m=..,t=..,p=..$<salt>$<hash>.
  algo="${raw%%\$*}"
  case "$algo" in
    pbkdf2_*) HASH_INFO="$algo iterations=$(printf '%s' "$raw" | cut -d'$' -f2)" ;;
    argon2)   HASH_INFO="argon2 $(printf '%s' "$raw" | cut -d'$' -f2,4)" ;;
    *)        HASH_INFO="$algo" ;;
  esac
fi
log "password hash: $HASH_INFO"

# ── output ───────────────────────────────────────────────────────────────────
cat <<EOF
DISCOVERY_PATH=$DISCOVERY_PATH
JWKS_PATH=$JWKS_PATH
TOKEN_PATH=$TOKEN_PATH
INTROSPECT_PATH=$INTROSPECT_PATH
CLIENT_AUTH=post
INTROSPECT_TOKEN_GRANT=client_credentials
UNSUPPORTED=password
HASH_INFO=$HASH_INFO
NOTES=The Authentik password grant is an alias of client_credentials that checks an app-password token instead of the stored user password hash, so the password scenario is skipped; introspection checks a client_credentials token. Every client_credentials request also upserts the service-account user of the client, stores the access token and writes a login Event row that the worker then processes, so the worker on the same CPUs does work under that load; introspection is a db lookup of the stored token. Server and worker share TARGET_CPUS and each has its own TARGET_MEM cap, so the stack may use up to 2x TARGET_MEM. The web server runs at its defaults (web.workers=2, web.threads=4: two Python processes, so at most about two cores of request handling).
EOF
