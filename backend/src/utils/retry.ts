export interface RetryOptions {
  /** Total attempts, including the first one. */
  attempts: number;
  /** Delay before the first retry; doubles for each further retry. */
  baseDelayMs: number;
  /** Upper bound for one delay. A server-requested wait above it is not honoured: the error is thrown. */
  maxDelayMs: number;
  /** Whether this error is worth another attempt. */
  shouldRetry: (error: unknown) => boolean;
  /** Server-requested wait (e.g. from a Retry-After header), if any. */
  retryAfterMs?: (error: unknown) => number | undefined;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn`, retrying transient failures with exponential backoff and jitter
 * (each delay is 50–100% of base × 2^(retry − 1), capped at maxDelayMs). A
 * Retry-After from the server replaces the computed delay. The last error is
 * thrown unchanged once attempts run out or the error is not retryable.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= options.attempts || !options.shouldRetry(error)) {
        throw error;
      }

      const requested = options.retryAfterMs?.(error);
      if (requested !== undefined && requested > options.maxDelayMs) {
        throw error; // The server asks for a longer wait than a request should block.
      }
      const backoff = Math.min(options.maxDelayMs, options.baseDelayMs * 2 ** (attempt - 1));
      const delayMs = requested ?? Math.round(backoff * (0.5 + random() / 2));

      options.onRetry?.(error, attempt, delayMs);
      await sleep(delayMs);
    }
  }
}

/** Parse a Retry-After header value (seconds or an HTTP date) into milliseconds. */
export function parseRetryAfter(value: unknown, now: number = Date.now()): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return undefined;
  }
  const text = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(text)) {
    return Math.round(Number(text) * 1000);
  }
  const date = Date.parse(text);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}
