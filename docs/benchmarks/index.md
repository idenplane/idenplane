# Idenplane Performance Benchmarks

Performance benchmarking results comparing Idenplane against leading open-source IAM solutions: Keycloak, Authentik, and Zitadel.

## Overview

Idenplane delivers **8x lower memory usage** than Keycloak while achieving **5.5x higher throughput**. These benchmarks demonstrate Idenplane's resource efficiency advantage for teams seeking to reduce infrastructure costs without sacrificing authentication capabilities.

## Benchmark Results Summary

### Memory Comparison

| System | Memory Usage | vs Idenplane |
|--------|-------------|-----------|
| **Idenplane** | **150 MB** | 1.0x (baseline) |
| Keycloak | 1,250 MB | 8.3x more |
| Authentik | 720 MB | 4.8x more |
| Zitadel | 320 MB | 2.1x more |

Idenplane's ~150MB memory footprint is the lightest among all tested solutions, making it ideal for resource-constrained environments, cost-sensitive deployments, and containerized workloads.

### Throughput Comparison (req/s)

| System | Overall | Login | Token Issuance | UserInfo |
|--------|---------|-------|----------------|----------|
| **Idenplane** | **2,500 req/s** | 1,200 req/s | 800 req/s | 500 req/s |
| Keycloak | 450 req/s | 180 req/s | 150 req/s | 120 req/s |
| Authentik | 680 req/s | 220 req/s | 200 req/s | 160 req/s |
| Zitadel | 1,400 req/s | 420 req/s | 380 req/s | 320 req/s |

### Latency Percentiles (ms)

| System | p50 | p95 | p99 |
|--------|-----|-----|-----|
| **Idenplane** | **12.5** | **45.2** | **98.7** |
| Keycloak | 45.2 | 185.7 | 423.5 |
| Authentik | 38.4 | 142.5 | 312.8 |
| Zitadel | 28.5 | 105.3 | 235.7 |

## Test Configuration

- **Virtual Users**: 50
- **Duration**: 60 seconds
- **Ramp-up**: 10 seconds
- **Benchmarker**: k6 v0.50.0
- **Database**: PostgreSQL 16
- **Environment**: Docker containers

## Why Idenplane Wins on Resources

### 1. Memory Efficiency
Idenplane's lightweight Node.js architecture consumes ~150MB compared to:
- Keycloak's 1,250MB (JVM overhead)
- Authentik's 720MB (Django + Python runtime)
- Zitadel's 320MB (Go binary)

This translates to **80-90% cost savings on cloud infrastructure** for memory-constrained deployments.

### 2. Startup Time
Idenplane starts in seconds vs. the minutes required for JVM-based solutions:
- Idenplane: ~3 seconds
- Keycloak: ~60-90 seconds
- Authentik: ~30-60 seconds
- Zitadel: ~15-30 seconds

### 3. Throughput
Idenplane's async architecture handles 2,500 requests/second, enabling:
- Better user experience with lower latency
- Higher capacity per instance
- Lower infrastructure costs at scale

## Systems Tested

### Idenplane
- **Version**: main (latest)
- **Container**: islamawad/idenplane:latest
- **Memory**: 150 MB
- **Throughput**: 2,500 req/s

### Keycloak
- **Version**: 24.0
- **Container**: quay.io/keycloak/keycloak:24.0
- **Memory**: 1,250 MB
- **Throughput**: 450 req/s
- **Notes**: JVM heap settings (-Xms512m -Xmx1024m)

### Authentik
- **Version**: 2024.10
- **Container**: ghcr.io/goauthentik/server:2024.10
- **Memory**: 720 MB
- **Throughput**: 680 req/s
- **Notes**: Includes PostgreSQL + Redis backing services

### Zitadel
- **Version**: latest
- **Container**: ghcr.io/zitadel/zitadel:latest
- **Memory**: 320 MB
- **Throughput**: 1,400 req/s
- **Notes**: Go-based with gRPC backend

## Methodology

These benchmarks were run using identical workloads across all systems to ensure fair comparison. For details on how to reproduce these results, see the [Benchmark Methodology](methodology.md) document.

## Historical Tracking

Benchmarks are automatically run on every release using our [CI workflow](../../.github/workflows/benchmark.yml). This enables tracking Idenplane's performance over time and ensuring efficiency gains with each release.

## Quick Links

- [Full Methodology](methodology.md)
- [CI Workflow](../../.github/workflows/benchmark.yml)
- [Benchmark Source Code](../../benchmarks/)
- [Comparison Report (HTML)](../../benchmarks/results/comparison-report.html)
