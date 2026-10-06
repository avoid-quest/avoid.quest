import { captureError } from "@avoid.quest/error";

/**
 * Audio Context Singleton
 *
 * Provides a global AudioContext instance with proper lifecycle management,
 * including mobile resume handling for iOS/Android autoplay policies.
 */

/**
 * Normalized audio context state
 * Note: Native AudioContext can also have "interrupted" state on iOS,
 * which we treat as "suspended" for simplicity.
 */
type NormalizedContextState = "suspended" | "running" | "closed";
const MOBILE_USER_AGENT = /(android|iphone|ipad|ipod|mobile)/;
const MOBILE_LATENCY_HINT_SECONDS = 128 / 48_000;

/**
 * Callback for context state changes
 */
export type ContextStateCallback = (state: NormalizedContextState) => void;

/** Keep openDAW's 48 kHz profile and use the lowest measured-stable mobile hint. */
export function getAudioContextOptions(): AudioContextOptions {
  const userAgent =
    typeof navigator === "undefined" ? "" : navigator.userAgent.toLowerCase();
  const isFirefox = userAgent.includes("firefox");
  const isMobile = MOBILE_USER_AGENT.test(userAgent);
  return {
    latencyHint: isMobile ? MOBILE_LATENCY_HINT_SECONDS : 0,
    ...(isFirefox ? {} : { sampleRate: 48_000 }),
  };
}

type NativePlaybackStats = {
  averageLatency: number;
  maximumLatency: number;
  minimumLatency: number;
  resetLatency?: () => void;
  totalDuration: number;
  underrunDuration: number;
  underrunEvents: number;
};

export function resetAudioContextPlaybackLatency(
  context: AudioContext
): boolean {
  const { playbackStats } = context as AudioContext & {
    playbackStats?: NativePlaybackStats;
  };
  if (typeof playbackStats?.resetLatency !== "function") {
    return false;
  }
  playbackStats.resetLatency();
  return true;
}

export type AudioContextPerformanceSnapshot = {
  baseLatencyMs: number;
  outputLatencyMs: number | null;
  playbackStats: {
    averageLatencyMs: number;
    maximumLatencyMs: number;
    minimumLatencyMs: number;
    totalDurationMs: number;
    underrunDurationMs: number;
    underrunEvents: number;
  } | null;
  renderQuantumSize: number | null;
  sampleRate: number;
  state: AudioContextState;
};

export function snapshotAudioContext(
  context: AudioContext
): AudioContextPerformanceSnapshot {
  const { renderQuantumSize } = context as AudioContext & {
    renderQuantumSize?: number;
  };
  const { playbackStats: stats } = context as AudioContext & {
    playbackStats?: NativePlaybackStats;
  };
  return {
    baseLatencyMs: context.baseLatency * 1000,
    outputLatencyMs:
      typeof context.outputLatency === "number"
        ? context.outputLatency * 1000
        : null,
    playbackStats: stats
      ? {
          averageLatencyMs: stats.averageLatency * 1000,
          maximumLatencyMs: stats.maximumLatency * 1000,
          minimumLatencyMs: stats.minimumLatency * 1000,
          totalDurationMs: stats.totalDuration * 1000,
          underrunDurationMs: stats.underrunDuration * 1000,
          underrunEvents: stats.underrunEvents,
        }
      : null,
    renderQuantumSize:
      typeof renderQuantumSize === "number" ? renderQuantumSize : null,
    sampleRate: context.sampleRate,
    state: context.state,
  };
}

/**
 * Normalize the native AudioContext state to our simplified type
 */
function normalizeState(state: AudioContextState): NormalizedContextState {
  // "interrupted" (iOS) is treated as "suspended"
  if (state === "running") {
    return "running";
  }
  if (state === "closed") {
    return "closed";
  }
  return "suspended";
}

/**
 * Audio context singleton manager
 *
 * Ensures a single AudioContext is used across the application,
 * with proper handling for mobile autoplay restrictions.
 */
class AudioContextManager {
  private static instance: AudioContextManager | null = null;
  private context: AudioContext | null = null;
  private readonly stateListeners = new Set<ContextStateCallback>();
  private resumePromise: Promise<void> | null = null;
  private userInteractionBound = false as boolean;

  private constructor() {}

  /**
   * Get the singleton instance
   */
  static getInstance(): AudioContextManager {
    if (!AudioContextManager.instance) {
      AudioContextManager.instance = new AudioContextManager();
    }
    return AudioContextManager.instance;
  }

  /**
   * Get or create the AudioContext
   *
   * Creates a new context if one doesn't exist.
   * The context may be in suspended state due to autoplay policies.
   */
  getContext(): AudioContext {
    if (!this.context || this.context.state === "closed") {
      this.context = this.createContext();
    }
    return this.context;
  }

  /**
   * Check if context exists and is ready
   */
  get isReady(): boolean {
    return this.context !== null && this.context.state === "running";
  }

  /**
   * Get current context state
   */
  get state(): NormalizedContextState {
    return normalizeState(this.context?.state ?? "suspended");
  }

  /**
   * Resume the AudioContext
   *
   * Required for playback on mobile devices due to autoplay policies.
   * Safe to call multiple times - will return existing promise if already resuming.
   *
   * @returns Promise that resolves when context is running
   */
  async resume(): Promise<void> {
    const context = this.getContext();

    if (context.state === "running") {
      return;
    }

    if (context.state === "closed") {
      throw new Error("AudioContext is closed and cannot be resumed");
    }

    // Avoid multiple concurrent resume attempts
    if (this.resumePromise) {
      return this.resumePromise;
    }

    this.resumePromise = this.doResume(context);

    try {
      await this.resumePromise;
    } finally {
      this.resumePromise = null;
    }
  }

  /**
   * Suspend the AudioContext
   *
   * Useful for saving resources when audio is not needed.
   */
  async suspend(): Promise<void> {
    if (this.context?.state !== "running") {
      return;
    }

    if ("suspend" in this.context) {
      await this.context.suspend();
    }
  }

  /**
   * Close the AudioContext
   *
   * Releases all resources. A new context will be created on next getContext().
   */
  async close(): Promise<void> {
    if (!this.context) {
      return;
    }

    if (this.context.state !== "closed") {
      await this.context.close();
    }

    this.context = null;
    this.notifyListeners("closed");
  }

  /**
   * Subscribe to context state changes
   *
   * @returns Unsubscribe function
   */
  onStateChange(callback: ContextStateCallback): () => void {
    this.stateListeners.add(callback);
    return () => {
      this.stateListeners.delete(callback);
    };
  }

  /**
   * Ensure the context will resume on user interaction
   *
   * Sets up event listeners for touch/click/keydown to resume
   * the audio context. This is required for iOS Safari.
   */
  setupUserInteractionResume(): void {
    if (this.userInteractionBound || typeof document === "undefined") {
      return;
    }

    const resumeOnInteraction = () => {
      this.resume().catch((error) => {
        console.warn(
          "Failed to resume audio context on user interaction:",
          error
        );
      });
    };

    // Use once option for automatic cleanup after first interaction
    const options = { once: true, passive: true };

    document.addEventListener("touchstart", resumeOnInteraction, options);
    document.addEventListener("touchend", resumeOnInteraction, options);
    document.addEventListener("click", resumeOnInteraction, options);
    document.addEventListener("keydown", resumeOnInteraction, options);

    this.userInteractionBound = true;
  }

  /**
   * Get the current time from the audio context
   */
  get currentTime(): number {
    return this.context?.currentTime ?? 0;
  }

  /**
   * Get the sample rate of the audio context
   */
  get sampleRate(): number {
    return this.context?.sampleRate ?? 44_100;
  }

  /**
   * Get the destination node of the audio context
   */
  get destination(): AudioDestinationNode | null {
    return this.context?.destination ?? null;
  }

  getPerformanceSnapshot(): AudioContextPerformanceSnapshot | null {
    return this.context ? snapshotAudioContext(this.context) : null;
  }

  resetPlaybackLatency(): boolean {
    return this.context
      ? resetAudioContextPlaybackLatency(this.context)
      : false;
  }

  /**
   * Create the audio context with appropriate options
   */
  private createContext(): AudioContext {
    const context = new AudioContext(getAudioContextOptions());

    // Set up state change listener
    context.onstatechange = () => {
      this.notifyListeners(normalizeState(context.state));
    };

    // On mobile, set up user interaction resume
    if (context.state === "suspended") {
      this.setupUserInteractionResume();
    }

    return context;
  }

  /**
   * Perform the actual resume operation
   */
  private async doResume(context: AudioContext): Promise<void> {
    if (!("resume" in context)) {
      // Older browsers may not have resume
      return;
    }

    try {
      await context.resume();

      // Verify state changed
      if (context.state !== "running") {
        console.warn(
          `AudioContext resume completed but state is ${context.state}`
        );
      }
    } catch (error) {
      console.error("Failed to resume AudioContext:", error);
      throw error;
    }
  }

  /**
   * Notify all state listeners
   */
  private notifyListeners(state: NormalizedContextState): void {
    for (const callback of this.stateListeners) {
      try {
        callback(state);
      } catch (error) {
        captureError(error, {
          operation: "notifyAudioContextState",
          surface: "ui",
        });
      }
    }
  }

  /**
   * Reset the singleton (for testing purposes)
   */
  static resetForTesting(): void {
    if (AudioContextManager.instance?.context) {
      // Intentionally ignoring close errors during test cleanup
      AudioContextManager.instance.context.close().catch(() => undefined);
    }
    AudioContextManager.instance = null;
  }
}

/**
 * Get the audio context singleton manager
 */
export function getAudioContextManager(): AudioContextManager {
  return AudioContextManager.getInstance();
}

/**
 * Get the shared AudioContext instance
 *
 * Convenience function that returns the AudioContext directly.
 * The context may be suspended and require resume() before use.
 */
export function getAudioContext(): AudioContext {
  return getAudioContextManager().getContext();
}

/**
 * Resume the shared AudioContext
 *
 * Call this before starting playback, especially on mobile devices.
 */
export function resumeAudioContext(): Promise<void> {
  return getAudioContextManager().resume();
}

/**
 * Suspend the shared AudioContext
 *
 * Call this when audio is not needed to save resources.
 */
export function suspendAudioContext(): Promise<void> {
  return getAudioContextManager().suspend();
}

export { AudioContextManager };
