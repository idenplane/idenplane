import { prismaMigrateStatus } from './migrate-status.js';

describe('prismaMigrateStatus', () => {
  it('stops the CLI when the signal is aborted', async () => {
    const controller = new AbortController();
    const started = Date.now();
    const status = prismaMigrateStatus(controller.signal);
    controller.abort();

    await expect(status).rejects.toMatchObject({ name: 'AbortError' });
    // The CLI takes seconds to start, so an aborted check ends long before it.
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
