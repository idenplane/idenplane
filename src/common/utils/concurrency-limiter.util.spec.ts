import { createConcurrencyLimiter } from './concurrency-limiter.util.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('createConcurrencyLimiter', () => {
  it('should throw when concurrency is less than 1', () => {
    expect(() => createConcurrencyLimiter(0)).toThrow(
      'concurrency must be at least 1',
    );
    expect(() => createConcurrencyLimiter(-1)).toThrow();
  });

  it('should run a single task and resolve with its result', async () => {
    const limit = createConcurrencyLimiter(2);
    const result = await limit(() => Promise.resolve('done'));
    expect(result).toBe('done');
  });

  it('should propagate a rejected task', async () => {
    const limit = createConcurrencyLimiter(2);
    await expect(
      limit(() => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
  });

  it('should never run more than `concurrency` tasks at once', async () => {
    const limit = createConcurrencyLimiter(2);
    let active = 0;
    let maxActive = 0;
    const gates = Array.from({ length: 5 }, () => deferred<void>());

    const runs = gates.map((gate, i) =>
      limit(async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await gate.promise;
        active--;
        return i;
      }),
    );

    // Let the first batch start.
    await Promise.resolve();
    await Promise.resolve();
    expect(active).toBe(2);
    expect(maxActive).toBe(2);

    // Release tasks one at a time; active count should never exceed 2.
    for (const gate of gates) {
      gate.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(active).toBeLessThanOrEqual(2);
    }

    const results = await Promise.all(runs);
    expect(results).toEqual([0, 1, 2, 3, 4]);
    expect(maxActive).toBe(2);
  });

  it('should still run a queued task after an earlier task rejects', async () => {
    const limit = createConcurrencyLimiter(1);

    const first = limit(() => Promise.reject(new Error('first failed')));
    const second = limit(() => Promise.resolve('second succeeded'));

    await expect(first).rejects.toThrow('first failed');
    await expect(second).resolves.toBe('second succeeded');
  });
});
