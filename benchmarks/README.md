# Idenplane Benchmark Suite

Performance testing infrastructure for the Idenplane authentication server using k6.

## Overview

This directory contains load testing scripts and configuration for benchmarking Idenplane's API endpoints under various load conditions. It also supports comparison benchmarking against other authentication solutions: Keycloak, Authentik, and Zitadel.

## In CI

`.github/workflows/benchmark.yml` runs on every published release, on demand (**Actions → Benchmark → Run workflow**), and on PRs that touch `benchmarks/`. It:

1. Builds the server from the checked-out commit, so the numbers belong to that commit and not to whatever `:latest` is.
2. Seeds a `benchmark` realm through the admin API with `scripts/seed-benchmark-realm.sh`: a confidential client, a user, and rate limiting and lockout off for that realm only.
3. Runs `discovery`, `jwks` and `login` with k6 at 20 VUs for 30 s each.
4. Writes a req/s / p50 / p95 / success table to the run summary and uploads the JSON.

It fails only when a scenario's own success rate drops below 99%. Latency on shared runners is too noisy to gate on, so it is reported, not enforced. Login throughput is low by design: every sign-in runs Argon2id at 64 MiB, capped at one hash per CPU core.

Competitor stacks are not started in CI. They live behind the `competitors` compose profile (`docker compose --profile competitors …`) for local comparison runs.

## Prerequisites

- [k6](https://grafana.com/docs/k6/latest/) - Load testing tool
- Docker & Docker Compose (for containerized benchmarks)
- Idenplane server running with benchmark target endpoint

## Structure

```
benchmarks/
├── README.md              # This file
├── .env.example           # Environment variable template
├── docker-compose.benchmarks.yml  # Docker setup for benchmarks
├── k6/
│   ├── config.js          # k6 configuration
│   ├── config.local.js    # Local development config
│   ├── idenplane-login.js    # Login load test
│   ├── idenplane-token-issuance.js  # Token issuance test
│   ├── idenplane-token-introspection.js  # Token introspection test
│   ├── idenplane-token-revocation.js  # Token revocation test
│   ├── idenplane-userinfo.js # Userinfo endpoint test
│   ├── idenplane-discovery.js # OpenID Discovery endpoint test
│   ├── idenplane-jwks.js     # JWKS endpoint test
│   └── shared-scenarios.js # Shared utilities
├── scripts/               # Shell scripts for benchmark orchestration
├── competitors/           # Docker Compose files for competitor benchmarks
└── results/               # Benchmark results (gitignored)
```

## Quick Start

### 1. Setup Environment

```bash
# Copy environment template
cp benchmarks/.env.example benchmarks/.env

# Edit benchmarks/.env with your Idenplane instance details
```

### 2. Run Benchmarks

```bash
# With Docker Compose
docker compose -f benchmarks/docker-compose.benchmarks.yml up

# Or run k6 directly
k6 run --config benchmarks/k6/config.js benchmarks/k6/idenplane-login.js
```

### 3. View Results

Results are saved to `benchmarks/results/` in JSON format for analysis.

## Configuration

See `.env.example` for required environment variables:

- `TARGET_URL` - Idenplane server URL (default: http://localhost:3000)
- `ADMIN_API_KEY` - API key for authentication
- `VUS` - Virtual users for load test
- `DURATION` - Test duration

## Available Tests

| Test Script | Description |
|-------------|-------------|
| `idenplane-login.js` | Login endpoint load test |
| `idenplane-token-issuance.js` | Token issuance performance test |
| `idenplane-token-introspection.js` | Token introspection endpoint test |
| `idenplane-token-revocation.js` | Token revocation endpoint test |
| `idenplane-userinfo.js` | Userinfo endpoint load test |
| `idenplane-discovery.js` | OpenID Discovery endpoint test |
| `idenplane-jwks.js` | JWKS endpoint performance test |

## Competitor Comparison Benchmarks

This suite supports benchmarking against other authentication solutions for performance comparison:

### Keycloak

```bash
# Start Keycloak container
docker compose -f benchmarks/competitors/docker-compose.keycloak.yml up -d

# Run benchmarks against Keycloak
k6 run --config benchmarks/k6/config.js benchmarks/k6/idenplane-login.js
```

### Authentik

```bash
# Start Authentik container
docker compose -f benchmarks/competitors/docker-compose.authentik.yml up -d

# Run benchmarks against Authentik
k6 run --config benchmarks/k6/config.js benchmarks/k6/idenplane-login.js
```

### Zitadel

```bash
# Start Zitadel container
docker compose -f benchmarks/competitors/docker-compose.zitadel.yml up -d

# Run benchmarks against Zitadel
k6 run --config benchmarks/k6/config.js benchmarks/k6/idenplane-login.js
```

## Orchestration Scripts

The `scripts/` directory contains utilities for benchmark orchestration:

| Script | Purpose |
|--------|---------|
| `setup.sh` | Initialize benchmark environment |
| `teardown.sh` | Clean up benchmark resources |
| `run-benchmarks.sh` | Execute full benchmark suite |
| `compare-results.py` | Compare results across different runs |
| `generate-report.py` | Generate HTML report from results |
| `aggregate-results.py` | Aggregate multiple benchmark runs |
| `export-results.sh` | Export results to external formats |
| `measure-resources.sh` | Monitor resource usage during tests |
| `continuous-benchmark.py` | Run continuous benchmarking |

## Adding New Tests

Create new test scripts in `benchmarks/k6/` following the existing patterns. Each test should:
- Import shared scenarios from `shared-scenarios.js`
- Export a default scenario function
- Use environment variables for configuration
- Output results in JSON format to `benchmarks/results/`