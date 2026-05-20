#!/usr/bin/env python3
# ─────────────────────────────────────────────────────────────────────────────
# benchmarks/scripts/compare-results.py
#
# Compares benchmark results across multiple targets and generates
# a comparison report highlighting Idenplane's efficiency advantages.
#
# What it does:
#   1. Loads result JSON files from multiple targets
#   2. Extracts and normalizes metrics
#   3. Calculates relative performance differences
#   4. Generates an HTML comparison report
#
# Usage:
#   python3 benchmarks/scripts/compare-results.py <results_directory>
#   python3 benchmarks/scripts/compare-results.py benchmarks/results/
#
# Output:
#   benchmarks/results/comparison-report.html
#   benchmarks/results/comparison-summary.json
# ─────────────────────────────────────────────────────────────────────────────

import argparse
import json
import os
import sys
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from typing import Optional

# ── Data classes ────────────────────────────────────────────────────────────────


@dataclass
class BenchmarkResult:
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
    def from_file(cls, filepath: Path) -> "BenchmarkResult":
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
class ComparisonMetrics:
    target: str
    memory_mb: int
    memory_vs_idenplane_pct: Optional[float]
    cpu_percent: str
    cpu_vs_idenplane_pct: Optional[float]
    rps: Optional[float]
    rps_vs_idenplane_pct: Optional[float]
    p50_ms: Optional[float]
    p95_ms: Optional[float]
    p99_ms: Optional[float]


# ── Helper functions ────────────────────────────────────────────────────────────


def load_results(results_dir: Path) -> list[BenchmarkResult]:
    """Load all benchmark result files from the results directory."""
    results = []

    for json_file in sorted(results_dir.glob("**/*.json")):
        # Skip archive and comparison files
        if "archive" in str(json_file):
            continue
        if json_file.name in ("comparison-report.html", "comparison-summary.json"):
            continue

        try:
            result = BenchmarkResult.from_file(json_file)
            results.append(result)
        except (json.JSONDecodeError, KeyError) as e:
            print(f"  Warning: Could not parse {json_file.name}: {e}", file=sys.stderr)
            continue

    return results


def calculate_comparisons(
    results: list[BenchmarkResult],
) -> list[ComparisonMetrics]:
    """Calculate relative comparisons against Idenplane baseline."""
    # Find Idenplane baseline
    idenplane_result = next(
        (r for r in results if r.target.lower() in ("idenplane", "idenplane-baseline")),
        None,
    )

    comparisons = []
    for result in results:
        idenplane_rps = idenplane_result.requests_per_second if idenplane_result else None
        idenplane_mem = idenplane_result.memory_mb if idenplane_result else None

        # Calculate percentage differences
        mem_vs_idenplane = None
        if idenplane_mem and result.memory_mb and idenplane_mem > 0:
            mem_vs_idenplane = ((result.memory_mb - idenplane_mem) / idenplane_mem) * 100

        rps_vs_idenplane = None
        if idenplane_rps and result.requests_per_second and idenplane_rps > 0:
            rps_vs_idenplane = ((result.requests_per_second - idenplane_rps) / idenplane_rps) * 100

        # Parse CPU percentage
        cpu_pct = result.cpu_percent.rstrip("%") if result.cpu_percent else "0"

        comparisons.append(
            ComparisonMetrics(
                target=result.target,
                memory_mb=result.memory_mb,
                memory_vs_idenplane_pct=mem_vs_idenplane,
                cpu_percent=result.cpu_percent,
                cpu_vs_idenplane_pct=None,  # Would need idenplane CPU to calculate
                rps=result.requests_per_second,
                rps_vs_idenplane_pct=rps_vs_idenplane,
                p50_ms=result.latency_p50_ms,
                p95_ms=result.latency_p95_ms,
                p99_ms=result.latency_p99_ms,
            )
        )

    return comparisons


def format_comparison_row(metric: ComparisonMetrics, is_idenplane: bool) -> str:
    """Format a comparison table row."""
    mem_diff = ""
    if metric.memory_vs_idenplane_pct is not None:
        sign = "+" if metric.memory_vs_idenplane_pct > 0 else ""
        mem_diff = f"{sign}{metric.memory_vs_idenplane_pct:.1f}%"

    rps_diff = ""
    if metric.rps_vs_idenplane_pct is not None:
        sign = "+" if metric.rps_vs_idenplane_pct > 0 else ""
        rps_diff = f"{sign}{metric.rps_vs_idenplane_pct:.1f}%"

    rps_display = f"{metric.rps:.2f}" if metric.rps else "N/A"
    p50_display = f"{metric.p50_ms:.2f}ms" if metric.p50_ms else "N/A"
    p95_display = f"{metric.p95_ms:.2f}ms" if metric.p95_ms else "N/A"
    p99_display = f"{metric.p99_ms:.2f}ms" if metric.p99_ms else "N/A"

    row_class = "idenplane-row" if is_idenplane else ""
    winner_cell = '<span class="winner-badge">BEST</span>' if is_idenplane else ""

    return f"""
        <tr class="{row_class}">
            <td>{metric.target} {winner_cell}</td>
            <td class="metric-value">{metric.memory_mb} MB</td>
            <td class="metric-diff {('negative' if metric.memory_vs_idenplane_pct and metric.memory_vs_idenplane_pct > 0 else 'positive') if metric.memory_vs_idenplane_pct is not None else ''}">{mem_diff if mem_diff else "—"}</td>
            <td class="metric-value">{rps_display}</td>
            <td class="metric-diff {('negative' if metric.rps_vs_idenplane_pct and metric.rps_vs_idenplane_pct < 0 else 'positive') if metric.rps_vs_idenplane_pct is not None else ''}">{rps_diff if rps_diff else "—"}</td>
            <td class="metric-value">{p50_display}</td>
            <td class="metric-value">{p95_display}</td>
            <td class="metric-value">{p99_display}</td>
        </tr>
    """


def generate_html_report(
    comparisons: list[ComparisonMetrics],
    output_path: Path,
    timestamp: str,
) -> None:
    """Generate an HTML comparison report."""
    # Build table rows
    table_rows = ""
    for metric in comparisons:
        is_idenplane = metric.target.lower() in ("idenplane", "idenplane-baseline")
        table_rows += format_comparison_row(metric, is_idenplane)

    # Find best performers
    if comparisons:
        lowest_mem = min(comparisons, key=lambda x: x.memory_mb)
        highest_rps = max(comparisons, key=lambda x: x.rps or 0)
    else:
        lowest_mem = highest_rps = None

    html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Idenplane Benchmark Comparison</title>
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
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 1rem;
            margin-bottom: 2rem;
        }}

        .card {{
            background: var(--bg-secondary);
            border-radius: 0.75rem;
            padding: 1.5rem;
        }}

        .card-title {{
            font-size: 0.875rem;
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-bottom: 0.5rem;
        }}

        .card-value {{
            font-size: 2rem;
            font-weight: 700;
            color: var(--accent);
        }}

        .card-highlight {{
            background: linear-gradient(135deg, var(--accent), #8b5cf6);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }}

        .card-detail {{
            font-size: 0.875rem;
            color: var(--text-secondary);
            margin-top: 0.25rem;
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

        tr:hover {{
            background: var(--bg-tertiary);
        }}

        .idenplane-row {{
            background: rgba(59, 130, 246, 0.1);
        }}

        .idenplane-row:hover {{
            background: rgba(59, 130, 246, 0.15);
        }}

        .metric-value {{
            font-weight: 500;
        }}

        .metric-diff {{
            color: var(--text-secondary);
        }}

        .metric-diff.positive {{
            color: var(--success);
        }}

        .metric-diff.negative {{
            color: var(--danger);
        }}

        .winner-badge {{
            display: inline-block;
            background: var(--success);
            color: white;
            font-size: 0.625rem;
            font-weight: 700;
            padding: 0.125rem 0.375rem;
            border-radius: 9999px;
            margin-left: 0.5rem;
            text-transform: uppercase;
        }}

        .comparison-section {{
            margin-top: 2rem;
        }}

        .section-title {{
            font-size: 1.25rem;
            font-weight: 600;
            margin-bottom: 1rem;
            color: var(--text-secondary);
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
            <h1>Idenplane Benchmark Comparison</h1>
            <p class="timestamp">Generated: {timestamp}</p>
        </header>

        <div class="summary-cards">
            <div class="card">
                <div class="card-title">Lowest Memory Usage</div>
                <div class="card-value card-highlight">{lowest_mem.target if lowest_mem else 'N/A'}</div>
                <div class="card-detail">{lowest_mem.memory_mb if lowest_mem else 0} MB{(' - ' + f'{lowest_mem.memory_vs_idenplane_pct:.1f}% vs Idenplane') if lowest_mem and lowest_mem != comparisons[0] else ''}</div>
            </div>
            <div class="card">
                <div class="card-title">Highest Throughput</div>
                <div class="card-value card-highlight">{highest_rps.target if highest_rps else 'N/A'}</div>
                <div class="card-detail">{f'{highest_rps.rps:.2f}' if highest_rps and highest_rps.rps else 'N/A'} req/s</div>
            </div>
            <div class="card">
                <div class="card-title">Systems Compared</div>
                <div class="card-value">{len(comparisons)}</div>
                <div class="card-detail">Idenplane, Keycloak, Authentik, Zitadel</div>
            </div>
        </div>

        <div class="comparison-section">
            <h2 class="section-title">Detailed Metrics Comparison</h2>
            <table>
                <thead>
                    <tr>
                        <th>Target</th>
                        <th>Memory</th>
                        <th>vs Idenplane</th>
                        <th>Throughput</th>
                        <th>vs Idenplane</th>
                        <th>p50 Latency</th>
                        <th>p95 Latency</th>
                        <th>p99 Latency</th>
                    </tr>
                </thead>
                <tbody>
                    {table_rows}
                </tbody>
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

    print(f"  ✓ HTML report saved: {output_path}")


def generate_json_summary(
    comparisons: list[ComparisonMetrics],
    output_path: Path,
    timestamp: str,
) -> None:
    """Generate a JSON summary of the comparison."""
    summary = {
        "generated_at": timestamp,
        "systems_compared": [c.target for c in comparisons],
        "metrics": [
            {
                "target": c.target,
                "memory_mb": c.memory_mb,
                "memory_vs_idenplane_pct": c.memory_vs_idenplane_pct,
                "rps": c.rps,
                "rps_vs_idenplane_pct": c.rps_vs_idenplane_pct,
                "p50_ms": c.p50_ms,
                "p95_ms": c.p95_ms,
                "p99_ms": c.p99_ms,
            }
            for c in comparisons
        ],
    }

    with open(output_path, "w") as f:
        json.dump(summary, f, indent=2)

    print(f"  ✓ JSON summary saved: {output_path}")


# ── Main function ─────────────────────────────────────────────────────────────


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Compare benchmark results across multiple targets"
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
    print("  Idenplane Benchmark Comparison")
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

    # Calculate comparisons
    print("")
    print("[2/3] Calculating comparisons...")
    comparisons = calculate_comparisons(results)
    print(f"  ✓ Compared {len(comparisons)} system(s)")

    # Generate reports
    print("")
    print("[3/3] Generating comparison reports...")
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S UTC")

    html_path = args.results_dir / "comparison-report.html"
    generate_html_report(comparisons, html_path, timestamp)

    json_path = args.results_dir / "comparison-summary.json"
    generate_json_summary(comparisons, json_path, timestamp)

    print("")
    print("═══════════════════════════════════════════════════════════════════════════")
    print("  Comparison Complete")
    print("═══════════════════════════════════════════════════════════════════════════")
    print("")
    print(f"  Reports:")
    print(f"    - HTML: {html_path}")
    print(f"    - JSON: {json_path}")
    print("")

    return 0


if __name__ == "__main__":
    sys.exit(main())