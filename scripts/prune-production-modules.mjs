#!/usr/bin/env node
// Trims a production `npm ci --omit=dev` install for the container image.
// Run from the app directory, in the same layer as the install:
//
//   node scripts/prune-production-modules.mjs
//
// It removes only what the server can never load:
//
// 1. Any package not reachable from package.json through dependencies,
//    optional dependencies and required peer dependencies. npm installs
//    optional peers too (TypeScript, for one); every package that declares
//    one works without it. (The Prisma CLI stays whole: it loads Studio and
//    its local-dev database as soon as it starts, and the server runs it
//    for `migrate deploy`, `migrate status` and upgrades.)
// 2. Prisma's query compilers for databases other than PostgreSQL, the
//    only database the image runs against, and source maps.
//
// It prints what it removed and how much, and fails (non-zero) if the
// result does not resolve: every kept package must still find what it
// depends on.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const NM = path.join(ROOT, 'node_modules');
const OTHER_PROVIDERS = /query_compiler_[a-z]+_bg\.(mysql|sqlite|sqlserver|cockroachdb)\./;

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

function sizeOf(p) {
  const st = fs.lstatSync(p);
  if (!st.isDirectory()) return st.size;
  let total = 0;
  for (const e of fs.readdirSync(p)) total += sizeOf(path.join(p, e));
  return total;
}

/** Every installed package directory, at any nesting depth. */
function packageDirs(nm) {
  const out = [];
  if (!fs.existsSync(nm)) return out;
  for (const e of fs.readdirSync(nm)) {
    if (e.startsWith('.')) continue;
    const p = path.join(nm, e);
    if (e.startsWith('@')) {
      for (const s of fs.readdirSync(p)) out.push(path.join(p, s));
    } else {
      out.push(p);
    }
  }
  for (const dir of [...out]) out.push(...packageDirs(path.join(dir, 'node_modules')));
  return out.filter((d) => fs.existsSync(path.join(d, 'package.json')));
}

/** Node's resolution: the nearest node_modules/<name> walking up from `from`. */
function resolveFrom(from, name) {
  let dir = from;
  for (;;) {
    const candidate = path.join(dir, 'node_modules', name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
    if (dir === ROOT) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function requiredDeps(pkg) {
  const optionalPeers = new Set(
    Object.entries(pkg.peerDependenciesMeta ?? {})
      .filter(([, m]) => m?.optional)
      .map(([n]) => n),
  );
  return {
    must: [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}).filter((n) => !optionalPeers.has(n)),
    ],
    may: Object.keys(pkg.optionalDependencies ?? {}),
  };
}

/** The packages reachable from the app, and any required one that is missing. */
function walk() {
  const reachable = new Set();
  const missing = [];
  const queue = [[ROOT, readJson(path.join(ROOT, 'package.json'))]];
  while (queue.length) {
    const [dir, pkg] = queue.pop();
    const { must, may } = requiredDeps(pkg);
    for (const [name, required] of [
      ...must.map((n) => [n, true]),
      ...may.map((n) => [n, false]),
    ]) {
      const found = resolveFrom(dir, name);
      if (!found) {
        if (required) missing.push(`${pkg.name ?? 'app'} -> ${name}`);
        continue;
      }
      if (reachable.has(found)) continue;
      reachable.add(found);
      queue.push([found, readJson(path.join(found, 'package.json'))]);
    }
  }
  return { reachable, missing };
}

let freed = 0;
const remove = (p, label) => {
  const bytes = sizeOf(p);
  fs.rmSync(p, { recursive: true, force: true });
  freed += bytes;
  if (label) console.log(`  - ${label} (${(bytes / 1e6).toFixed(1)} MB)`);
};

const before = sizeOf(NM);
const { reachable } = walk();
console.log('Unreachable packages:');
// Deepest first, so a nested package is not counted twice.
for (const dir of packageDirs(NM).sort((a, b) => b.length - a.length)) {
  if (!reachable.has(dir) && fs.existsSync(dir)) {
    remove(dir, path.relative(NM, dir).replaceAll(path.sep, '/'));
  }
}

let compilers = 0;
let maps = 0;
(function sweep(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sweep(p);
    else if (OTHER_PROVIDERS.test(e.name)) (compilers += sizeOf(p)), remove(p);
    else if (e.name.endsWith('.map')) (maps += sizeOf(p)), remove(p);
  }
})(NM);
console.log(`Query compilers for other databases: ${(compilers / 1e6).toFixed(1)} MB`);
console.log(`Source maps: ${(maps / 1e6).toFixed(1)} MB`);
console.log(
  `node_modules: ${(before / 1e6).toFixed(0)} MB -> ${((before - freed) / 1e6).toFixed(0)} MB`,
);

const { missing } = walk();
if (missing.length) {
  console.error('Unresolved after pruning:\n  ' + missing.join('\n  '));
  process.exit(1);
}
