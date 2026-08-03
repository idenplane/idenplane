#!/bin/sh
# One-shot seed job: creates the demo realm, a public OIDC client for this
# quickstart, and a demo user. Idempotent — safe to re-run (a 409 from an
# already-existing realm/client/user is treated as success).
set -eu

BASE="$IDENPLANE_URL/admin/realms"
AUTH_HEADER="x-admin-api-key: $ADMIN_API_KEY"

post() {
  # $1 = path, $2 = JSON body. Prints the response body; exits non-zero only
  # on an unexpected (non-2xx, non-409) status.
  path="$1"
  body="$2"
  response=$(curl -sS -o /tmp/resp.json -w "%{http_code}" \
    -X POST "$BASE$path" \
    -H "$AUTH_HEADER" -H "Content-Type: application/json" \
    -d "$body")
  if [ "$response" != "409" ] && [ "${response#2}" = "$response" ]; then
    echo "POST $path failed with status $response:" >&2
    cat /tmp/resp.json >&2
    exit 1
  fi
  cat /tmp/resp.json
}

echo "Seeding realm 'quickstart'..."
post "" '{"name":"quickstart","displayName":"Quickstart","enabled":true}' > /dev/null

echo "Seeding client 'vanilla-js-quickstart'..."
post "/quickstart/clients" '{
  "clientId": "vanilla-js-quickstart",
  "name": "Vanilla JS Quickstart",
  "publicClient": true,
  "enabled": true,
  "redirectUris": ["http://localhost:3002/callback.html"],
  "postLogoutRedirectUris": ["http://localhost:3002/index.html"],
  "webOrigins": ["http://localhost:3002"],
  "grantTypes": ["authorization_code", "refresh_token"]
}' > /dev/null

echo "Seeding demo user 'demo'..."
user_response=$(post "/quickstart/users" '{
  "username": "demo",
  "email": "demo@example.com",
  "firstName": "Demo",
  "lastName": "User",
  "enabled": true,
  "emailVerified": true
}')
user_id=$(echo "$user_response" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -n "${user_id:-}" ]; then
  echo "Setting demo user password..."
  curl -sS -o /dev/null -w "%{http_code}\n" \
    -X PUT "$BASE/quickstart/users/$user_id/reset-password" \
    -H "$AUTH_HEADER" -H "Content-Type: application/json" \
    -d '{"password":"Demo1234!"}'
else
  echo "User 'demo' already existed — skipping password set (use Demo1234! if this is a fresh seed, or reset it via the admin console otherwise)."
fi

echo "Seed complete. Realm: quickstart | Client: vanilla-js-quickstart | Demo user: demo / Demo1234!"
