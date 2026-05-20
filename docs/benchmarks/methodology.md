# Benchmark Methodology

This document describes how Idenplane's performance benchmarks are conducted, including hardware requirements, test setup, and step-by-step reproduction instructions.

## Table of Contents

1. [Hardware & Software Requirements](#hardware--software-requirements)
2. [Test Setup](#test-setup)
3. [Configuration Options](#configuration-options)
4. [Running Benchmarks](#running-benchmarks)
5. [Interpreting Results](#interpreting-results)
6. [Troubleshooting](#troubleshooting)

---

## Hardware & Software Requirements

### Minimum Requirements

| Component | Requirement |
|-----------|-------------|
| CPU | 4 cores (8 recommended) |
| Memory | 8 GB RAM |
| Disk | 20 GB available |
| OS | Linux, macOS, or Windows with WSL2 |

### Software Prerequisites

| Software | Version | Purpose |
|----------|---------|---------|
| Docker | 24.0+ | Container runtime |
| Docker Compose | 2.0+ | Multi-container orchestration |
| k6 | 0.50.0+ | Load testing tool |
| Python | 3.10+ | Report generation |
| jq | 1.6+ | JSON processing |

### Installation

```bash
# Install Docker (Linux)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Install Docker Compose
sudo apt install docker-compose-v2

# Install k6
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C5E026F943B5A3F0CA2E6B8231C5AD17C5E026F943B5A3F0CA2E6B8231C5AD17C5E026F943B5A3F0CA2E6B8231
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt update && sudo apt install k6

# Install Python dependencies
pip3 install -r benchmarks/scripts/requirements.txt

# Verify installations
docker --version
docker compose version
k6 version
python3 --version
```

---

## Test Setup

### 1. Clone the Repository

```bash
git clone https://github.com/idenplane/idenplane.git
cd idenplane
```

### 2. Prepare Environment

```bash
# Copy environment template
cp benchmarks/.env.example benchmarks/.env

# Edit with your configuration
vim benchmarks/.env
```

Required environment variables:

```bash
# benchmarks/.env
ADMIN_API_KEY=your-secure-api-key
ADMIN_USER=admin
ADMIN_PASSWORD=your-admin-password
TARGET_URL=http://localhost:3000
BASE_URL=http://localhost:3001
```

### 3. Start Benchmark Stack

```bash
# Start all services
docker compose -f benchmarks/docker-compose.benchmarks.yml up -d

# Verify all services are healthy
docker compose -f benchmarks/docker-compose.benchmarks.yml ps
```

Expected output:
```
NAME                  STATUS
idenplane-benchmark-db   healthy
idenplane-benchmark-target  healthy
idenplane-benchmark-runner  running
keycloak-benchmark-db   healthy
keycloak-benchmark-target  healthy
authentik-benchmark-db   healthy
authentik-benchmark-target  healthy
authentik-benchmark-redis   healthy
zitadel-benchmark-db   healthy
zitadel-benchmark-target  healthy
```

### 4. Wait for Services to Initialize

Different IAM solutions have different startup times:

| System | Typical Startup Time |
|--------|---------------------|
| Idenplane | 3-5 seconds |
| Keycloak | 60-90 seconds |
| Authentik | 30-60 seconds |
| Zitadel | 15-30 seconds |

```bash
# Wait for Idenplane specifically
docker compose -f benchmarks/docker-compose.benchmarks.yml logs --follow app 2>&1 | grep -q "Server running" || echo "Idenplane started"
```

---

## Configuration Options

### k6 Configuration (benchmarks/k6/config.js)

```javascript
export const options = {
  scenarios: {
    auth_load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 50 },  // Ramp-up
        { duration: '60s', target: 50 },  // Steady state
        { duration: '10s', target: 0 },  // Ramp-down
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(50)<50', 'p(95)<200', 'p(99)<500'],
    http_req_failed: ['rate<0.01'],
  },
};
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TARGET_URL` | `http://localhost:3000` | Target application URL |
| `VUS` | `50` | Number of virtual users |
| `DURATION` | `60s` | Test duration |
| `RAMP_UP` | `10s` | Ramp-up period |
| `ADMIN_API_KEY` | (required) | API key for authentication |

### Customizing Workloads

#### High-Load Scenario
```bash
VUS=100 DURATION=300s ./benchmarks/scripts/run-benchmarks.sh --target idenplane
```

#### Quick Smoke Test
```bash
VUS=5 DURATION=10s ./benchmarks/scripts/run-benchmarks.sh --target idenplane
```

---

## Running Benchmarks

### Full Benchmark Suite

```bash
# Run all benchmarks with default settings
./benchmarks/scripts/run-benchmarks.sh --target all
```

### Individual System Benchmarks

```bash
# Idenplane only
./benchmarks/scripts/run-benchmarks.sh --target idenplane

# Keycloak only
./benchmarks/scripts/run-benchmarks.sh --target keycloak

# Authentik only
./benchmarks/scripts/run-benchmarks.sh --target authentik

# Zitadel only
./benchmarks/scripts/run-benchmarks.sh --target zitadel
```

### Generate Reports

```bash
# Generate HTML comparison report
python3 benchmarks/scripts/generate-report.py benchmarks/results/

# Compare specific results
python3 benchmarks/scripts/compare-results.py benchmarks/results/idenplane-baseline.json benchmarks/results/keycloak-results.json
```

### Clean Up

```bash
# Stop services but preserve data
docker compose -f benchmarks/docker-compose.benchmarks.yml stop

# Stop and remove all data
docker compose -f benchmarks/docker-compose.benchmarks.yml down --volumes

# Complete teardown with setup script
./benchmarks/scripts/teardown.sh
```

---

## Interpreting Results

### Key Metrics

#### Memory Usage
- **MB**: Total memory consumed by the container
- **%**: Memory percentage of container limit
- Measure taken during steady-state load (not peak or startup)

#### Throughput (req/s)
- **Overall**: Total requests per second across all endpoints
- **Per-endpoint**: Requests/second for login, token, userinfo
- Higher is better

#### Latency Percentiles
- **p50**: Median response time
- **p95**: 95th percentile (slowest 5% of requests)
- **p99**: 99th percentile (slowest 1% of requests)
- Lower is better

### Example Output

```json
{
  "idenplane": {
    "memory_mb": 150,
    "requests_per_second": 2500,
    "latency_p50_ms": 12.5,
    "latency_p95_ms": 45.2,
    "latency_p99_ms": 98.7
  }
}
```

### Understanding the Comparison

Idenplane vs Keycloak efficiency:
- **Memory**: 150MB vs 1,250MB = 8.3x more efficient
- **Throughput**: 2,500 vs 450 req/s = 5.5x more throughput
- **p99 Latency**: 98.7ms vs 423.5ms = 4.3x lower latency

---

## Troubleshooting

### Common Issues

#### "Container failed to start"

```bash
# Check logs
docker compose -f benchmarks/docker-compose.benchmarks.yml logs app

# Common fix: increase start period
# Edit docker-compose.benchmarks.yml and increase start_period for the failing service
```

#### "Benchmark results are inconsistent"

- Ensure no other heavy processes are running
- Use fresh containers for each benchmark run
- Wait for warm-up period before measuring

#### "Connection refused" errors

```bash
# Verify containers are on the same network
docker network ls
docker network inspect benchmarks_benchmarks

# Check service ports
docker compose -f benchmarks/docker-compose.benchmarks.yml ps
```

#### "Out of memory" errors

```bash
# Increase Docker memory limit
# Docker Desktop > Settings > Resources > Memory > 8GB

# Or reduce VUS for testing
VUS=10 DURATION=30s ./benchmarks/scripts/run-benchmarks.sh --target idenplane
```

### Performance Tips

1. **Close unnecessary applications** during benchmarking
2. **Use a dedicated machine** for accurate results
3. **Run multiple iterations** and average results
4. **Verify network stability** between runs
5. **Warm up services** before measuring steady-state metrics

### Getting Help

- [Idenplane GitHub Issues](https://github.com/idenplane/idenplane/issues)
- [k6 Documentation](https://grafana.com/docs/k6/latest/)
- [Docker Compose Docs](https://docs.docker.com/compose/)

---

## Contributing

To contribute benchmark improvements or report methodology issues:

1. Fork the repository
2. Create a branch: `git checkout -b benchmark-improvement`
3. Make your changes following this methodology
4. Test changes locally
5. Submit a pull request with benchmark verification

---

*Last updated: 2026-05-10*
