#!/usr/bin/env python3
# ─────────────────────────────────────────────────────────────────────────────
# benchmarks/scripts/generate-report.py
#
# Generates an HTML report from benchmark results.
#
# What it does:
#   1. Reads benchmark summary JSON files
#   2. Parses k6 JSON output for detailed metrics
#   3. Creates a styled HTML report with charts
#
# Usage:
#   python3 benchmarks/scripts/generate-report.py <summary_file> <output_dir>
#   python3 benchmarks/scripts/generate-report.py benchmarks/results/idenplane-baseline.json benchmarks/results/
#
# Output:
#   <output_dir>/idenplane-report-<timestamp>.html
# ─────────────────────────────────────────────────────────────────────────────

import argparse
import json
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional


# ── Data classes ────────────────────────────────────────────────────────────────


@dataclass
class BenchmarkMetrics:
    target: str
    timestamp: str
    run_id: str
    memory_mb: int
    memory_percent: str
    cpu_percent: str
    vus: int
    duration: str
    ramp_up: str
    requests_per_second: Optional[float] = None
    latency_p50_ms: Optional[float] = None
    latency_p95_ms: Optional[float] = None
    latency_p99_ms: Optional[float] = None
    errors_rate: Optional[float] = None
    http_req_duration_avg: Optional[float] = None
    http_req_duration_min: Optional[float] = None
    http_req_duration_max: Optional[float] = None
    http_req_failed: Optional[float] = None


# ── Helper functions ────────────────────────────────────────────────────────────


def load_k6_json(k6_file: Path) -> dict:
    """Load and parse k6 JSON output file."""
    metrics = {
        "http_reqs": 0,
        "http_req_duration": {"avg": 0, "min": 0, "max": 0, "p(50)": 0, "p(95)": 0, "p(99)": 0},
        "checks": {"passes": 0, "fails": 0},
        "errors": 0,
    }

    if not k6_file.exists():
        return metrics

    try:
        with open(k6_file) as f:
            for line in f:
                try:
                    data = json.loads(line.strip())
                    # k6 JSON format: type indicates what the data represents
                    if data.get("type") == "Point" and "metrics" in data:
                        m = data["metrics"]
                        # Extract http_req_duration metrics
                        if "http_req_duration" in m:
                            for p in m["http_req_duration"].get("values", {}).items():
                                key, val = p
                                if key == "avg":
                                    metrics["http_req_duration"]["avg"] = val
                                elif key == "min":
                                    metrics["http_req_duration"]["min"] = val
                                elif key == "max":
                                    metrics["http_req_duration"]["max"] = val
                                elif key == "p(50)":
                                    metrics["http_req_duration"]["p(50)"] = val
                                elif key == "p(95)":
                                    metrics["http_req_duration"]["p(95)"] = val
                                elif key == "p(99)":
                                    metrics["http_req_duration"]["p(99)"] = val
                        # Extract http_reqs
                        if "http_reqs" in m:
                            metrics["http_reqs"] = m["http_reqs"].get("values", {}).get("count", 0)
                except json.JSONDecodeError:
                    continue
    except (IOError, OSError) as e:
        print(f"  Warning: Could not read {k6_file}: {e}", file=sys.stderr)

    return metrics


def load_summary(summary_file: Path) -> Optional[BenchmarkMetrics]:
    """Load benchmark metrics from summary JSON."""
    try:
        with open(summary_file) as f:
            data = json.load(f)

        return BenchmarkMetrics(
            target=data.get("target", "unknown"),
            timestamp=data.get("timestamp", ""),
            run_id=data.get("run_id", ""),
            memory_mb=data.get("memory_mb", 0),
            memory_percent=data.get("memory_percent", "0%"),
            cpu_percent=data.get("cpu_percent", "0%"),
            vus=data.get("vus", 0),
            duration=data.get("duration", ""),
            ramp_up=data.get("ramp_up", ""),
            requests_per_second=data.get("requests_per_second"),
            latency_p50_ms=data.get("latency_p50_ms"),
            latency_p95_ms=data.get("latency_p95_ms"),
            latency_p99_ms=data.get("latency_p99_ms"),
            errors_rate=data.get("errors_rate"),
            http_req_duration_avg=data.get("http_req_duration_avg"),
            http_req_duration_min=data.get("http_req_duration_min"),
            http_req_duration_max=data.get("http_req_duration_max"),
            http_req_failed=data.get("http_req_failed"),
        )
    except (json.JSONDecodeError, IOError, OSError) as e:
        print(f"  Error: Could not load summary {summary_file}: {e}", file=sys.stderr)
        return None


def generate_html_report(metrics: BenchmarkMetrics, output_path: Path) -> None:
    """Generate an HTML report for the benchmark results."""

    # Format values for display
    rps_display = f"{metrics.requests_per_second:.2f}" if metrics.requests_per_second else "N/A"
    p50_display = f"{metrics.latency_p50_ms:.2f}ms" if metrics.latency_p50_ms else "N/A"
    p95_display = f"{metrics.latency_p95_ms:.2f}ms" if metrics.latency_p95_ms else "N/A"
    p99_display = f"{metrics.latency_p99_ms:.2f}ms" if metrics.latency_p99_ms else "N/A"
    avg_display = f"{metrics.http_req_duration_avg:.2f}ms" if metrics.http_req_duration_avg else "N/A"
    min_display = f"{metrics.http_req_duration_min:.2f}ms" if metrics.http_req_duration_min else "N/A"
    max_display = f"{metrics.http_req_duration_max:.2f}ms" if metrics.http_req_duration_max else "N/A"
    err_rate = f"{metrics.errors_rate:.2f}%" if metrics.errors_rate else "0%"
    failed = f"{metrics.http_req_failed:.2f}%" if metrics.http_req_failed else "0%"

    html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Idenplane Benchmark Report - {metrics.target}</title>
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
            max-width: 1000px;
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

        .subtitle {{
            color: var(--text-secondary);
            font-size: 0.875rem;
        }}

        .run-id {{
            font-family: monospace;
            background: var(--bg-secondary);
            padding: 0.25rem 0.5rem;
            border-radius: 0.25rem;
            font-size: 0.75rem;
        }}

        .metrics-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1rem;
            margin-bottom: 2rem;
        }}

        .metric-card {{
            background: var(--bg-secondary);
            border-radius: 0.75rem;
            padding: 1.25rem;
            text-align: center;
        }}

        .metric-label {{
            font-size: 0.75rem;
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-bottom: 0.5rem;
        }}

        .metric-value {{
            font-size: 1.75rem;
            font-weight: 700;
            color: var(--accent);
        }}

        .metric-unit {{
            font-size: 0.875rem;
            color: var(--text-secondary);
            margin-top: 0.25rem;
        }}

        .section {{
            background: var(--bg-secondary);
            border-radius: 0.75rem;
            padding: 1.5rem;
            margin-bottom: 1.5rem;
        }}

        .section-title {{
            font-size: 1rem;
            font-weight: 600;
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-bottom: 1rem;
            padding-bottom: 0.5rem;
            border-bottom: 1px solid var(--bg-tertiary);
        }}

        .config-table {{
            width: 100%;
        }}

        .config-table td {{
            padding: 0.5rem 0;
        }}

        .config-table td:first-child {{
            color: var(--text-secondary);
            width: 40%;
        }}

        .config-table td:last-child {{
            font-weight: 500;
        }}

        .status-badge {{
            display: inline-block;
            padding: 0.25rem 0.75rem;
            border-radius: 9999px;
            font-size: 0.75rem;
            font-weight: 600;
            text-transform: uppercase;
        }}

        .status-success {{
            background: rgba(34, 197, 94, 0.2);
            color: var(--success);
        }}

        .status-warning {{
            background: rgba(245, 158, 11, 0.2);
            color: var(--warning);
        }}

        .status-danger {{
            background: rgba(239, 68, 68, 0.2);
            color: var(--danger);
        }}

        footer {{
            margin-top: 2rem;
            padding-top: 1rem;
            border-top: 1px solid var(--bg-tertiary);
            text-align: center;
            color: var(--text-secondary);
            font-size: 0.875rem;
        }}

        @media (max-width: 640px) {{
            body {{
                padding: 1rem;
            }}

            .metric-value {{
                font-size: 1.5rem;
            }}
        }}
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>Idenplane Benchmark Report</h1>
            <p class="subtitle">
                Target: <strong>{metrics.target}</strong> |
                Run ID: <span class="run-id">{metrics.run_id}</span>
            </p>
            <p class="subtitle" style="margin-top: 0.5rem;">
                Generated: {metrics.timestamp}
            </p>
        </header>

        <div class="metrics-grid">
            <div class="metric-card">
                <div class="metric-label">Memory Usage</div>
                <div class="metric-value">{metrics.memory_mb}</div>
                <div class="metric-unit">MB</div>
            </div>
            <div class="metric-card">
                <div class="metric-label">CPU Usage</div>
                <div class="metric-value">{metrics.cpu_percent}</div>
                <div class="metric-unit">&nbsp;</div>
            </div>
            <div class="metric-card">
                <div class="metric-label">Throughput</div>
                <div class="metric-value">{rps_display}</div>
                <div class="metric-unit">req/s</div>
            </div>
            <div class="metric-card">
                <div class="metric-label">p95 Latency</div>
                <div class="metric-value">{p95_display}</div>
                <div class="metric-unit">&nbsp;</div>
            </div>
        </div>

        <div class="section">
            <h2 class="section-title">Load Test Configuration</h2>
            <table class="config-table">
                <tr>
                    <td>Virtual Users (VUs)</td>
                    <td>{metrics.vus}</td>
                </tr>
                <tr>
                    <td>Duration</td>
                    <td>{metrics.duration}</td>
                </tr>
                <tr>
                    <td>Ramp-up Time</td>
                    <td>{metrics.ramp_up}</td>
                </tr>
            </table>
        </div>

        <div class="section">
            <h2 class="section-title">Request Performance</h2>
            <table class="config-table">
                <tr>
                    <td>Throughput</td>
                    <td>{rps_display} req/s</td>
                </tr>
                <tr>
                    <td>p50 Latency</td>
                    <td>{p50_display}</td>
                </tr>
                <tr>
                    <td>p95 Latency</td>
                    <td>{p95_display}</td>
                </tr>
                <tr>
                    <td>p99 Latency</td>
                    <td>{p99_display}</td>
                </tr>
                <tr>
                    <td>Avg Response Time</td>
                    <td>{avg_display}</td>
                </tr>
                <tr>
                    <td>Min Response Time</td>
                    <td>{min_display}</td>
                </tr>
                <tr>
                    <td>Max Response Time</td>
                    <td>{max_display}</td>
                </tr>
            </table>
        </div>

        <div class="section">
            <h2 class="section-title">Reliability</h2>
            <table class="config-table">
                <tr>
                    <td>Error Rate</td>
                    <td><span class="status-badge {('status-success' if metrics.errors_rate and metrics.errors_rate < 1 else 'status-warning' if metrics.errors_rate and metrics.errors_rate < 5 else 'status-danger') if metrics.errors_rate else 'status-success'}">{err_rate}</span></td>
                </tr>
                <tr>
                    <td>Failed Requests</td>
                    <td>{failed}</td>
                </tr>
            </table>
        </div>

        <footer>
            <p>Idenplane Performance Benchmark Suite</p>
        </footer>
    </div>
</body>
</html>"""

    with open(output_path, "w") as f:
        f.write(html_content)


# ── Main function ─────────────────────────────────────────────────────────────


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate HTML report from benchmark results")
    parser.add_argument("summary_file", type=Path, help="Path to the benchmark summary JSON file")
    parser.add_argument("output_dir", type=Path, nargs="?", default=Path("benchmarks/results"),
                        help="Output directory for the report")
    args = parser.parse_args()

    print("")
    print("═══════════════════════════════════════════════════════════════════════════")
    print("  Idenplane Benchmark Report Generator")
    print("═══════════════════════════════════════════════════════════════════════════")
    print("")

    # Validate summary file
    if not args.summary_file.exists():
        print(f"ERROR: Summary file not found: {args.summary_file}", file=sys.stderr)
        return 1

    # Load metrics
    print(f"[1/2] Loading summary: {args.summary_file}")
    metrics = load_summary(args.summary_file)

    if not metrics:
        print("ERROR: Could not parse summary file", file=sys.stderr)
        return 1

    print(f"  ✓ Target: {metrics.target}")
    print(f"  ✓ Memory: {metrics.memory_mb} MB")
    print(f"  ✓ CPU: {metrics.cpu_percent}")

    # Create output directory
    args.output_dir.mkdir(parents=True, exist_ok=True)

    # Generate report
    print("")
    print(f"[2/2] Generating HTML report...")
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_path = args.output_dir / f"{metrics.target}-report-{timestamp}.html"
    generate_html_report(metrics, output_path)

    print("")
    print("═══════════════════════════════════════════════════════════════════════════")
    print("  Report Generated")
    print("═══════════════════════════════════════════════════════════════════════════")
    print("")
    print(f"  Report saved to: {output_path}")
    print("")

    return 0


if __name__ == "__main__":
    sys.exit(main())