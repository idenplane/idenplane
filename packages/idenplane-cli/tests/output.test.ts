import { test } from 'node:test';
import assert from 'node:assert/strict';
import { printResult } from '../src/output.js';

// Capture console output for assertions
function capture(fn: () => void): string {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...args: unknown[]) => lines.push(args.map(String).join(' '));
  try {
    fn();
  } finally {
    console.log = orig;
  }
  return lines.join('\n');
}

test('printResult: outputs JSON when --json flag is set', () => {
  const data = { id: '1', name: 'test' };
  const out = capture(() => printResult(data, { json: true }));
  assert.deepEqual(JSON.parse(out), data);
});

test('printResult: outputs JSON array when --json flag is set', () => {
  const data = [{ id: '1' }, { id: '2' }];
  const out = capture(() => printResult(data, { json: true }));
  assert.deepEqual(JSON.parse(out), data);
});

test('printResult: outputs key-value pairs for objects', () => {
  const data = { id: '1', name: 'test-realm', enabled: true };
  const out = capture(() => printResult(data, {}));
  assert.ok(out.includes('id'));
  assert.ok(out.includes('name'));
  assert.ok(out.includes('test-realm'));
  assert.ok(out.includes('enabled'));
});

test('printResult: outputs table for arrays', () => {
  const data = [
    { id: '1', name: 'alice', enabled: 'true' },
    { id: '2', name: 'bob', enabled: 'false' },
  ];
  const out = capture(() => printResult(data, {}));
  assert.ok(out.includes('alice'));
  assert.ok(out.includes('bob'));
  // Headers should be uppercased
  assert.ok(out.includes('ID') || out.includes('NAME'));
});

test('printResult: shows "No results." for empty array', () => {
  const out = capture(() => printResult([], {}));
  assert.ok(out.includes('No results.'));
});

test('printResult: handles scalar string value', () => {
  const out = capture(() => printResult('hello', {}));
  assert.ok(out.includes('hello'));
});
