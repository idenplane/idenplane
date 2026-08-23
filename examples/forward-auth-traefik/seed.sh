#!/bin/sh
# One-shot seed job for the forward-auth demo.
#
# Creates the realm, the OAuth client that forward auth authenticates through,
# a demo user, and the proxy application itself. Idempotent — a 409 from an
# already-existing object is treated as success, so `docker compose up` twice
# is fine.
set -eu

ADMIN="$IDENPLANE_URL/admin"
AUTH_HEADER="x-admin-api-key: $ADMIN_API_KEY"

request() {
  # $1 = method, $2 = path (under /admin), $3 = JSON body (may be empty).
  # Fails loudly on anything that is not 2xx or 409.
  method="$1"
  path="$2"
  body="${3:-}"

  if [ -n "$body" ]; then
    status=$(curl -sS -o /tmp/resp.json -w '%{http_code}' \
      -X "$method" "$ADMIN$path" \
      -H "$AUTH_HEADER" -H 'Content-Type: application/json' -d "$body")
  else
    status=$(curl -sS -o /tmp/resp.json -w '%{http_code}' \
      -X "$method" "$ADMIN$path" -H "$AUTH_HEADER")
  fi

  if [ "$status" != "409" ] && [ "${status#2}" = "$status" ]; then
    echo "$method $path failed with status $status:" >&2
    cat /tmp/resp.json >&2
    exit 1
  fi
  cat /tmp/resp.json
}

echo "→ realm 'demo'"
request POST /realms '{"name":"demo","displayName":"Forward Auth Demo","enabled":true}' > /dev/null

# Created with the callback already registered. In a real setup you create the
# client first, read `callbackUrl` back from the proxy application, and add it
# in a second step — forgetting that is the single most common way to end up
# with a login that fails on its very last redirect.
echo "→ client 'whoami-proxy' (callback pre-registered)"
request POST /realms/demo/clients "$(cat <<JSON
{
  "clientId": "whoami-proxy",
  "clientType": "CONFIDENTIAL",
  "clientSecret": "whoami-proxy-demo-secret",
  "redirectUris": ["$CALLBACK_URL"]
}
JSON
)" > /dev/null

echo "→ user 'demo' / 'demo1234'"
request POST /realms/demo/users '{
  "username": "demo",
  "email": "demo@example.com",
  "firstName": "Demo",
  "lastName": "User",
  "password": "demo1234",
  "enabled": true,
  "emailVerified": true
}' > /dev/null

# cookieDomain is `.localhost` because the browser must send one cookie to both
# auth.localhost and app.localhost. Scope it to either host alone and the demo
# turns into an endless redirect loop with no error anywhere — which is exactly
# the failure the server refuses to let you configure.
echo "→ proxy application 'whoami'"
request POST /realms/demo/proxy-applications '{
  "slug": "whoami",
  "name": "Whoami",
  "clientId": "whoami-proxy",
  "allowedRedirectUris": ["http://app.localhost/*"],
  "cookieDomain": ".localhost"
}' > /dev/null

echo
echo "Ready."
echo "  Open      http://app.localhost"
echo "  Sign in   demo / demo1234"
echo "  Console   http://auth.localhost/console"
