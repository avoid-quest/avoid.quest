const DEFAULT_MAX = 20;
let queueMax: number | null = null;

/**
 * Set the limit for concurrent requests
 *
 * Defaults to 20
 */
export function setRequestQueueLimit(limit: number): void {
  queueMax = limit;
}

/**
 * Get the limit for concurrent requests
 */
export function getRequestQueueLimit(): number {
  return queueMax ?? DEFAULT_MAX;
}

/**
 * Internal request queue
 */
export class Queue {
  private current: number;
  private queue: (() => void)[];

  constructor() {
    this.current = 0;
    this.queue = [];
  }

  /**
   * Wait for this to resolve before executing a queued action
   */
  async enqueue(): Promise<void> {
    if (this.current >= getRequestQueueLimit()) {
      await new Promise<void>((resolve) => this.queue.unshift(resolve));
    }
    this.current++;
  }

  /**
   * Call this after a queued action has finished executing
   */
  dequeue() {
    this.current--;
    const next = this.queue.pop();
    next?.();
  }
}
