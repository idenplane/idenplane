# Authme Benchmark Suite

Performance testing infrastructure for the Authme authentication server using k6.

## Overview

This directory contains load testing scripts and configuration for benchmarking Authme's API endpoints under various load conditions.

## Prerequisites

- [k6](https://grafana.com/docs/k6/latest/) - Load testing tool
- Docker & Docker Compose (for containerized benchmarks)
- Authme server running with benchmark target endpoint

## Structure

```
benchmarks/
├── README.md              # This file
├── .env.example           # Environment variable template
├── docker-compose.benchmarks.yml  # Docker setup for benchmarks
├── k6/
│   ├── config.js          # k6 configuration
│   └── scripts/           # Load test scripts
└── results/               # Benchmark results (gitignored)
```

## Quick Start

### 1. Setup Environment

```bash
# Copy environment template
cp benchmarks/.env.example benchmarks/.env

# Edit benchmarks/.env with your Authme instance details
```

### 2. Run Benchmarks

```bash
# With Docker Compose
docker compose -f benchmarks/docker-compose.benchmarks.yml up

# Or run k6 directly
k6 run --config benchmarks/k6/config.js benchmarks/k6/scripts/auth-flows.js
```

### 3. View Results

Results are saved to `benchmarks/results/` in JSON format for analysis.

## Configuration

See `.env.example` for required environment variables:

- `TARGET_URL` - Authme server URL (default: http://localhost:3000)
- `ADMIN_API_KEY` - API key for authentication
- `VUS` - Virtual users for load test
- `DURATION` - Test duration

## Adding New Tests

Create new test scripts in `benchmarks/k6/scripts/` following the existing patterns.