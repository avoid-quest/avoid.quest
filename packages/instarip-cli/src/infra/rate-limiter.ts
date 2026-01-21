import { now } from "@avoid.quest/shared";

const MS_PER_SECOND = 1000;
const MIN_WAIT_MS = 5;

export class TokenBucketLimiter {
  private readonly capacity: number;
  private readonly refillPerSec: number;
  private tokens: number;
  private lastRefillMs: number;

  constructor(capacity: number, refillPerSec: number) {
    this.capacity = capacity;
    this.refillPerSec = refillPerSec;
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

  async removeTokens(n: number): Promise<void> {
    while (true) {
      this.refill();
      if (this.tokens >= n) {
        this.tokens -= n;
        return;
      }
      const need = n - this.tokens;
      const waitMs = Math.max(
        MIN_WAIT_MS,
        Math.ceil((need / this.refillPerSec) * MS_PER_SECOND)
      );
      await Bun.sleep(waitMs);
    }
  }
}
