#!/usr/bin/env python3
# ─────────────────────────────────────────────────────────────────────────────
# benchmarks/scripts/continuous-benchmark.py
#
# Runs benchmarks on a continuous/scheduled basis and tracks performance
# over time to detect regressions and trends.
#
# What it does:
#   1. Runs benchmarks at configurable intervals
#   2. Stores results with timestamps in an archive directory
#   3. Compares new results against historical baselines
#   4. Detects performance regressions
#   5. Generates trend reports
#
# Usage:
#   python3 benchmarks/scripts/continuous-benchmark.py <results_dir> --interval <minutes>
#   python3 benchmarks/scripts/continuous-benchmark.py benchmarks/results/ --interval 60
#   python3 benchmarks/scripts/continuous-benchmark.py benchmarks/results/ --once
#
# Output:
#   benchmarks/results/archive/<timestamp>-<target>.json
#   benchmarks/results/trend-report.html
#   benchmarks/results/regression-report.json
# ─────────────────────────────────────────────────────────────────────────────

import argparse
import json
import os
import subprocess
import sys
from dataclasses import dataclass, asdict
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional


# ── Data classes ────────────────────────────────────────────────────────────────


@dataclass
class BenchmarkSnapshot:
    """Represents a single benchmark snapshot."""
    target: str
    timestamp: str
    run_id: str
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
    def from_file(cls, filepath: Path) -> "BenchmarkSnapshot":
        """Load snapshot from a JSON file."""
        with open(filepath) as f:
            data = json.load(f)
        # Handle nested structure like authme-baseline.json
        if "authme" in data:
            data = data["authme"]

        return cls(
            target=data.get("target", filepath.stem),
            timestamp=data.get("timestamp", ""),
            run_id=data.get("run_id", ""),
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

    def to_dict(self) -> dict:
        """Convert snapshot to dictionary."""
        return asdict(self)


@dataclass
class RegressionAlert:
    """Represents a detected performance regression."""
    target: str
    metric: str
    current_value: float
    baseline_value: float
    change_percent: float
    severity: str  # "warning", "critical"
    message: str


# ── Helper functions ────────────────────────────────────────────────────────────


def get_archive_dir(results_dir: Path) -> Path:
    """Get or create the archive directory."""
    archive_dir = results_dir / "archive"
    archive_dir.mkdir(parents=True, exist_ok=True)
    return archive_dir


def archive_result(result_file: Path, archive_dir: Path) -> Optional[Path]:
    """Archive a benchmark result with timestamp."""
    if not result_file.exists():
        return None

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    target_name = result_file.stem
    archived_path = archive_dir / f"{timestamp}-{target_name}.json"

    try:
        with open(result_file) as src:
            data = json.load(src)
        with open(archived_path, "w") as dst:
            json.dump(data, dst, indent=2)
        return archived_path
    except (json.JSONDecodeError, IOError, OSError) as e:
        print(f"  Warning: Could not archive {result_file}: {e}", file=sys.stderr)
        return None


def load_archived_snapshots(archive_dir: Path, target: Optional[str] = None, days: int = 30) -> list[BenchmarkSnapshot]:
    """Load archived snapshots from the archive directory."""
    snapshots = []
    cutoff_date = datetime.now() - timedelta(days=days)

    if not archive_dir.exists():
        return snapshots

    for json_file in sorted(archive_dir.glob("*.json")):
        if target and target not in json_file.stem:
            continue

        try:
            snapshot = BenchmarkSnapshot.from_file(json_file)
            # Filter by date if timestamp is available
            if snapshot.timestamp:
                try:
                    snapshot_date = datetime.fromisoformat(snapshot.timestamp.replace("Z", "+00:00"))
                    if snapshot_date < cutoff_date:
                        continue
                except ValueError:
                    pass
            snapshots.append(snapshot)
        except (json.JSONDecodeError, KeyError) as e:
            print(f"  Warning: Could not parse {json_file.name}: {e}", file=sys.stderr)
            continue

    return snapshots


def calculate_baseline(snapshots: list[BenchmarkSnapshot], window: int = 5) -> Optional[BenchmarkSnapshot]:
    """Calculate baseline metrics from recent snapshots."""
    if not snapshots:
        return None

    # Use most recent snapshots
    recent = snapshots[-window:] if len(snapshots) > window else snapshots

    memory_values = [s.memory_mb for s in recent]
    rps_values = [s.requests_per_second for s in recent if s.requests_per_second is not None]
    p95_values = [s.latency_p95_ms for s in recent if s.latency_p95_ms is not None]
    errors_values = [s.errors_rate for s in recent if s.errors_rate is not None]

    latest = recent[-1]
    return BenchmarkSnapshot(
        target=latest.target,
        timestamp=f"baseline-{len(recent)}-runs",
        run_id="baseline",
        memory_mb=int(sum(memory_values) / len(memory_values)) if memory_values else 0,
        memory_percent=f"{int(sum(int(s.memory_percent.rstrip('%')) for s in recent if s.memory_percent) / len(recent))}%",
        cpu_percent=f"{int(sum(int(s.cpu_percent.rstrip('%')) for s in recent if s.cpu_percent) / len(recent))}%",
        vus=latest.vus,
        duration=latest.duration,
        requests_per_second=sum(rps_values) / len(rps_values) if rps_values else None,
        latency_p50_ms=latest.latency_p50_ms,
        latency_p95_ms=sum(p95_values) / len(p95_values) if p95_values else None,
        latency_p99_ms=latest.latency_p99_ms,
        errors_rate=sum(errors_values) / len(errors_values) if errors_values else None,
    )


def detect_regressions(
    current: BenchmarkSnapshot,
    baseline: BenchmarkSnapshot,
    memory_threshold: float = 10.0,
    rps_threshold: float = -10.0,
    latency_threshold: float = 15.0,
    errors_threshold: float = 1.0,
) -> list[RegressionAlert]:
    """Detect performance regressions compared to baseline."""
    alerts = []

    # Memory regression (higher is worse)
    if current.memory_mb > baseline.memory_mb and baseline.memory_mb > 0:
        change_pct = ((current.memory_mb - baseline.memory_mb) / baseline.memory_mb) * 100
        if change_pct >= memory_threshold:
            severity = "critical" if change_pct >= memory_threshold * 2 else "warning"
            alerts.append(RegressionAlert(
                target=current.target,
                metric="memory_mb",
                current_value=current.memory_mb,
                baseline_value=baseline.memory_mb,
                change_percent=change_pct,
                severity=severity,
                message=f"Memory usage increased by {change_pct:.1f}% (baseline: {baseline.memory_mb} MB, current: {current.memory_mb} MB)",
            ))

    # Throughput regression (lower is worse)
    if current.requests_per_second and baseline.requests_per_second:
        if current.requests_per_second < baseline.requests_per_second:
            change_pct = ((current.requests_per_second - baseline.requests_per_second) / baseline.requests_per_second) * 100
            if change_pct <= rps_threshold:
                severity = "critical" if change_pct <= rps_threshold * 2 else "warning"
                alerts.append(RegressionAlert(
                    target=current.target,
                    metric="requests_per_second",
                    current_value=current.requests_per_second,
                    baseline_value=baseline.requests_per_second,
                    change_percent=change_pct,
                    severity=severity,
                    message=f"Throughput decreased by {abs(change_pct):.1f}% (baseline: {baseline.requests_per_second:.2f} req/s, current: {current.requests_per_second:.2f} req/s)",
                ))

    # Latency regression (higher is worse)
    if current.latency_p95_ms and baseline.latency_p95_ms:
        if current.latency_p95_ms > baseline.latency_p95_ms:
            change_pct = ((current.latency_p95_ms - baseline.latency_p95_ms) / baseline.latency_p95_ms) * 100
            if change_pct >= latency_threshold:
                severity = "critical" if change_pct >= latency_threshold * 2 else "warning"
                alerts.append(RegressionAlert(
                    target=current.target,
                    metric="latency_p95_ms",
                    current_value=current.latency_p95_ms,
                    baseline_value=baseline.latency_p95_ms,
                    change_percent=change_pct,
                    severity=severity,
                    message=f"p95 latency increased by {change_pct:.1f}% (baseline: {baseline.latency_p95_ms:.2f}ms, current: {current.latency_p95_ms:.2f}ms)",
                ))

    # Error rate regression (higher is worse)
    if current.errors_rate and current.errors_rate > errors_threshold:
        if baseline.errors_rate:
            change_pct = ((current.errors_rate - baseline.errors_rate) / baseline.errors_rate) * 100 if baseline.errors_rate > 0 else 100
        else:
            change_pct = 100

        if change_pct >= 50:
            alerts.append(RegressionAlert(
                target=current.target,
                metric="errors_rate",
                current_value=current.errors_rate,
                baseline_value=baseline.errors_rate or 0,
                change_percent=change_pct,
                severity="critical",
                message=f"Error rate increased to {current.errors_rate:.2f}% (baseline: {baseline.errors_rate or 0:.2f}%)",
            ))

    return alerts


def run_benchmarks(benchmark_script: Path) -> bool:
    """Run the benchmark suite."""
    if not benchmark_script.exists():
        print(f"ERROR: Benchmark script not found: {benchmark_script}", file=sys.stderr)
        return False

    try:
        result = subprocess.run(
            [str(benchmark_script)],
            capture_output=True,
            text=True,
            timeout=600,
        )
        return result.returncode == 0
    except subprocess.TimeoutExpired:
        print("ERROR: Benchmark timed out after 10 minutes", file=sys.stderr)
        return False
    except Exception as e:
        print(f"ERROR: Failed to run benchmarks: {e}", file=sys.stderr)
        return False


def generate_trend_report(
    snapshots: list[BenchmarkSnapshot],
    output_path: Path,
    timestamp: str,
) -> None:
    """Generate an HTML trend report."""
    # Group by target
    targets: dict[str, list[BenchmarkSnapshot]] = {}
    for snap in snapshots:
        if snap.target not in targets:
            targets[snap.target] = []
        targets[snap.target].append(snap)

    # Build trend data
    trend_rows = ""
    for target, target_snapshots in sorted(targets.items()):
        memory_values = [s.memory_mb for s in target_snapshots]
        rps_values = [s.requests_per_second for s in target_snapshots if s.requests_per_second is not None]
        p95_values = [s.latency_p95_ms for s in target_snapshots if s.latency_p95_ms is not None]

        mem_trend = "stable"
        if len(memory_values) >= 2:
            diff = memory_values[-1] - memory_values[0]
            if diff > 10:
                mem_trend = "increasing"
            elif diff < -10:
                mem_trend = "decreasing"

        avg_mem = sum(memory_values) / len(memory_values) if memory_values else 0
        avg_rps = sum(rps_values) / len(rps_values) if rps_values else 0
        avg_p95 = sum(p95_values) / len(p95_values) if p95_values else 0

        trend_rows += f"""
            <tr>
                <td><strong>{target}</strong></td>
                <td>{len(target_snapshots)}</td>
                <td>{avg_mem:.0f} MB</td>
                <td><span class="trend-{mem_trend}">{mem_trend}</span></td>
                <td>{avg_rps:.2f} req/s</td>
                <td>{avg_p95:.2f} ms</td>
            </tr>
        """

    html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AuthMe Performance Trend Report</title>
    <style>
        :root {{
            --bg-primary: #0f172a;
            --bg-secondary: #1e293b;
            --bg-tertiary: #334155;
            --text-primary: #f8fafc;
            --text-secondary: #94a3b8;
            --accent: #3b82f6;
            --success: #22c55e;
            --warning: #f59e0b;
            --danger: #ef4444;
        }}

        * {{
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }}

        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: var(--bg-primary);
            color: var(--text-primary);
            line-height: 1.6;
            padding: 2rem;
        }}

        .container {{
            max-width: 1200px;
            margin: 0 auto;
        }}

        header {{
            margin-bottom: 2rem;
            padding-bottom: 1rem;
            border-bottom: 1px solid var(--bg-tertiary);
        }}

        h1 {{
            font-size: 2rem;
            font-weight: 700;
            margin-bottom: 0.5rem;
        }}

        .timestamp {{
            color: var(--text-secondary);
            font-size: 0.875rem;
        }}

        .summary-cards {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1rem;
            margin-bottom: 2rem;
        }}

        .card {{
            background: var(--bg-secondary);
            border-radius: 0.75rem;
            padding: 1.5rem;
            text-align: center;
        }}

        .card-value {{
            font-size: 2rem;
            font-weight: 700;
            color: var(--accent);
        }}

        .card-label {{
            font-size: 0.75rem;
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-top: 0.5rem;
        }}

        table {{
            width: 100%;
            border-collapse: collapse;
            background: var(--bg-secondary);
            border-radius: 0.75rem;
            overflow: hidden;
        }}

        th {{
            background: var(--bg-tertiary);
            padding: 1rem;
            text-align: left;
            font-weight: 600;
            font-size: 0.875rem;
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }}

        td {{
            padding: 1rem;
            border-bottom: 1px solid var(--bg-tertiary);
        }}

        tr:last-child td {{
            border-bottom: none;
        }}

        .trend-stable {{
            color: var(--success);
        }}

        .trend-increasing {{
            color: var(--danger);
        }}

        .trend-decreasing {{
            color: var(--accent);
        }}

        footer {{
            margin-top: 2rem;
            padding-top: 1rem;
            border-top: 1px solid var(--bg-tertiary);
            text-align: center;
            color: var(--text-secondary);
            font-size: 0.875rem;
        }}
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>AuthMe Performance Trend Report</h1>
            <p class="timestamp">Generated: {timestamp}</p>
        </header>

        <div class="summary-cards">
            <div class="card">
                <div class="card-value">{len(snapshots)}</div>
                <div class="card-label">Total Snapshots</div>
            </div>
            <div class="card">
                <div class="card-value">{len(targets)}</div>
                <div class="card-label">Targets Tracked</div>
            </div>
            <div class="card">
                <div class="card-value">{sum(1 for s in snapshots if s.timestamp and 'baseline' not in s.timestamp)}</div>
                <div class="card-label">Recent Runs</div>
            </div>
        </div>

        <table>
            <thead>
                <tr>
                    <th>Target</th>
                    <th>Runs</th>
                    <th>Avg Memory</th>
                    <th>Memory Trend</th>
                    <th>Avg Throughput</th>
                    <th>Avg p95 Latency</th>
                </tr>
            </thead>
            <tbody>
                {trend_rows}
            </tbody>
        </table>

        <footer>
            <p>AuthMe Continuous Benchmark Suite</p>
        </footer>
    </div>
</body>
</html>"""

    with open(output_path, "w") as f:
        f.write(html_content)


def generate_regression_report(
    alerts: list[RegressionAlert],
    output_path: Path,
    timestamp: str,
) -> None:
    """Generate a JSON report of detected regressions."""
    report = {
        "generated_at": timestamp,
        "total_alerts": len(alerts),
        "critical_count": sum(1 for a in alerts if a.severity == "critical"),
        "warning_count": sum(1 for a in alerts if a.severity == "warning"),
        "alerts": [asdict(a) for a in alerts],
    }

    with open(output_path, "w") as f:
        json.dump(report, f, indent=2)


def print_alerts(alerts: list[RegressionAlert]) -> None:
    """Print regression alerts to console."""
    if not alerts:
        print("")
        print("  ✓ No performance regressions detected")
        return

    print("")
    print("  ⚠ Performance Regressions Detected:")
    print("")

    for alert in alerts:
        severity_icon = "🔴" if alert.severity == "critical" else "⚠️"
        print(f"  {severity_icon} [{alert.severity.upper()}] {alert.target}")
        print(f"      {alert.message}")
        print("")


# ── Main function ─────────────────────────────────────────────────────────────


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run continuous performance benchmarks with regression detection"
    )
    parser.add_argument(
        "results_dir",
        type=Path,
        nargs="?",
        default=Path("benchmarks/results"),
        help="Directory containing benchmark result JSON files",
    )
    parser.add_argument(
        "--interval",
        type=int,
        default=0,
        help="Run benchmarks at this interval in minutes (0 = run once)",
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Run benchmarks once and exit",
    )
    parser.add_argument(
        "--benchmark-script",
        type=Path,
        default=Path("benchmarks/scripts/run-benchmarks.sh"),
        help="Path to the benchmark runner script",
    )
    parser.add_argument(
        "--days",
        type=int,
        default=30,
        help="Number of days of history to consider for baseline",
    )
    args = parser.parse_args()

    # Determine run mode
    run_once = args.once or args.interval == 0
    interval_seconds = args.interval * 60 if args.interval > 0 else 0

    print("")
    print("═══════════════════════════════════════════════════════════════════════════")
    print("  AuthMe Continuous Benchmark")
    print("═══════════════════════════════════════════════════════════════════════════")
    print("")

    if run_once:
        print(f"Mode: Single run")
    else:
        print(f"Mode: Continuous (every {args.interval} minutes)")
    print(f"Results directory: {args.results_dir}")
    print("")

    # Archive directory
    archive_dir = get_archive_dir(args.results_dir)
    print(f"[1/4] Archive directory: {archive_dir}")

    # Load historical snapshots for baseline
    print("")
    print(f"[2/4] Loading historical data (last {args.days} days)...")
    all_snapshots = load_archived_snapshots(archive_dir, days=args.days)
    print(f"  ✓ Loaded {len(all_snapshots)} archived snapshot(s)")

    # Calculate baselines per target
    targets: dict[str, list[BenchmarkSnapshot]] = {}
    for snap in all_snapshots:
        if snap.target not in targets:
            targets[snap.target] = []
        targets[snap.target].append(snap)

    baselines = {}
    for target, target_snapshots in targets.items():
        baseline = calculate_baseline(target_snapshots)
        if baseline:
            baselines[target] = baseline
            print(f"  ✓ {target} baseline: {baseline.memory_mb} MB, {baseline.requests_per_second or 0:.2f} req/s")

    # Run benchmarks
    print("")
    print("[3/4] Running benchmarks...")
    if run_benchmarks(args.benchmark_script):
        print("  ✓ Benchmarks completed successfully")

        # Archive all result files
        archived_count = 0
        for result_file in args.results_dir.glob("*.json"):
            if result_file.name in ("archive", "comparison-report.html", "comparison-summary.json",
                                   "aggregated-results.json", "aggregated-summary.json"):
                continue
            if archive_result(result_file, archive_dir):
                archived_count += 1

        print(f"  ✓ Archived {archived_count} result file(s)")
    else:
        print("  ⚠ Benchmark run had issues (check logs for details)")

    # Load new snapshots for regression detection
    print("")
    print("[4/4] Checking for regressions...")

    # Find new result files (not in archive format)
    new_snapshots = []
    for result_file in args.results_dir.glob("*-baseline.json"):
        try:
            snapshot = BenchmarkSnapshot.from_file(result_file)
            new_snapshots.append(snapshot)
        except (json.JSONDecodeError, KeyError):
            continue

    all_alerts = []
    for snapshot in new_snapshots:
        baseline = baselines.get(snapshot.target)
        if baseline:
            alerts = detect_regressions(snapshot, baseline)
            all_alerts.extend(alerts)
            if alerts:
                for alert in alerts:
                    print(f"  ⚠ {alert.target}: {alert.message}")

    print_alerts(all_alerts)

    # Generate trend report
    print("Generating trend report...")
    trend_path = args.results_dir / "trend-report.html"
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S UTC")
    generate_trend_report(all_snapshots + new_snapshots, trend_path, timestamp)
    print(f"  ✓ Trend report: {trend_path}")

    # Generate regression report if there are alerts
    if all_alerts:
        regression_path = args.results_dir / "regression-report.json"
        generate_regression_report(all_alerts, regression_path, timestamp)
        print(f"  ✓ Regression report: {regression_path}")

    print("")
    print("═══════════════════════════════════════════════════════════════════════════")
    print("  Continuous Benchmark Complete")
    print("═══════════════════════════════════════════════════════════════════════════")
    print("")
    print(f"  Total snapshots: {len(all_snapshots) + len(new_snapshots)}")
    print(f"  Regressions found: {len(all_alerts)}")
    print("")
    print(f"  Trend report: {trend_path}")
    print("")

    return 0


if __name__ == "__main__":
    sys.exit(main())
