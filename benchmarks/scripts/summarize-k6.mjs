#!/usr/bin/env node
// Turns k6 --summary-export files into a Markdown table and fails when a
// scenario's own success rate is below the bar. Latency is reported, not
// gated: shared CI runners are too noisy for latency to be a pass/fail signal,
// but a scenario that errors is broken.
//
//   node summarize-k6.mjs <results-dir> <scenario>... [--min-success 0.99]
import { readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const minIdx = args.indexOf('--min-success');
const minSuccess = minIdx >= 0 ? Number(args.splice(minIdx, 2)[1]) : 0.99;
const [dir, ...scenarios] = args;

const fmt = (n, digits = 1) =>
  typeof n === 'number' && Number.isFinite(n) ? n.toFixed(digits) : '—';

const rows = [];
let failed = false;
for (const name of scenarios) {
  const summary = JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8'));
  const m = summary.metrics ?? {};
  const duration = m['http_req_duration'] ?? {};
  const reqs = m['http_reqs'] ?? {};
  const success = m[`${name}_success_rate`];
  const rate = success?.value;
  const ok = typeof rate === 'number' && rate >= minSuccess;
  if (!ok) failed = true;
  rows.push(
    `| ${name} | ${fmt(reqs.rate)} | ${fmt(duration.med)} | ${fmt(duration['p(95)'])} | ${typeof rate === 'number' ? fmt(rate * 100, 2) + '%' : 'missing'} | ${ok ? '✅' : '❌'} |`,
  );
}

const table = [
  `### Benchmark results`,
  ``,
  `| scenario | req/s | p50 ms | p95 ms | success | |`,
  `|---|---|---|---|---|---|`,
  ...rows,
  ``,
  `Gate: each scenario's success rate ≥ ${minSuccess * 100}%. Latency is informational (shared runner).`,
].join('\n');

console.log(table);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, table + '\n');
}
process.exit(failed ? 1 : 0);
