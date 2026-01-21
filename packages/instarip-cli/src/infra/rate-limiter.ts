import { now } from "@avoid.quest/shared";

const MS_PER_SECOND = 1000;
const MIN_WAIT_MS = 5;

export class RateLimiterTimeoutError extends Error {
  constructor(timeoutMs: number, requestedTokens: number) {
    super(
      `Rate limiter timed out after ${timeoutMs}ms waiting for ${requestedTokens} tokens`
    );
    this.name = "RateLimiterTimeoutError";
  }
}

export class TokenBucketLimiter {
  private readonly capacity: number;
  private readonly refillPerSec: number;
  private readonly timeoutMs: number | undefined;
  private tokens: number;
  private lastRefillMs: number;

  /**
   * Create a token bucket rate limiter
   * @param capacity Maximum number of tokens in the bucket
   * @param refillPerSec Number of tokens added per second
   * @param timeoutMs Optional timeout in ms - throws RateLimiterTimeoutError if exceeded
   */
  constructor(capacity: number, refillPerSec: number, timeoutMs?: number) {
    this.capacity = capacity;
    this.refillPerSec = refillPerSec;
    this.timeoutMs = timeoutMs;
    this.tokens = capacity;
    this.lastRefillMs = now();
  }

  private refill(): void {
    const currentTime = now();
    const elapsedSec = (currentTime - this.lastRefillMs) / MS_PER_SECOND;
    if (elapsedSec <= 0) {
      return;
    }
    const add = elapsedSec * this.refillPerSec;
    this.tokens = Math.min(this.capacity, this.tokens + add);
    this.lastRefillMs = currentTime;
  }

  /**
   * Wait until n tokens are available and consume them
   * @throws RateLimiterTimeoutError if timeout is configured and exceeded
   */
  async removeTokens(n: number): Promise<void> {
    const startTime = now();

    while (true) {
      this.refill();
      if (this.tokens >= n) {
        this.tokens -= n;
        return;
      }

      // Check timeout before waiting
      if (this.timeoutMs !== undefined) {
        const elapsed = now() - startTime;
        if (elapsed >= this.timeoutMs) {
          throw new RateLimiterTimeoutError(this.timeoutMs, n);
        }
      }

      const need = n - this.tokens;
      let waitMs = Math.max(
        MIN_WAIT_MS,
        Math.ceil((need / this.refillPerSec) * MS_PER_SECOND)
      );

      // Cap wait time to remaining timeout if configured
      if (this.timeoutMs !== undefined) {
        const elapsed = now() - startTime;
        const remaining = this.timeoutMs - elapsed;
        waitMs = Math.min(waitMs, Math.max(MIN_WAIT_MS, remaining));
      }

      await Bun.sleep(waitMs);
    }
  }
}
