import { describe, expect, it, vi } from 'vitest';
import { parseRetryAfter, withRetry } from '../src/utils/retry.js';

const transient = new Error('transient');
const fatal = new Error('fatal');

const options = (overrides: Record<string, any> = {}) => ({
  attempts: 4,
  baseDelayMs: 100,
  maxDelayMs: 1_000,
  shouldRetry: (error: unknown) => error === transient,
  sleep: vi.fn().mockResolvedValue(undefined),
  random: () => 1, // no jitter: the upper bound of each delay
  ...overrides,
});

describe('withRetry', () => {
  it('returns the first success without waiting', async () => {
    const opts = options();
    await expect(withRetry(async () => 'ok', opts)).resolves.toBe('ok');
    expect(opts.sleep).not.toHaveBeenCalled();
  });

  it('retries transient failures with doubling delays, capped at maxDelayMs', async () => {
    const fn = vi.fn().mockRejectedValueOnce(transient).mockRejectedValueOnce(transient).mockRejectedValueOnce(transient).mockResolvedValue('ok');
    const opts = options({ baseDelayMs: 400 });

    await expect(withRetry(fn, opts)).resolves.toBe('ok');

    expect(fn).toHaveBeenCalledTimes(4);
    expect(opts.sleep.mock.calls.map(([ms]: [number]) => ms)).toEqual([400, 800, 1_000]);
  });

  it('applies jitter between 50% and 100% of the backoff', async () => {
    const fn = vi.fn().mockRejectedValueOnce(transient).mockResolvedValue('ok');
    const opts = options({ random: () => 0 });

    await withRetry(fn, opts);

    expect(opts.sleep).toHaveBeenCalledWith(50);
  });

  it('throws the last error once attempts run out', async () => {
    const fn = vi.fn().mockRejectedValue(transient);
    const onRetry = vi.fn();

    await expect(withRetry(fn, options({ attempts: 3, onRetry }))).rejects.toBe(transient);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry.mock.calls.map(([, attempt, delay]) => [attempt, delay])).toEqual([[1, 100], [2, 200]]);
  });

  it('does not retry errors that are not retryable', async () => {
    const fn = vi.fn().mockRejectedValue(fatal);
    await expect(withRetry(fn, options())).rejects.toBe(fatal);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('waits as long as the server asks, unless that exceeds maxDelayMs', async () => {
    const fn = vi.fn().mockRejectedValueOnce(transient).mockResolvedValue('ok');
    const opts = options({ retryAfterMs: () => 700 });
    await withRetry(fn, opts);
    expect(opts.sleep).toHaveBeenCalledWith(700);

    const tooLong = vi.fn().mockRejectedValue(transient);
    const longOpts = options({ retryAfterMs: () => 5_000 });
    await expect(withRetry(tooLong, longOpts)).rejects.toBe(transient);
    expect(tooLong).toHaveBeenCalledTimes(1);
    expect(longOpts.sleep).not.toHaveBeenCalled();
  });
});

describe('parseRetryAfter', () => {
  it('reads seconds and HTTP dates', () => {
    expect(parseRetryAfter('3')).toBe(3_000);
    expect(parseRetryAfter(1.5)).toBe(1_500);
    const now = Date.parse('2026-11-03T10:00:00Z');
    expect(parseRetryAfter('Tue, 03 Nov 2026 10:00:05 GMT', now)).toBe(5_000);
    expect(parseRetryAfter('Tue, 03 Nov 2026 09:00:00 GMT', now)).toBe(0);
  });

  it('ignores missing or malformed values', () => {
    expect(parseRetryAfter(undefined)).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('soon')).toBeUndefined();
  });
});
