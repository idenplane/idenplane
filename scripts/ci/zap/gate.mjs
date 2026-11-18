// Decides whether a ZAP run passes, and prints a Markdown summary.
//
//   node gate.mjs <reports dir> <rules.tsv> <report names...>
//
// ZAP's own rules file is keyed by plugin id, which is too coarse here: one
// plugin (10055 CSP, 90004 cross-origin headers, 100000 status codes) raises
// several different alerts, and accepting one of them for the whole plugin
// would let a future, real one (say, CSP 'unsafe-eval') through unseen. So
// the verdict is made here, per alert:
//
//   <id>\tIGNORE\t<name>          (ZAP syntax) the whole plugin is ignored
//   <id>\tOUTOFSCOPE\t<url regex> (ZAP syntax) the plugin, on matching URLs
//   #@accept\t<alertRef>\t<url regex>\t<reason>\t[exact evidence]
//                                 one alert on matching URLs and optional evidence
//
// Every other alert, of any risk level, fails the run. Every accept and
// ignore must say why, in rules.tsv, where it is reviewed.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isStoredAdditionCollision } from './stored-ssti-collision.mjs';

const [dir, rulesFile, ...reports] = process.argv.slice(2);
const ignore = new Set();
const outOfScope = [];
const accepts = [];
for (const raw of readFileSync(rulesFile, 'utf8').split('\n')) {
  const line = raw.replace(/\r$/, '');
  if (line.startsWith('#@accept\t')) {
    const [, ref, url, reason, evidence] = line.split('\t');
    if (!reason || reason.trim().length < 10)
      throw new Error(`accept without a reason: ${line}`);
    accepts.push({ ref, url: new RegExp(url), reason, evidence });
    continue;
  }
  if (!line.trim() || line.startsWith('#')) continue;
  const [id, level, rest] = line.split('\t');
  if (level === 'IGNORE') ignore.add(id);
  if (level === 'OUTOFSCOPE') outOfScope.push({ id, url: new RegExp(rest) });
}

const risk = { 3: 'High', 2: 'Medium', 1: 'Low', 0: 'Info' };
const out = ['## OWASP ZAP', ''];
const failures = [];
const accepted = new Map();
for (const name of reports) {
  const file = join(dir, `${name}.json`);
  if (!existsSync(file)) {
    failures.push(`${name}: no report (the scan did not complete)`);
    continue;
  }
  const report = JSON.parse(readFileSync(file, 'utf8'));
  const alerts = (report.site ?? []).flatMap((s) => s.alerts ?? []);
  const open = [];
  for (const a of alerts) {
    if (ignore.has(a.pluginid)) continue;
    const ref = a.alertRef ?? a.pluginid;
    const remaining = (a.instances ?? []).filter((i) => {
      if (outOfScope.some((o) => o.id === a.pluginid && o.url.test(i.uri)))
        return false;
      const acc = accepts.find(
        (x) =>
          x.ref === ref &&
          x.url.test(i.uri) &&
          (x.evidence === '@stored-addition-collision'
            ? ref === '90035' && isStoredAdditionCollision(i)
            : x.evidence === undefined ||
              (x.evidence !== '' && x.evidence === i.evidence)),
      );
      if (acc) {
        accepted.set(ref, {
          alert: a.alert,
          reason: acc.reason,
          n: (accepted.get(ref)?.n ?? 0) + 1,
        });
        return false;
      }
      return true;
    });
    if (remaining.length) open.push({ ...a, ref, remaining });
  }
  out.push(
    `### ${name}: ${open.length ? `**${open.length} open alert(s)**` : 'no open alerts'} (${alerts.length} raised)`,
    '',
  );
  if (open.length) {
    out.push(
      '| Risk | Alert | Ref | Instances | Example |',
      '|---|---|---|---|---|',
    );
    for (const a of open.sort(
      (x, y) => Number(y.riskcode) - Number(x.riskcode),
    )) {
      const ex = a.remaining[0];
      out.push(
        `| ${risk[a.riskcode] ?? a.riskcode} | ${a.alert} | ${a.ref} | ${a.remaining.length} | ${`${ex.method} ${ex.uri}`.replace(/\|/g, '%7C').slice(0, 140)} |`,
      );
      failures.push(`${name}: ${a.ref} ${a.alert}`);
    }
    out.push('');
  }
}
if (accepted.size) {
  out.push(
    '### Accepted (see .zap/rules.tsv)',
    '',
    '| Ref | Alert | Instances | Why |',
    '|---|---|---|---|',
  );
  for (const [ref, v] of accepted)
    out.push(`| ${ref} | ${v.alert} | ${v.n} | ${v.reason} |`);
  out.push('');
}
out.push(
  failures.length
    ? `**ZAP gate: FAILED** (${failures.length})`
    : '**ZAP gate: passed**',
);
console.log(out.join('\n'));
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
