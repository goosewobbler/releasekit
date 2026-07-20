import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from '../../../src/utils/concurrency.js';

describe('mapWithConcurrency()', () => {
  it('should preserve input order in the results', async () => {
    const result = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => n * 10);
    expect(result).toEqual([10, 20, 30, 40, 50]);
  });

  it('should never exceed the concurrency limit of in-flight calls', async () => {
    let active = 0;
    let peak = 0;
    const items = Array.from({ length: 12 }, (_, i) => i);

    await mapWithConcurrency(items, 3, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 1));
      active--;
      return n;
    });

    expect(peak).toBeLessThanOrEqual(3);
  });

  it('should return an empty array for empty input without invoking the mapper', async () => {
    let called = false;
    const result = await mapWithConcurrency([], 5, async () => {
      called = true;
      return 0;
    });
    expect(result).toEqual([]);
    expect(called).toBe(false);
  });

  it('should treat a non-positive limit as a single worker', async () => {
    let active = 0;
    let peak = 0;
    await mapWithConcurrency([1, 2, 3], 0, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 1));
      active--;
      return n;
    });
    expect(peak).toBe(1);
  });

  it('should stop scheduling new work after the mapper throws', async () => {
    const seen: number[] = [];
    await expect(
      mapWithConcurrency([0, 1, 2], 1, async (n) => {
        seen.push(n);
        if (n === 1) throw new Error('boom');
        return n;
      }),
    ).rejects.toThrow('boom');
    expect(seen).toEqual([0, 1]); // index 2 is never started once the failure is observed
  });
});
