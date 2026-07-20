/**
 * Map over `items` running at most `limit` calls of `fn` concurrently, preserving input order in the
 * result. Used to bound fan-out that would otherwise fire one in-flight LLM request per item (e.g.
 * one `processWithLLM` per package), which can blow past provider rate limits on large monorepos.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const bound = Math.max(1, Math.floor(limit) || 1);
  const results: R[] = new Array(items.length);
  let next = 0;
  let failed = false;

  async function worker(): Promise<void> {
    // Stop pulling new items once any worker's fn has thrown, so a throwing fn doesn't keep starting
    // fresh work after the first failure (in-flight calls still settle; Promise.all surfaces the error).
    while (!failed) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = await fn(items[i] as T, i);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  }

  const workers = Array.from({ length: Math.min(bound, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
