#!/usr/bin/env node
// Fails the build when the authentication modules form an import cycle.
//
// Builds the graph of relative *runtime* imports between the files under
// src/ (specs excluded) and finds its strongly connected components with
// Tarjan's algorithm. Each file is transpiled to CommonJS exactly as the
// build does, so `import type`, `export type` and imports only used as types
// are dropped the same way tsc drops them, while constructor parameter types
// (kept by emitDecoratorMetadata for Nest's DI) still count. Dynamic
// `import()` is lazy and is not an edge.
//
// Exit code 1 when an SCC of more than one file contains a file in one of
// the GUARDED directories, or when `forwardRef(` appears in one of them.
// Cycles elsewhere in src/ are printed as warnings only.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const GUARDED = [
  'login',
  'oauth',
  'step-up',
  'webauthn',
  'mfa',
  'auth-flow',
  'authn-core',
];

function listSources(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listSources(full));
    else if (
      name.endsWith('.ts') &&
      !name.endsWith('.spec.ts') &&
      !name.endsWith('.d.ts')
    )
      out.push(full);
  }
  return out;
}

const COMPILER_OPTIONS = {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2023,
  experimentalDecorators: true,
  emitDecoratorMetadata: true,
  esModuleInterop: true,
  isolatedModules: true,
};

// Top-level requires only: an `import()` compiles to a require nested in an
// expression, never at the start of a line.
const TOP_LEVEL_REQUIRE =
  /^(?:(?:const|let|var) [\w$]+ = (?:__importDefault\(|__importStar\()?|__exportStar\()?require\("([^"]+)"\)/gm;

function resolveImport(fromFile, spec) {
  const base = resolve(dirname(fromFile), spec);
  const candidates = [
    base.replace(/\.js$/, '.ts'),
    base,
    `${base}.ts`,
    join(base.replace(/\.js$/, ''), 'index.ts'),
  ];
  return candidates.find((c) => c.endsWith('.ts') && existsSync(c)) ?? null;
}

const files = listSources(SRC);
const graph = new Map();
for (const file of files) {
  const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: COMPILER_OPTIONS,
    fileName: file,
  });
  const deps = new Set();
  for (const [, spec] of outputText.matchAll(TOP_LEVEL_REQUIRE)) {
    if (!spec.startsWith('.')) continue;
    const target = resolveImport(file, spec);
    if (target) deps.add(target);
  }
  graph.set(file, deps);
}

// Tarjan's SCC, iterative so deep import chains cannot overflow the stack.
function stronglyConnected(nodes) {
  let index = 0;
  const idx = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const sccs = [];
  for (const root of nodes) {
    if (idx.has(root)) continue;
    const work = [[root, [...(graph.get(root) ?? [])], 0]];
    idx.set(root, index);
    low.set(root, index++);
    stack.push(root);
    onStack.add(root);
    while (work.length) {
      const frame = work[work.length - 1];
      const [node, edges] = frame;
      if (frame[2] < edges.length) {
        const next = edges[frame[2]++];
        if (!idx.has(next)) {
          idx.set(next, index);
          low.set(next, index++);
          stack.push(next);
          onStack.add(next);
          work.push([next, [...(graph.get(next) ?? [])], 0]);
        } else if (onStack.has(next)) {
          low.set(node, Math.min(low.get(node), idx.get(next)));
        }
        continue;
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1][0];
        low.set(parent, Math.min(low.get(parent), low.get(node)));
      }
      if (low.get(node) === idx.get(node)) {
        const scc = [];
        let member;
        do {
          member = stack.pop();
          onStack.delete(member);
          scc.push(member);
        } while (member !== node);
        sccs.push(scc);
      }
    }
  }
  return sccs;
}

const rel = (f) => relative(ROOT, f).split(sep).join('/');
const isGuarded = (f) => GUARDED.some((d) => rel(f).startsWith(`src/${d}/`));

const cycles = stronglyConnected(files).filter((scc) => scc.length > 1);
const guarded = cycles.filter((scc) => scc.some(isGuarded));
const other = cycles.filter((scc) => !scc.some(isGuarded));

function printScc(scc) {
  for (const f of scc.map(rel).sort()) console.log(`    ${f}`);
}

for (const scc of other) {
  console.warn(`warning: import cycle of ${scc.length} files (not guarded):`);
  printScc(scc);
}
for (const scc of guarded) {
  console.error(`error: import cycle of ${scc.length} files:`);
  printScc(scc);
}

const forwardRefs = [];
for (const file of files.filter(isGuarded)) {
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (line.includes('forwardRef('))
        forwardRefs.push(`${rel(file)}:${i + 1}`);
    });
}
for (const at of forwardRefs) console.error(`error: forwardRef( in ${at}`);

console.log(
  `${files.length} files, ${cycles.length} cycle(s): ${guarded.length} in guarded modules, ${other.length} elsewhere; ${forwardRefs.length} forwardRef(s) in guarded modules`,
);
process.exit(guarded.length || forwardRefs.length ? 1 : 0);
