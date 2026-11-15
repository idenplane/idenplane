import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deployThenVerify } from '../src/commands/upgrade.js';

function recordingSteps(overrides: {
  deploy?: () => void;
  verify?: () => Promise<void>;
}) {
  const calls: string[] = [];
  const errors: { recovered?: unknown; verifyFailed?: unknown } = {};
  return {
    calls,
    errors,
    steps: {
      deploy: () => {
        calls.push('deploy');
        overrides.deploy?.();
      },
      verify: async () => {
        calls.push('verify');
        await overrides.verify?.();
      },
      recover: async (error: unknown) => {
        calls.push('recover');
        errors.recovered = error;
      },
      verifyFailed: (error: unknown) => {
        calls.push('verifyFailed');
        errors.verifyFailed = error;
      },
    },
  };
}

test('deployThenVerify: a successful deploy runs the post-upgrade checks and never recovers', async () => {
  const { calls, steps } = recordingSteps({});
  assert.equal(await deployThenVerify(steps), 'applied');
  assert.deepEqual(calls, ['deploy', 'verify']);
});

test('deployThenVerify: a failed deploy restores the backup and skips the post-upgrade checks', async () => {
  const deployError = new Error('sample migrate deploy failure');
  const { calls, errors, steps } = recordingSteps({
    deploy: () => {
      throw deployError;
    },
  });
  assert.equal(await deployThenVerify(steps), 'deploy-failed');
  assert.deepEqual(calls, ['deploy', 'recover']);
  assert.equal(errors.recovered, deployError);
});

test('deployThenVerify: a failure after the migrations are applied never restores the backup', async () => {
  // e.g. a health response of an unexpected shape making the report throw
  const verifyError = new TypeError('sample health report failure');
  const { calls, errors, steps } = recordingSteps({
    verify: async () => {
      throw verifyError;
    },
  });
  assert.equal(await deployThenVerify(steps), 'applied');
  assert.deepEqual(calls, ['deploy', 'verify', 'verifyFailed']);
  assert.equal(errors.verifyFailed, verifyError);
});
