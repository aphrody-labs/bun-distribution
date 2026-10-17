/**
 * Counting semaphore with direct hand-off: at most `limit` tasks run at once,
 * FIFO, no slot is ever skipped. Zero dependencies.
 */
export function limiter(limit: number): <T>(task: () => Promise<T>) => Promise<T> {
  const max = Math.max(1, Math.floor(limit));
  let active = 0;
  const waiting: (() => void)[] = [];

  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= max) {
      await new Promise<void>(resolve => waiting.push(resolve));
    } else {
      active++;
    }
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next !== undefined) {
        next();
      } else {
        active--;
      }
    }
  };
}
