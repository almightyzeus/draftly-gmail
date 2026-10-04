import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from '../src/utils/concurrency.js';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('mapWithConcurrency', () => {
  it('preserves input order even when later items finish first', async () => {
    const result = await mapWithConcurrency([30, 5, 20, 1], 4, async (ms, i) => {
      await delay(ms);
      return i;
    });
    expect(result).toEqual([0, 1, 2, 3]);
  });

  it('never runs more than the limit at once, and runs them in parallel', async () => {
    let inFlight = 0;
    let peak = 0;
    const started = Date.now();

    await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 5, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await delay(20);
      inFlight--;
    });

    expect(peak).toBe(5);
    // 20 tasks of 20 ms at 5 at a time ≈ 80 ms; sequentially it would be 400 ms.
    expect(Date.now() - started).toBeLessThan(300);
  });

  it('handles empty input and limits larger than the input', async () => {
    await expect(mapWithConcurrency([], 10, async () => 1)).resolves.toEqual([]);
    await expect(mapWithConcurrency([1, 2], 10, async (n) => n * 2)).resolves.toEqual([2, 4]);
  });
});
