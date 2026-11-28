import { prismaMigrateStatus } from './migrate-status.js';

describe('prismaMigrateStatus', () => {
  it('stops the CLI when the signal is aborted', async () => {
    const controller = new AbortController();
    const status = prismaMigrateStatus(controller.signal);
    controller.abort();

    // An AbortError means the run was ended by the signal: a CLI left to
    // finish would resolve, or reject with its exit code. There is no bound
    // on the time it takes, because a loaded CI runner needs seconds just
    // to start and reap the process (3.2 s was seen on macOS).
    await expect(status).rejects.toMatchObject({ name: 'AbortError' });
  });
});
