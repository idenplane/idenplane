import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isStoredAdditionCollision } from './stored-ssti-collision.mjs';

const instance = {
  uri: 'http://zap-app:3000/admin/realms/zapapi/webhooks',
  param: 'eventTypes[0]',
  evidence: '',
  attack: 'zj{{11940|add:38450}}zj',
  otherinfo:
    'Proof found at [http://zap-app:3000/admin/realms/zapapi/export?includeSecrets=true]\ncontent:\n' +
    JSON.stringify({
      webhooks: [
        { eventTypes: ['zj{{11940|add:38450}}zj'] },
        { secret: 'zj{{86320|add:50390}}zj' },
      ],
    }),
};
test('recognizes only the stored unevaluated-probe collision', () => {
  assert.equal(isStoredAdditionCollision(instance), true);
});

for (const [name, suffix, status] of [
  ['accepts the proven collision', '', 0],
  ['fails an evaluated result', 'zj50390zj', 1],
]) {
  test(`the gate ${name}`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'zap-ssti-gate-'));
    try {
      writeFileSync(
        join(dir, 'api.json'),
        JSON.stringify({
          site: [
            {
              alerts: [
                {
                  pluginid: '90035',
                  alertRef: '90035',
                  alert: 'Server Side Template Injection',
                  riskcode: '3',
                  instances: [
                    {
                      ...instance,
                      method: 'POST',
                      otherinfo: instance.otherinfo + suffix,
                    },
                  ],
                },
              ],
            },
          ],
        }),
      );
      const result = spawnSync(
        process.execPath,
        [
          fileURLToPath(new URL('./gate.mjs', import.meta.url)),
          dir,
          fileURLToPath(new URL('../../../.zap/rules.tsv', import.meta.url)),
          'api',
        ],
        { encoding: 'utf8' },
      );
      assert.equal(result.status, status, result.stdout + result.stderr);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
for (const [name, changed] of [
  ['evaluated output', { otherinfo: instance.otherinfo + 'zj50390zj' }],
  ['bare evaluated output', { otherinfo: instance.otherinfo + '50390' }],
  ['missing proof', { otherinfo: '' }],
  ['another endpoint', { uri: instance.uri + '-other' }],
  ['another parameter', { param: 'description' }],
  [
    'another realm',
    {
      otherinfo: instance.otherinfo.replace('/zapapi/export', '/other/export'),
    },
  ],
  [
    'another origin',
    {
      otherinfo: instance.otherinfo.replace(
        'http://zap-app:3000',
        'http://other',
      ),
    },
  ],
  ['another probe syntax', { attack: '{{7*7}}' }],
  [
    'no original probe',
    { otherinfo: instance.otherinfo.replace(instance.attack, 'removed') },
  ],
  [
    'no alleged result',
    { otherinfo: instance.otherinfo.replace('50390', '12345') },
  ],
]) {
  test(`keeps ${name} open`, () =>
    assert.equal(
      isStoredAdditionCollision({ ...instance, ...changed }),
      false,
    ));
}
