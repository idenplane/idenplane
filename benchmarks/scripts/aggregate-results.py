#!/usr/bin/env python3
# ─────────────────────────────────────────────────────────────────────────────
# benchmarks/scripts/aggregate-results.py
#
# Aggregates benchmark results across multiple runs and targets to
# provide statistical summaries (mean, min, max, std dev).
#
# What it does:
#   1. Loads result JSON files from a results directory
#   2. Groups results by target
#   3. Calculates aggregated statistics per target
#   4. Generates an aggregated JSON summary
#
# Usage:
#   python3 benchmarks/scripts/aggregate-results.py <results_directory>
#   python3 benchmarks/scripts/aggregate-results.py benchmarks/results/
#
# Output:
#   benchmarks/results/aggregated-results.json
#   benchmarks/results/aggregated-summary.json
# ─────────────────────────────────────────────────────────────────────────────

import argparse
import json
import math
import sys
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from typing import Optional


# ── Data classes ────────────────────────────────────────────────────────────────


@dataclass
class BenchmarkRun:
    target: str
    timestamp: str
    memory_mb: int
    memory_percent: str
    cpu_percent: str
    vus: int
    duration: str
    requests_per_second: Optional[float] = None
    latency_p50_ms: Optional[float] = None
    latency_p95_ms: Optional[float] = None
    latency_p99_ms: Optional[float] = None
    errors_rate: Optional[float] = None

    @classmethod
    def from_file(cls, filepath: Path) -> "BenchmarkRun":
        """Load result from a JSON file."""
        with open(filepath) as f:
            data = json.load(f)

        return cls(
            target=data.get("target", filepath.stem),
            timestamp=data.get("timestamp", ""),
            memory_mb=data.get("memory_mb", 0),
            memory_percent=data.get("memory_percent", "0%"),
            cpu_percent=data.get("cpu_percent", "0%"),
            vus=data.get("vus", 0),
            duration=data.get("duration", ""),
            requests_per_second=data.get("requests_per_second"),
            latency_p50_ms=data.get("latency_p50_ms"),
            latency_p95_ms=data.get("latency_p95_ms"),
            latency_p99_ms=data.get("latency_p99_ms"),
            errors_rate=data.get("errors_rate"),
        )


@dataclass
class AggregatedMetrics:
    target: str
    runs: int
    memory_mb_avg: float
    memory_mb_min: int
    memory_mb_max: int
    memory_mb_std: float
    rps_avg: Optional[float]
    rps_min: Optional[float]
    rps_max: Optional[float]
    rps_std: Optional[float]
    p50_avg: Optional[float]
    p50_min: Optional[float]
    p50_max: Optional[float]
    p95_avg: Optional[float]
    p95_min: Optional[float]
    p95_max: Optional[float]
    p99_avg: Optional[float]
    p99_min: Optional[float]
    p99_max: Optional[float]
    errors_avg: Optional[float]


# ── Helper functions ────────────────────────────────────────────────────────────


def load_results(results_dir: Path) -> list[BenchmarkRun]:
    """Load all benchmark result files from the results directory."""
    results = []

    for json_file in sorted(results_dir.glob("**/*.json")):
        # Skip archive, comparison, and aggregation files
        if "archive" in str(json_file):
            continue
        if json_file.name in (
            "comparison-report.html",
            "comparison-summary.json",
            "aggregated-results.json",
            "aggregated-summary.json",
        ):
            continue

        try:
            result = BenchmarkRun.from_file(json_file)
            results.append(result)
        except (json.JSONDecodeError, KeyError) as e:
            print(f"  Warning: Could not parse {json_file.name}: {e}", file=sys.stderr)
            continue

    return results


def group_by_target(results: list[BenchmarkRun]) -> dict[str, list[BenchmarkRun]]:
    """Group benchmark results by target."""
    groups: dict[str, list[BenchmarkRun]] = {}

    for result in results:
        if result.target not in groups:
            groups[result.target] = []
        groups[result.target].append(result)

    return groups


def calculate_std(values: list[float]) -> float:
    """Calculate standard deviation for a list of values."""
    if len(values) < 2:
        return 0.0

    mean = sum(values) / len(values)
    variance = sum((x - mean) ** 2 for x in values) / (len(values) - 1)
    return math.sqrt(variance)


def aggregate_target(target: str, runs: list[BenchmarkRun]) -> AggregatedMetrics:
    """Calculate aggregated metrics for a target's runs."""
    memory_values = [r.memory_mb for r in runs if r.memory_mb]
    rps_values = [r.requests_per_second for r in runs if r.requests_per_second is not None]
    p50_values = [r.latency_p50_ms for r in runs if r.latency_p50_ms is not None]
    p95_values = [r.latency_p95_ms for r in runs if r.latency_p95_ms is not None]
    p99_values = [r.latency_p99_ms for r in runs if r.latency_p99_ms is not None]
    errors_values = [r.errors_rate for r in runs if r.errors_rate is not None]

    return AggregatedMetrics(
        target=target,
        runs=len(runs),
        memory_mb_avg=round(sum(memory_values) / len(memory_values), 2) if memory_values else 0.0,
        memory_mb_min=min(memory_values) if memory_values else 0,
        memory_mb_max=max(memory_values) if memory_values else 0,
        memory_mb_std=round(calculate_std([float(v) for v in memory_values]), 2) if len(memory_values) >= 2 else 0.0,
        rps_avg=round(sum(rps_values) / len(rps_values), 2) if rps_values else None,
        rps_min=min(rps_values) if rps_values else None,
        rps_max=max(rps_values) if rps_values else None,
        rps_std=round(calculate_std(rps_values), 2) if len(rps_values) >= 2 else None,
        p50_avg=round(sum(p50_values) / len(p50_values), 2) if p50_values else None,
        p50_min=min(p50_values) if p50_values else None,
        p50_max=max(p50_values) if p50_values else None,
        p95_avg=round(sum(p95_values) / len(p95_values), 2) if p95_values else None,
        p95_min=min(p95_values) if p95_values else None,
        p95_max=max(p95_values) if p95_values else None,
        p99_avg=round(sum(p99_values) / len(p99_values), 2) if p99_values else None,
        p99_min=min(p99_values) if p99_values else None,
        p99_max=max(p99_values) if p99_values else None,
        errors_avg=round(sum(errors_values) / len(errors_values), 2) if errors_values else None,
    )


def aggregate_all(results: list[BenchmarkRun]) -> list[AggregatedMetrics]:
    """Aggregate results by target."""
    groups = group_by_target(results)
    aggregated = []

    for target, runs in sorted(groups.items()):
        metrics = aggregate_target(target, runs)
        aggregated.append(metrics)

    return aggregated


def generate_aggregated_json(
    aggregated: list[AggregatedMetrics],
    output_path: Path,
    timestamp: str,
) -> None:
    """Generate an aggregated JSON file with detailed metrics."""
    data = {
        "generated_at": timestamp,
        "total_runs": sum(a.runs for a in aggregated),
        "total_targets": len(aggregated),
        "targets": [asdict(a) for a in aggregated],
    }

    with open(output_path, "w") as f:
        json.dump(data, f, indent=2)

    print(f"  ✓ Aggregated results saved: {output_path}")


def generate_summary_json(
    aggregated: list[AggregatedMetrics],
    output_path: Path,
    timestamp: str,
) -> None:
    """Generate a summary JSON with key metrics only."""
    summary = {
        "generated_at": timestamp,
        "summary": {},
    }

    for a in aggregated:
        summary["summary"][a.target] = {
            "runs": a.runs,
            "memory_mb_avg": a.memory_mb_avg,
            "memory_mb_min": a.memory_mb_min,
            "memory_mb_max": a.memory_mb_max,
            "rps_avg": a.rps_avg,
            "rps_min": a.rps_min,
            "rps_max": a.rps_max,
            "p95_avg": a.p95_avg,
            "errors_avg": a.errors_avg,
        }

    with open(output_path, "w") as f:
        json.dump(summary, f, indent=2)

    print(f"  ✓ Summary saved: {output_path}")


# ── Main function ─────────────────────────────────────────────────────────────


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Aggregate benchmark results across multiple runs"
    )
    parser.add_argument(
        "results_dir",
        type=Path,
        nargs="?",
        default=Path("benchmarks/results"),
        help="Directory containing benchmark result JSON files",
    )
    args = parser.parse_args()

    print("")
    print("═══════════════════════════════════════════════════════════════════════════")
    print("  Idenplane Benchmark Aggregation")
    print("═══════════════════════════════════════════════════════════════════════════")
    print("")

    # Validate results directory
    if not args.results_dir.exists():
        print(f"ERROR: Results directory not found: {args.results_dir}", file=sys.stderr)
        print("")
        print("  Run benchmarks first:")
        print("    ./benchmarks/scripts/run-benchmarks.sh")
        print("")
        return 1

    # Load results
    print(f"[1/3] Loading results from {args.results_dir}...")
    results = load_results(args.results_dir)

    if not results:
        print("  ⚠ No benchmark results found")
        print("")
        print("  Run benchmarks first:")
        print("    ./benchmarks/scripts/run-benchmarks.sh")
        print("")
        return 1

    print(f"  ✓ Loaded {len(results)} result file(s)")

    # Group and aggregate
    print("")
    print("[2/3] Aggregating results by target...")
    groups = group_by_target(results)
    aggregated = aggregate_all(results)

    for metrics in aggregated:
        print(f"  ✓ {metrics.target}: {metrics.runs} run(s) aggregated")

    # Generate output files
    print("")
    print("[3/3] Generating aggregated output files...")
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S UTC")

    results_path = args.results_dir / "aggregated-results.json"
    generate_aggregated_json(aggregated, results_path, timestamp)

    summary_path = args.results_dir / "aggregated-summary.json"
    generate_summary_json(aggregated, summary_path, timestamp)

    print("")
    print("═══════════════════════════════════════════════════════════════════════════")
    print("  Aggregation Complete")
    print("═══════════════════════════════════════════════════════════════════════════")
    print("")
    print(f"  Targets processed: {len(aggregated)}")
    print(f"  Total runs: {sum(a.runs for a in aggregated)}")
    print("")
    print(f"  Output files:")
    print(f"    - {results_path}")
    print(f"    - {summary_path}")
    print("")

    return 0


if __name__ == "__main__":
    sys.exit(main())
