/**
 * HTML5 Audio Source
 *
 * Wraps HTMLAudioElement for streaming audio with CORS detection and proxy fallback.
 * Uses MediaElementAudioSourceNode to connect to Web Audio graph.
 */

import type { StreamStatus } from "./types.js";

/**
 * Callbacks for Html5AudioSource
 */
export type Html5AudioSourceCallbacks = {
  onPlaying?: () => void;
  onPaused?: () => void;
  onBuffering?: (isBuffering: boolean) => void;
  onReady?: () => void;
  onError?: (error: Error) => void;
  onEnded?: () => void;
};

/**
 * CORS detection state
 */
type CorsState = "unknown" | "checking" | "cors-ok" | "cors-failed" | "proxied";

/**
 * Html5AudioSource
 *
 * Uses native HTMLAudioElement for streaming with browser-managed buffering.
 * Automatically detects CORS issues and falls back to proxy if needed.
 */
export class Html5AudioSource {
  private audio: HTMLAudioElement;
  private source: MediaElementAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private readonly context: AudioContext;
  private readonly callbacks: Html5AudioSourceCallbacks;
  private readonly sourceId: string;

  private _status: StreamStatus = "idle";
  private _corsState: CorsState = "unknown";
  private _isBuffering = false;
  private corsCheckTimer: ReturnType<typeof setTimeout> | null = null;
  private currentUrl = "";
  private proxyUrl = "";
  private _isLoadingPhase = false;

  // Proxy URL pattern - uses the stream-proxy route
  private static readonly PROXY_ROUTE = "/api/stream-proxy?url=";

  constructor(
    context: AudioContext,
    sourceId: string,
    callbacks: Html5AudioSourceCallbacks = {}
  ) {
    this.context = context;
    this.sourceId = sourceId;
    this.callbacks = callbacks;
    this.audio = new Audio();
    this.setupAudioElement();
  }

  /**
   * Set up audio element event listeners
   */
  private setupAudioElement(): void {
    // Enable CORS for cross-origin streams
    this.audio.crossOrigin = "anonymous";
    this.audio.preload = "none";

    // Playback events
    this.audio.addEventListener("playing", this.handlePlaying);
    this.audio.addEventListener("pause", this.handlePaused);
    this.audio.addEventListener("ended", this.handleEnded);
    this.audio.addEventListener("error", this.handleError);

    // Buffering events
    this.audio.addEventListener("waiting", this.handleWaiting);
    this.audio.addEventListener("canplay", this.handleCanPlay);
    this.audio.addEventListener("canplaythrough", this.handleCanPlayThrough);
  }

  /**
   * Get current status
   */
  get status(): StreamStatus {
    return this._status;
  }

  /**
   * Get source ID
   */
  get id(): string {
    return this.sourceId;
  }

  /**
   * Check if currently buffering
   */
  get isBuffering(): boolean {
    return (
      this._isBuffering ||
      this.audio.readyState < HTMLMediaElement.HAVE_ENOUGH_DATA
    );
  }

  /**
   * Check if active (connecting, buffering, or streaming)
   */
  get isActive(): boolean {
    return (
      this._status === "connecting" ||
      this._status === "buffering" ||
      this._status === "streaming"
    );
  }

  /**
   * Get audio output node for connecting to Web Audio graph
   */
  get output(): AudioNode | null {
    return this.source;
  }

  /**
   * Get CORS state
   */
  get corsState(): CorsState {
    return this._corsState;
  }

  /**
   * Load a stream URL
   * Automatically handles CORS detection and proxy fallback
   */
  async load(url: string): Promise<void> {
    // Clean up previous source
    this.cleanup();

    this.currentUrl = url;
    this.proxyUrl = Html5AudioSource.PROXY_ROUTE + encodeURIComponent(url);
    this._status = "connecting";
    this._corsState = "checking";

    // Create MediaElementSource (can only be created once per audio element)
    this.audio = new Audio();
    this.setupAudioElement();
    this.audio.crossOrigin = "anonymous";
    this.audio.src = url;

    // Create Web Audio nodes
    this.source = this.context.createMediaElementSource(this.audio);
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 256;

    // Connect source to analyser for CORS detection
    this.source.connect(this.analyser);

    // Wait for initial load
    this._isLoadingPhase = true;
    try {
      await this.waitForCanPlay();
    } finally {
      this._isLoadingPhase = false;
    }
  }

  /**
   * Wait for audio to be ready to play
   */
  private waitForCanPlay(): Promise<void> {
    return new Promise((resolve, reject) => {
      const onCanPlay = (): void => {
        this.audio.removeEventListener("canplay", onCanPlay);
        this.audio.removeEventListener("error", onError);
        this._status = "buffering";
        this.callbacks.onReady?.();
        resolve();
      };

      const onError = (): void => {
        this.audio.removeEventListener("canplay", onCanPlay);
        this.audio.removeEventListener("error", onError);
        const error = new Error(
          this.audio.error?.message || "Failed to load audio"
        );
        reject(error);
      };

      this.audio.addEventListener("canplay", onCanPlay, { once: true });
      this.audio.addEventListener("error", onError, { once: true });
      this.audio.load();
    });
  }

  /**
   * Start playback
   */
  async play(): Promise<void> {
    if (this._status === "idle" || this._status === "ended") {
      throw new Error("Source not loaded - call load() first");
    }

    await this.audio.play();
  }

  /**
   * Retry loading through proxy
   */
  private async retryWithProxy(): Promise<void> {
    // Stop current playback
    this.audio.pause();

    // Disconnect and cleanup old nodes
    this.source?.disconnect();
    this.analyser?.disconnect();

    // Create new audio element with proxy URL
    this.audio = new Audio();
    this.setupAudioElement();
    this.audio.crossOrigin = "anonymous";
    this.audio.src = this.proxyUrl;

    // Recreate Web Audio nodes
    this.source = this.context.createMediaElementSource(this.audio);
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 256;
    this.source.connect(this.analyser);

    this._corsState = "proxied";

    this._isLoadingPhase = true;
    try {
      await this.waitForCanPlay();
      await this.audio.play();
      this._status = "streaming";
    } catch (error) {
      this._status = "error";
      this.callbacks.onError?.(
        error instanceof Error ? error : new Error("Failed to load via proxy")
      );
    } finally {
      this._isLoadingPhase = false;
    }
  }

  /**
   * Pause playback
   */
  pause(): void {
    this.audio.pause();
  }

  /**
   * Stop playback and cleanup
   */
  stop(): void {
    this.audio.pause();
    this.audio.src = "";
    this._status = "ended";
    this.callbacks.onEnded?.();
  }

  /**
   * Get/set volume (0-1)
   */
  get volume(): number {
    return this.audio.volume;
  }

  set volume(value: number) {
    this.audio.volume = Math.max(0, Math.min(1, value));
  }

  /**
   * Set playback rate (0.5 to 2.0)
   * Note: This changes both speed and pitch
   */
  setPlaybackRate(rate: number): void {
    this.audio.playbackRate = Math.max(0.5, Math.min(2.0, rate));
  }

  /**
   * Get current playback rate
   */
  getPlaybackRate(): number {
    return this.audio.playbackRate;
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    if (this.corsCheckTimer) {
      clearTimeout(this.corsCheckTimer);
      this.corsCheckTimer = null;
    }

    // Remove event listeners to prevent memory leaks
    this.audio.removeEventListener("playing", this.handlePlaying);
    this.audio.removeEventListener("pause", this.handlePaused);
    this.audio.removeEventListener("ended", this.handleEnded);
    this.audio.removeEventListener("error", this.handleError);
    this.audio.removeEventListener("waiting", this.handleWaiting);
    this.audio.removeEventListener("canplay", this.handleCanPlay);
    this.audio.removeEventListener("canplaythrough", this.handleCanPlayThrough);

    this.audio.pause();
    this.audio.src = "";

    this.source?.disconnect();
    this.analyser?.disconnect();

    this.source = null;
    this.analyser = null;
    this._status = "idle";
    this._corsState = "unknown";
  }

  // === Event Handlers ===

  private readonly handlePlaying = (): void => {
    this._isBuffering = false;
    this._status = "streaming";
    this._corsState = "cors-ok";
    this.callbacks.onPlaying?.();
    this.callbacks.onBuffering?.(false);
  };

  private readonly handlePaused = (): void => {
    this.callbacks.onPaused?.();
  };

  private readonly handleEnded = (): void => {
    this._status = "ended";
    this.callbacks.onEnded?.();
  };

  private readonly handleError = (): void => {
    // During loading phase, let waitForCanPlay() handle errors
    // Only exception: trigger proxy retry for CORS errors
    if (this._isLoadingPhase) {
      const error = this.audio.error;
      if (
        this._corsState === "checking" &&
        error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
      ) {
        console.warn(
          `[Html5AudioSource] MEDIA_ERR_SRC_NOT_SUPPORTED for ${this.currentUrl}, trying proxy`
        );
        this._corsState = "cors-failed";
        this.retryWithProxy();
      }
      // Don't propagate error - waitForCanPlay() will handle it
      return;
    }

    // After load complete, handle errors normally
    const error = this.audio.error;
    const errorMessage = error?.message || "Unknown audio error";
    this._status = "error";
    this.callbacks.onError?.(new Error(errorMessage));
  };

  private readonly handleWaiting = (): void => {
    this._isBuffering = true;
    this._status = "buffering";
    this.callbacks.onBuffering?.(true);
  };

  private readonly handleCanPlay = (): void => {
    this._isBuffering = false;
    this.callbacks.onBuffering?.(false);
  };

  private readonly handleCanPlayThrough = (): void => {
    this._isBuffering = false;
    this.callbacks.onBuffering?.(false);
  };
}

/**
 * Create an HTML5 audio source
 */
export function createHtml5AudioSource(
  context: AudioContext,
  sourceId: string,
  callbacks: Html5AudioSourceCallbacks = {}
): Html5AudioSource {
  return new Html5AudioSource(context, sourceId, callbacks);
}
