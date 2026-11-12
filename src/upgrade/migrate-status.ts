import { execFile } from 'child_process';

/**
 * Runs `prisma migrate status` without blocking the event loop (the CLI
 * takes seconds to start). Resolves with its output when it exits 0, which
 * means nothing is pending; otherwise rejects with the error, its `stdout`
 * set to the output, which is how the CLI reports pending migrations.
 *
 * The CLI runs directly under this Node binary rather than through `npx`, so
 * aborting `signal` stops the process doing the work instead of leaving it
 * running behind a killed wrapper; shutdown aborts it for that reason.
 */
export function prismaMigrateStatus(signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [require.resolve('prisma/build/index.js'), 'migrate', 'status'],
      { encoding: 'utf-8', signal, env: { ...process.env, NO_COLOR: '1' } },
      (err, stdout, stderr) => {
        const output = stdout + stderr;
        if (err) {
          const failure: Error & { stdout?: unknown } = err;
          failure.stdout = output;
          reject(failure);
        } else {
          resolve(output);
        }
      },
    );
  });
}
