export const MAX_RECONNECT_DELAY_MS = 30_000;

export function reconnectDelayMs(attempt: number): number {
  if (attempt <= 0) {
    return 0;
  }
  return Math.min(
    1000 * 2 ** Math.min(attempt - 1, 10),
    MAX_RECONNECT_DELAY_MS
  );
}

/** Owns the one timer and recovery epoch shared by watchdog and retry phases. */
export class MediaRecoveryController {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retryAttempt = 0;
  private stalledSince: number | null = null;
  private _error: Error | null = null;

  get error(): Error | null {
    return this._error;
  }

  get hasTimer(): boolean {
    return this.timer !== null;
  }

  noteStall(error: Error, now = Date.now()): void {
    this._error = error;
    this.stalledSince ??= now;
  }

  stalledDuration(now = Date.now()): number {
    return this.stalledSince === null ? 0 : now - this.stalledSince;
  }

  scheduleWatchdog(delayMs: number, callback: () => void): boolean {
    return this.schedule(delayMs, callback);
  }

  scheduleRetry(callback: () => void): boolean {
    const delay = reconnectDelayMs(this.retryAttempt);
    if (!this.schedule(delay, callback)) {
      return false;
    }
    this.retryAttempt += 1;
    return true;
  }

  suspend(): void {
    this.clearTimer();
  }

  markRecovered(): void {
    this.clearTimer();
    this.retryAttempt = 0;
    this.stalledSince = null;
    this._error = null;
  }

  cancel(): void {
    this.markRecovered();
  }

  private schedule(delayMs: number, callback: () => void): boolean {
    if (this.timer !== null) {
      return false;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      callback();
    }, delayMs);
    return true;
  }

  private clearTimer(): void {
    if (this.timer === null) {
      return;
    }
    clearTimeout(this.timer);
    this.timer = null;
  }
}
