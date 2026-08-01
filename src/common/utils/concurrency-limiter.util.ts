/**
 * Caps the number of `fn` calls running at once, queueing the rest until a
 * slot frees up. Used to bound CPU/memory-heavy work (e.g. Argon2 hashing)
 * so a burst of concurrent requests can't drive unbounded resource pressure.
 */
export function createConcurrencyLimiter(concurrency: number) {
  if (concurrency < 1) {
    throw new Error('concurrency must be at least 1');
  }

  let active = 0;
  const queue: Array<() => void> = [];

  function next(): void {
    if (active >= concurrency || queue.length === 0) return;
    active++;
    const run = queue.shift()!;
    run();
  }

  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      });
      next();
    });
  };
}
