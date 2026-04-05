/**
 * HTML5 Audio Source
 *
 * Wraps HTMLAudioElement for streaming audio with CORS detection and proxy fallback.
 * Uses MediaElementAudioSourceNode to connect to Web Audio graph.
 * Supports HLS streams via hls.js for browsers without native HLS support.
 */

import Hls from "hls.js";
import {
  recordAudioDebugEvent,
  syncAudioDebugMediaState,
  updateAudioDebugContext,
  updateAudioDebugSnapshot,
} from "../debug/audio-debug-store.js";
import type {
  AudioDebugDeliveryPath,
  AudioDebugProcessingPath,
} from "../debug/audio-debug-types.js";
import { getLoadModeOverride, type Html5LoadMode } from "../html5/load-mode.js";
import { safeDisconnect } from "../utils.js";
import { readAudioContextMetrics } from "./audio-context.js";
import type { StreamStatus } from "./types.js";

/**
 * Check if a URL is an HLS stream (M3U8 playlist)
 */
function isHlsUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return urlObj.pathname.endsWith(".m3u8");
  } catch {
    return url.includes(".m3u8");
  }
}

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
  /** Called when a network error occurs during streaming (e.g., YouTube 403 throttle) */
  onStreamError?: (position: number) => void;
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
  private hls: Hls | null = null;
  private readonly context: AudioContext;
  private readonly callbacks: Html5AudioSourceCallbacks;
  private readonly sourceId: string;

  private _status: StreamStatus = "idle";
  private _corsState: CorsState = "unknown";
  private _isBuffering = false;
  private _isHls = false;
  private corsCheckTimer: ReturnType<typeof setTimeout> | null = null;
  private currentUrl = "";
  private proxyUrl = "";
  private _isLoadingPhase = false;
  private debugLoadMode: Html5LoadMode = "cors-anonymous";
  private debugDeliveryPath: AudioDebugDeliveryPath = "direct";
  private debugProcessingPath: AudioDebugProcessingPath = "bypass";
  private debugUsesWorklet = false;
  private debugWorkletActive = false;
  private debugWorkletBypassed = false;
  private debugEffectsActive = false;
  private debugFilterActive = false;

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
    updateAudioDebugContext(
      this.sourceId,
      readAudioContextMetrics(this.context)
    );
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
    this.audio.addEventListener("loadstart", this.handleLoadStart);
    this.audio.addEventListener("loadedmetadata", this.handleLoadedMetadata);

    // Buffering events
    this.audio.addEventListener("waiting", this.handleWaiting);
    this.audio.addEventListener("canplay", this.handleCanPlay);
    this.audio.addEventListener("canplaythrough", this.handleCanPlayThrough);
    this.audio.addEventListener("stalled", this.handleStalled);
    this.audio.addEventListener("suspend", this.handleSuspend);
    this.audio.addEventListener("progress", this.handleProgress);
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
   * Automatically handles CORS detection, proxy fallback, and HLS streams
   */
  async load(url: string): Promise<void> {
    // Clean up previous source
    this.cleanup();

    this.currentUrl = url;
    this.proxyUrl = Html5AudioSource.PROXY_ROUTE + encodeURIComponent(url);
    this._status = "connecting";
    this._isHls = isHlsUrl(url);
    this.applyInitialDebugLoadMode();
    const requestUrl =
      this.debugLoadMode === "proxied" ? this.proxyUrl : this.currentUrl;
    this._corsState = this.debugLoadMode === "proxied" ? "proxied" : "checking";

    // Create MediaElementSource (can only be created once per audio element)
    this.audio = new Audio();
    this.setupAudioElement();
    this.audio.crossOrigin = "anonymous";
    this.syncDebugState();

    // Handle HLS streams
    if (this._isHls) {
      this.loadHls(requestUrl);
    } else {
      this.audio.src = requestUrl;
    }

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
    } catch (error) {
      // CORS failed: reload through proxy so the caller gets a valid source.
      // handleError mutates _corsState during the async waitForCanPlay.
      if (this.isCorsRetryNeeded()) {
        await this.reloadWithProxy();
        return;
      }
      throw error;
    } finally {
      this._isLoadingPhase = false;
    }
  }

  /**
   * Check if CORS retry is needed. Separate method to avoid TS narrowing
   * issues (handleError mutates _corsState during async waitForCanPlay).
   */
  private isCorsRetryNeeded(): boolean {
    return this._corsState === "cors-failed";
  }

  /**
   * Reload audio through proxy after CORS failure.
   * Replaces audio element and Web Audio nodes inline so the caller's
   * promise chain stays intact (AudioManager can connect the graph after).
   */
  private async reloadWithProxy(): Promise<void> {
    this.audio.pause();
    safeDisconnect(this.source, "Html5AudioSource.reloadWithProxy");
    safeDisconnect(this.analyser, "Html5AudioSource.reloadWithProxy");

    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }

    this.audio = new Audio();
    this.setupAudioElement();
    this.audio.crossOrigin = "anonymous";
    this.debugLoadMode = "proxied";
    this.debugDeliveryPath = "proxied";
    this.syncDebugState();

    if (this._isHls) {
      this.loadHls(this.proxyUrl);
    } else {
      this.audio.src = this.proxyUrl;
    }

    this.source = this.context.createMediaElementSource(this.audio);
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 256;
    this.source.connect(this.analyser);

    this._corsState = "proxied";
    this.syncDebugState();
    await this.waitForCanPlay();
  }

  /**
   * Load HLS stream using hls.js or native support
   * Prefers hls.js when available for better cross-origin handling
   */
  private loadHls(url: string): void {
    // Prefer hls.js when available (better CORS and error handling)
    if (Hls.isSupported()) {
      this.setupHlsJs(url);
      return;
    }

    // Fall back to native HLS support (Safari without MSE, iOS)
    if (this.audio.canPlayType("application/vnd.apple.mpegurl")) {
      this.audio.src = url;
      return;
    }

    throw new Error("HLS is not supported in this browser");
  }

  /**
   * Set up hls.js for HLS playback
   */
  private setupHlsJs(url: string): void {
    this.hls = new Hls({
      // Enable debug in development
      debug: false,
      // Start with low quality then adapt
      startLevel: -1,
      // Buffer settings optimized for audio
      maxBufferLength: 30,
      maxMaxBufferLength: 60,
    });

    // Set up HLS event handlers
    this.hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) {
        console.warn(
          "[Html5AudioSource] Fatal HLS error:",
          data.type,
          data.details
        );
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            this.hls?.startLoad();
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            this.hls?.recoverMediaError();
            break;
          default:
            // Cannot recover
            this._status = "error";
            this.callbacks.onError?.(
              new Error(`HLS error: ${data.type} - ${data.details}`)
            );
            break;
        }
      }
    });

    // Attach to audio element and load source
    this.hls.attachMedia(this.audio);
    this.hls.loadSource(url);
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

    try {
      await this.audio.play();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      throw error;
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
   * Get current playback position in seconds
   */
  get currentTime(): number {
    return this.audio.currentTime;
  }

  /**
   * Get total duration in seconds (Infinity for live streams)
   */
  get duration(): number {
    return this.audio.duration;
  }

  /**
   * Seek to a position in seconds
   */
  seek(position: number): void {
    this.audio.currentTime = position;
  }

  /**
   * Refresh the stream with a new URL, optionally seeking to a position
   * Used for YouTube URL refresh when throttled
   */
  async refreshUrl(newUrl: string, seekPosition?: number): Promise<void> {
    // Store current state
    const wasPlaying = this._status === "streaming";

    // Disconnect and cleanup old nodes
    this.audio.pause();
    safeDisconnect(this.source, "Html5AudioSource.refreshUrl");
    safeDisconnect(this.analyser, "Html5AudioSource.refreshUrl");

    // Clean up HLS instance if exists
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }

    // Create new audio element with new URL
    this.audio = new Audio();
    this.setupAudioElement();
    this.audio.crossOrigin = "anonymous";
    this.currentUrl = newUrl;
    this._isHls = isHlsUrl(newUrl);
    this.debugLoadMode = newUrl.startsWith(Html5AudioSource.PROXY_ROUTE)
      ? "proxied"
      : "cors-anonymous";
    this.debugDeliveryPath =
      this.debugLoadMode === "proxied" ? "proxied" : "direct";
    this.syncDebugState();

    // Handle HLS streams
    if (this._isHls) {
      this.loadHls(newUrl);
    } else {
      this.audio.src = newUrl;
    }

    // Recreate Web Audio nodes
    this.source = this.context.createMediaElementSource(this.audio);
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 256;
    this.source.connect(this.analyser);

    this._status = "connecting";
    this._isLoadingPhase = true;

    try {
      await this.waitForCanPlay();

      // Seek to position if specified
      if (seekPosition !== undefined && seekPosition > 0) {
        this.audio.currentTime = seekPosition;
      }

      // Resume playback if we were playing
      if (wasPlaying) {
        await this.audio.play();
        this._status = "streaming";
      }
    } catch (error) {
      this._status = "error";
      this.callbacks.onError?.(
        error instanceof Error ? error : new Error("Failed to refresh URL")
      );
    } finally {
      this._isLoadingPhase = false;
    }
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    if (this.corsCheckTimer) {
      clearTimeout(this.corsCheckTimer);
      this.corsCheckTimer = null;
    }

    // Clean up HLS instance
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }

    // Remove event listeners to prevent memory leaks
    this.audio.removeEventListener("playing", this.handlePlaying);
    this.audio.removeEventListener("pause", this.handlePaused);
    this.audio.removeEventListener("ended", this.handleEnded);
    this.audio.removeEventListener("error", this.handleError);
    this.audio.removeEventListener("loadstart", this.handleLoadStart);
    this.audio.removeEventListener("loadedmetadata", this.handleLoadedMetadata);
    this.audio.removeEventListener("waiting", this.handleWaiting);
    this.audio.removeEventListener("canplay", this.handleCanPlay);
    this.audio.removeEventListener("canplaythrough", this.handleCanPlayThrough);
    this.audio.removeEventListener("stalled", this.handleStalled);
    this.audio.removeEventListener("suspend", this.handleSuspend);
    this.audio.removeEventListener("progress", this.handleProgress);

    this.audio.pause();
    this.audio.src = "";

    safeDisconnect(this.source, "Html5AudioSource.cleanup");
    safeDisconnect(this.analyser, "Html5AudioSource.cleanup");

    this.source = null;
    this.analyser = null;
    this._status = "idle";
    this._corsState = "unknown";
    this._isHls = false;
  }

  updateDebugRoute(input: {
    processingPath?: AudioDebugProcessingPath;
    usesWorklet?: boolean;
    workletActive?: boolean;
    workletBypassed?: boolean;
    effectsActive?: boolean;
    filterActive?: boolean;
  }): void {
    if (input.processingPath !== undefined) {
      this.debugProcessingPath = input.processingPath;
    }
    if (input.usesWorklet !== undefined) {
      this.debugUsesWorklet = input.usesWorklet;
    }
    if (input.workletActive !== undefined) {
      this.debugWorkletActive = input.workletActive;
    }
    if (input.workletBypassed !== undefined) {
      this.debugWorkletBypassed = input.workletBypassed;
    }
    if (input.effectsActive !== undefined) {
      this.debugEffectsActive = input.effectsActive;
    }
    if (input.filterActive !== undefined) {
      this.debugFilterActive = input.filterActive;
    }
    this.syncDebugState();
  }

  // === Event Handlers ===

  private readonly handleLoadStart = (): void => {
    this.recordDebugEvent("loadstart");
  };

  private readonly handleLoadedMetadata = (): void => {
    this.recordDebugEvent("loadedmetadata");
  };

  private readonly handlePlaying = (): void => {
    this._isBuffering = false;
    this._status = "streaming";
    this._corsState = this.debugLoadMode === "proxied" ? "proxied" : "cors-ok";
    this.recordDebugEvent("playing");
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
    this.recordDebugEvent("error");
    // During loading phase, let waitForCanPlay() handle errors
    // Mark CORS failures so load() can retry with proxy inline
    if (this._isLoadingPhase) {
      const error = this.audio.error;
      if (
        this._corsState === "checking" &&
        error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
      ) {
        console.warn(
          `[Html5AudioSource] CORS failed for ${this.currentUrl}, will retry with proxy`
        );
        this._corsState = "cors-failed";
      }
      // Don't propagate - waitForCanPlay() rejects, load() handles retry
      return;
    }

    // After load complete: network errors during streaming (e.g., YouTube 403 throttle)
    const error = this.audio.error;
    const errorMessage = error?.message || "Unknown audio error";

    // Check if this was a streaming error (we were playing and hit a network issue)
    // MEDIA_ERR_NETWORK (2) indicates network error during fetch
    if (
      this._status === "streaming" &&
      error?.code === MediaError.MEDIA_ERR_NETWORK
    ) {
      console.warn(
        `[Html5AudioSource] Network error during streaming at ${this.audio.currentTime}s`
      );
      // Notify about stream error with current position for potential refresh
      const position = this.audio.currentTime;
      this.callbacks.onStreamError?.(position);
    }

    this._status = "error";
    this.callbacks.onError?.(new Error(errorMessage));
  };

  private readonly handleWaiting = (): void => {
    this._isBuffering = true;
    this._status = "buffering";
    this.recordDebugEvent("waiting");
    this.callbacks.onBuffering?.(true);
  };

  private readonly handleCanPlay = (): void => {
    this._isBuffering = false;
    this.recordDebugEvent("canplay");
    this.callbacks.onBuffering?.(false);
  };

  private readonly handleCanPlayThrough = (): void => {
    this._isBuffering = false;
    this.recordDebugEvent("canplaythrough");
    this.callbacks.onBuffering?.(false);
  };

  private readonly handleStalled = (): void => {
    this.recordDebugEvent("stalled");
  };

  private readonly handleSuspend = (): void => {
    this.recordDebugEvent("suspend");
  };

  private readonly handleProgress = (): void => {
    this.recordDebugEvent("progress");
  };

  private applyInitialDebugLoadMode(): void {
    const override = getLoadModeOverride();
    if (override === "proxied") {
      this.debugLoadMode = "proxied";
      this.debugDeliveryPath = "proxied";
      return;
    }

    this.debugLoadMode = "cors-anonymous";
    this.debugDeliveryPath = "direct";
  }

  private syncDebugState(): void {
    updateAudioDebugContext(
      this.sourceId,
      readAudioContextMetrics(this.context)
    );
    syncAudioDebugMediaState(this.sourceId, {
      element: this.audio,
      streamUrl: this.currentUrl || this.audio.src || null,
      loadMode: this.debugLoadMode,
      deliveryPath: this.debugDeliveryPath,
      processingPath: this.debugProcessingPath,
      usesWorklet: this.debugUsesWorklet,
      workletActive: this.debugWorkletActive,
      workletBypassed: this.debugWorkletBypassed,
      effectsActive: this.debugEffectsActive,
      filterActive: this.debugFilterActive,
    });
  }

  private recordDebugEvent(
    name: Parameters<typeof recordAudioDebugEvent>[1]
  ): void {
    recordAudioDebugEvent(this.sourceId, name, {
      element: this.audio,
      streamUrl: this.currentUrl || this.audio.src || null,
      loadMode: this.debugLoadMode,
      deliveryPath: this.debugDeliveryPath,
      processingPath: this.debugProcessingPath,
    });
    updateAudioDebugSnapshot(this.sourceId, {
      usesWorklet: this.debugUsesWorklet,
      workletActive: this.debugWorkletActive,
      workletBypassed: this.debugWorkletBypassed,
      effectsActive: this.debugEffectsActive,
      filterActive: this.debugFilterActive,
    });
  }
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
