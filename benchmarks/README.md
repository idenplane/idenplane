# Idenplane Benchmark Suite

Load tests for the Idenplane server, written for [k6](https://grafana.com/docs/k6/latest/).

## In CI

`.github/workflows/benchmark.yml` runs on every published release, on demand (**Actions → Benchmark → Run workflow**), and on PRs that touch `benchmarks/`. It:

1. Builds the server from the checked-out commit, so the numbers belong to that commit and not to whatever `:latest` is.
2. Seeds a `benchmark` realm through the admin API with `scripts/seed-benchmark-realm.sh`. The realm has a confidential client and a user, and rate limiting and lockout are off for that realm only.
3. Runs `discovery`, `jwks` and `login` with k6 at 20 VUs for 30 s each.
4. Writes a req/s, p50, p95 and success-rate table to the run summary and uploads the JSON.

The run fails only when a scenario's success rate drops below 99%. Latency on shared runners is too noisy to gate on, so it is reported but not enforced. Login throughput is low by design: every sign-in runs Argon2id at 64 MiB, capped at one hash per CPU core.

## Running locally

```bash
export ADMIN_API_KEY=$(openssl rand -hex 32) WEBHOOK_SECRET_KEY=$(openssl rand -hex 32)
export ADMIN_PASSWORD=Bench-$(openssl rand -hex 16) WEBHOOK_ENCRYPTION_SALT=Bench-$(openssl rand -hex 16)
COMPOSE="docker compose -f benchmarks/docker-compose.benchmarks.yml"

$COMPOSE up -d --build --wait app db
eval "$(bash benchmarks/scripts/seed-benchmark-realm.sh | sed 's/^/export /')"
$COMPOSE run --rm -e REALM_NAME -e TEST_CLIENT_ID -e TEST_CLIENT_SECRET \
  -e TEST_USERNAME -e TEST_PASSWORD \
  k6 run --summary-export /results/login.json /src/k6/idenplane-login.js
node benchmarks/scripts/summarize-k6.mjs benchmarks/results login
$COMPOSE down --volumes
```

`VUS`, `DURATION` and `RAMP_UP` control the load. Results go to `benchmarks/results/`, which git ignores.

## Scenarios

| Script | What it exercises |
|--------|-------------------|
| `idenplane-discovery.js` | `/.well-known/openid-configuration` |
| `idenplane-jwks.js` | the realm's signing keys (`/certs`) |
| `idenplane-login.js` | password grant, plus wrong-password and malformed requests |
| `idenplane-token-issuance.js` | token issuance and refresh |
| `idenplane-token-introspection.js` | `/token/introspect` |
| `idenplane-token-revocation.js` | `/revoke` |
| `idenplane-userinfo.js` | `/userinfo` |

## Comparing with other identity servers

No comparison numbers are published yet. A reproducible side-by-side run is being built. It will pin images, CPU and memory, use matching password-hashing settings, and record the configuration next to the results. Until those numbers exist, treat any Idenplane-vs-X throughput figure as unverified.
