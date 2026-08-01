#!/usr/bin/env node
/**
 * Post-build script: restore the `node:` prefix for built-in modules
 * that esbuild strips during compilation of test files.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testDir = join(__dirname, '..', 'dist', 'tests');

// These are built-in module names that esbuild strips the `node:` prefix from.
const BARE_BUILTINS = [
  'test',
  'assert',
  'assert/strict',
  'fs',
  'path',
  'os',
  'readline',
  'module',
  'url',
  'crypto',
  'events',
  'stream',
  'util',
];

let patchedFiles = 0;
let patchedImports = 0;

for (const file of readdirSync(testDir)) {
  if (!file.endsWith('.js')) continue;
  const filePath = join(testDir, file);
  let src = readFileSync(filePath, 'utf-8');
  let changed = false;

  for (const mod of BARE_BUILTINS) {
    // Match: from "mod" or from 'mod'  (but NOT from "node:mod" already)
    const dq = new RegExp(`from "${mod}"`, 'g');
    const sq = new RegExp(`from '${mod}'`, 'g');
    if (dq.test(src)) {
      src = src.replace(dq, `from "node:${mod}"`);
      patchedImports++;
      changed = true;
    }
    if (sq.test(src)) {
      src = src.replace(sq, `from 'node:${mod}'`);
      patchedImports++;
      changed = true;
    }
  }

  if (changed) {
    writeFileSync(filePath, src, 'utf-8');
    patchedFiles++;
  }
}

console.log(`Patched ${patchedImports} import(s) in ${patchedFiles} file(s).`);
