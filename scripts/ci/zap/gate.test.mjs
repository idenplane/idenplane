import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const gate = fileURLToPath(new URL('./gate.mjs', import.meta.url));
const rules = fileURLToPath(
  new URL('../../../.zap/rules.tsv', import.meta.url),
);

for (const [name, uri, evidence, expected] of [
  ['expected SMTP upstream failure', '/setup-wizard/smtp/test', '502', 0],
  ['SMTP internal error', '/setup-wizard/smtp/test', '500', 1],
  ['SMTP unavailable error', '/setup-wizard/smtp/test', '503', 1],
  ['missing status evidence', '/setup-wizard/smtp/test', undefined, 1],
  ['another endpoint', '/setup-wizard/smtp/test-other', '502', 1],
  ['trailing slash and query', '/setup-wizard/smtp/test/?x=1', '502', 0],
]) {
  test(name, () => {
    const dir = mkdtempSync(join(tmpdir(), 'zap-gate-'));
    try {
      writeFileSync(
        join(dir, 'api.json'),
        JSON.stringify({
          site: [
            {
              alerts: [
                {
                  pluginid: '100000',
                  alertRef: '100000-2',
                  alert: 'Server error',
                  riskcode: '1',
                  instances: [
                    {
                      uri: `http://zap-app:3000${uri}`,
                      method: 'POST',
                      evidence,
                    },
                  ],
                },
              ],
            },
          ],
        }),
      );
      const result = spawnSync(process.execPath, [gate, dir, rules, 'api'], {
        encoding: 'utf8',
      });
      assert.equal(result.status, expected, result.stdout + result.stderr);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
