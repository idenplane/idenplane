#!/usr/bin/env node
// Turns the per-target output of compare.sh into one Markdown report.
// Every number is the median of the measured runs; the raw k6 summaries and
// docker-stats samples stay next to it for anyone who wants to check.
//
//   node benchmarks/compare/report.mjs [results-dir]   (default benchmarks/results/compare)
// Writes <results-dir>/REPORT.md and summary.json, prints the report, and
// appends it to $GITHUB_STEP_SUMMARY when set. Exits 1 if any measured run
// fell below a 99% check success rate: a fast error is not a result.
import { readFileSync, readdirSync, existsSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dir = process.argv[2] ?? join(here, '..', 'results', 'compare');
const MIN_SUCCESS = 0.99;

const median = (xs) => {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const fmt = (n, d = 0) => (Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }) : '—');

const UNITS = { B: 1, KB: 1e3, MB: 1e6, GB: 1e9, KIB: 1024, MIB: 1024 ** 2, GIB: 1024 ** 3 };
const toMiB = (s) => {
  const m = /^([\d.]+)\s*([a-z]+)$/i.exec(s.trim());
  return m ? (Number(m[1]) * (UNITS[m[2].toUpperCase()] ?? NaN)) / 1024 ** 2 : NaN;
};
// docker stats lines: "312.4MiB / 2GiB|153.21%"
const readStats = (file) =>
  existsSync(file)
    ? readFileSync(file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => {
          const [mem, cpu] = l.split('|');
          return { mib: toMiB(mem.split('/')[0]), cpu: Number.parseFloat(cpu) };
        })
        .filter((s) => Number.isFinite(s.mib))
    : [];

const targets = readdirSync(dir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'meta.json')))
  .map((d) => d.name)
  .sort((a, b) => (a === 'idenplane' ? -1 : b === 'idenplane' ? 1 : a.localeCompare(b)));
if (!targets.length) {
  console.error(`No results under ${dir}. Run compare.sh first.`);
  process.exit(1);
}

let failed = false;
const summary = {};
for (const t of targets) {
  const meta = JSON.parse(readFileSync(join(dir, t, 'meta.json'), 'utf8'));
  const idle = readStats(join(dir, t, 'idle.stats'));
  const scenarios = {};
  for (const s of meta.scenarios) {
    const runs = [];
    for (let i = 1; i <= meta.runs; i++) {
      const f = join(dir, t, `${s}-${i}.json`);
      if (!existsSync(f)) continue;
      const m = JSON.parse(readFileSync(f, 'utf8')).metrics ?? {};
      const d = m.http_req_duration ?? {};
      const checks = m.checks ?? {};
      const success = checks.passes + checks.fails > 0 ? checks.passes / (checks.passes + checks.fails) : NaN;
      const stats = readStats(join(dir, t, `${s}-${i}.stats`));
      runs.push({
        rps: m.http_reqs?.rate,
        p50: d.med,
        p95: d['p(95)'],
        p99: d['p(99)'],
        success,
        peakMiB: Math.max(...stats.map((x) => x.mib)),
        avgCpu: stats.reduce((a, x) => a + x.cpu, 0) / (stats.length || NaN),
      });
      if (!(success >= MIN_SUCCESS)) failed = true;
    }
    scenarios[s] = {
      runs: runs.length,
      rps: median(runs.map((r) => r.rps)),
      p50: median(runs.map((r) => r.p50)),
      p95: median(runs.map((r) => r.p95)),
      p99: median(runs.map((r) => r.p99)),
      success: Math.min(...runs.map((r) => r.success)),
      peakMiB: median(runs.map((r) => r.peakMiB)),
      avgCpu: median(runs.map((r) => r.avgCpu)),
    };
  }
  summary[t] = { meta, idleMiB: median(idle.map((x) => x.mib)), scenarios };
}

const first = summary[targets[0]].meta;
const allScenarios = [...new Set(targets.flatMap((t) => summary[t].meta.scenarios))];
const row = (cells) => `| ${cells.join(' | ')} |`;
const sep = (n) => row(Array(n).fill('---'));

const lines = [
  '# Identity server benchmark',
  '',
  `Host: ${first.host.cpus} vCPU${first.host.cpuModel ? ` (${first.host.cpuModel})` : ''}` +
    `${first.host.memBytes ? `, ${fmt(first.host.memBytes / 1024 ** 3, 1)} GiB RAM` : ''}. ` +
    `Server pinned to CPUs ${first.cpus.target} with a ${first.targetMem} memory limit, ` +
    `PostgreSQL 16 on ${first.cpus.db}, k6 on ${first.cpus.k6}. One stack at a time.`,
  `Load: ${first.vus} VUs, ${first.runs} × ${first.duration} per scenario after a ${first.warmup} warm-up; ` +
    'each figure is the median of the runs.',
  '',
  '## Footprint',
  '',
  row(['', 'Image', 'Image size', 'First boot', 'Restart', 'Idle RAM', 'Password hash as stored']),
  sep(7),
  ...targets.map((t) => {
    const { meta, idleMiB } = summary[t];
    return row([
      `**${t}**`,
      `\`${meta.image}\``,
      `${fmt(meta.imageBytes / 1024 ** 2)} MiB`,
      `${fmt(meta.firstBootMs / 1000, 1)} s`,
      `${fmt(meta.restartMs / 1000, 1)} s`,
      `${fmt(idleMiB)} MiB`,
      `\`${meta.passwordHash.replace(/\|/g, '\\|').slice(0, 160)}\``,
    ]);
  }),
  '',
  'First boot is container start to ready on an empty database (schema creation included); restart is the same on an existing one.',
  '',
  '## Throughput and latency',
  '',
  row(['Scenario', ...targets.map((t) => `${t} req/s`), ...targets.map((t) => `${t} p95 ms`)]),
  sep(1 + targets.length * 2),
  ...allScenarios.map((s) =>
    row([
      s,
      ...targets.map((t) => fmt(summary[t].scenarios[s]?.rps)),
      ...targets.map((t) => fmt(summary[t].scenarios[s]?.p95, 1)),
    ]),
  ),
  '',
  '## Under load',
  '',
  row(['Scenario', ...targets.map((t) => `${t} peak RAM`), ...targets.map((t) => `${t} CPU`), 'lowest success']),
  sep(2 + targets.length * 2),
  ...allScenarios.map((s) =>
    row([
      s,
      ...targets.map((t) => `${fmt(summary[t].scenarios[s]?.peakMiB)} MiB`),
      ...targets.map((t) => `${fmt(summary[t].scenarios[s]?.avgCpu)}%`),
      `${fmt(Math.min(...targets.map((t) => summary[t].scenarios[s]?.success ?? NaN)) * 100, 2)}%`,
    ]),
  ),
  '',
  'CPU is docker-stats percent of one core, averaged over the run. Images are referenced by digest in summary.json.',
];

const report = lines.join('\n') + '\n';
writeFileSync(join(dir, 'REPORT.md'), report);
writeFileSync(join(dir, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
if (failed) {
  console.error(`At least one measured run had a check success rate below ${MIN_SUCCESS * 100}%.`);
  process.exit(1);
}
