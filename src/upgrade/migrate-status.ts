import { exec } from 'child_process';

/**
 * Runs `prisma migrate status` without blocking the event loop (the CLI
 * takes seconds to start). Resolves with its output when it exits 0, which
 * means nothing is pending; otherwise rejects with the error, its `stdout`
 * set to the output, which is how the CLI reports pending migrations.
 */
export function prismaMigrateStatus(): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(
      'npx prisma migrate status 2>&1',
      { encoding: 'utf-8' },
      (err, stdout) => {
        if (err) reject(Object.assign(err as Error, { stdout }));
        else resolve(stdout);
      },
    );
  });
}
