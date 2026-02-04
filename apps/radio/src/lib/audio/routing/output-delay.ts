/**
 * Output Delay System
 *
 * Provides independent delay controls for main and CUE outputs.
 * Useful for:
 * - Compensating for latency differences between outputs
 * - Sync adjustments when monitoring through different audio paths
 * - Manual delay for creative effects
 *
 * Range: 0-500ms with millisecond precision
 */

/** Maximum delay in milliseconds */
const MAX_DELAY_MS = 500;

/** Maximum delay in seconds (for Web Audio API) */
const MAX_DELAY_SECONDS = MAX_DELAY_MS / 1000;

/**
 * Configuration for output delays
 */
export type OutputDelayConfig = {
  mainDelayMs: number; // 0-500ms
  cueDelayMs: number; // 0-500ms
};

/**
 * Default delay configuration
 */
export const defaultOutputDelayConfig: OutputDelayConfig = {
  mainDelayMs: 0,
  cueDelayMs: 0,
};

/**
 * OutputDelay - Independent delay controls for main and CUE outputs
 *
 * Both delays are optional pass-through nodes. When delay is 0ms,
 * audio passes through with minimal latency.
 */
export class OutputDelay {
  private readonly context: AudioContext;
  private readonly _mainDelayNode: DelayNode;
  private readonly _cueDelayNode: DelayNode;
  private _mainDelayMs = 0;
  private _cueDelayMs = 0;

  constructor(context: AudioContext) {
    this.context = context;

    // Create delay nodes with max delay capacity
    this._mainDelayNode = context.createDelay(MAX_DELAY_SECONDS);
    this._cueDelayNode = context.createDelay(MAX_DELAY_SECONDS);

    // Initialize to zero delay (pass-through)
    this._mainDelayNode.delayTime.value = 0;
    this._cueDelayNode.delayTime.value = 0;
  }

  /**
   * Get current main output delay in milliseconds
   */
  get mainDelayMs(): number {
    return this._mainDelayMs;
  }

  /**
   * Get current CUE output delay in milliseconds
   */
  get cueDelayMs(): number {
    return this._cueDelayMs;
  }

  /**
   * Set main output delay
   * @param ms - Delay in milliseconds (0-500)
   */
  setMainDelay(ms: number): void {
    const clampedMs = Math.max(0, Math.min(MAX_DELAY_MS, ms));
    this._mainDelayMs = clampedMs;

    const now = this.context.currentTime;
    const seconds = clampedMs / 1000;

    // Smooth transition to avoid clicks
    this._mainDelayNode.delayTime.setTargetAtTime(seconds, now, 0.02);
  }

  /**
   * Set CUE output delay
   * @param ms - Delay in milliseconds (0-500)
   */
  setCueDelay(ms: number): void {
    const clampedMs = Math.max(0, Math.min(MAX_DELAY_MS, ms));
    this._cueDelayMs = clampedMs;

    const now = this.context.currentTime;
    const seconds = clampedMs / 1000;

    // Smooth transition to avoid clicks
    this._cueDelayNode.delayTime.setTargetAtTime(seconds, now, 0.02);
  }

  /**
   * Get the main delay node (input and output are the same node)
   * Connect audio to this node and it will be delayed
   */
  get mainDelayNode(): DelayNode {
    return this._mainDelayNode;
  }

  /**
   * Get the CUE delay node (input and output are the same node)
   * Connect audio to this node and it will be delayed
   */
  get cueDelayNode(): DelayNode {
    return this._cueDelayNode;
  }

  /**
   * Get current delay configuration
   */
  getConfig(): OutputDelayConfig {
    return {
      mainDelayMs: this._mainDelayMs,
      cueDelayMs: this._cueDelayMs,
    };
  }

  /**
   * Apply a configuration
   */
  applyConfig(config: Partial<OutputDelayConfig>): void {
    if (config.mainDelayMs !== undefined) {
      this.setMainDelay(config.mainDelayMs);
    }
    if (config.cueDelayMs !== undefined) {
      this.setCueDelay(config.cueDelayMs);
    }
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    try {
      this._mainDelayNode.disconnect();
    } catch {
      // Already disconnected
    }
    try {
      this._cueDelayNode.disconnect();
    } catch {
      // Already disconnected
    }
  }
}

/**
 * Create an OutputDelay instance
 */
export function createOutputDelay(context: AudioContext): OutputDelay {
  return new OutputDelay(context);
}
