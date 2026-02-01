/**
 * File Audio Source
 *
 * Loads local audio files via the File API for playback through Web Audio.
 * Uses MediaElementAudioSourceNode for routing into the audio graph.
 * Properly manages object URLs to prevent memory leaks.
 *
 * Supported formats: MP3, WAV, FLAC, OGG, AAC, M4A (browser-dependent)
 */

import { safeDisconnect } from "../manager/audio-manager.js";
import type { StreamStatus } from "./types.js";

/**
 * Supported audio MIME types
 */
const SUPPORTED_AUDIO_TYPES = [
  "audio/mpeg", // MP3
  "audio/mp3",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/flac",
  "audio/x-flac",
  "audio/ogg",
  "audio/vorbis",
  "audio/aac",
  "audio/mp4",
  "audio/x-m4a",
  "audio/webm",
] as const;

/**
 * Supported audio file extensions
 */
const SUPPORTED_EXTENSIONS = [
  ".mp3",
  ".wav",
  ".flac",
  ".ogg",
  ".aac",
  ".m4a",
  ".webm",
] as const;

/**
 * Callbacks for FileSource
 */
export type FileSourceCallbacks = {
  onPlaying?: () => void;
  onPaused?: () => void;
  onEnded?: () => void;
  onReady?: () => void;
  onError?: (error: Error) => void;
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  onBuffering?: (isBuffering: boolean) => void;
};

/**
 * File metadata extracted after loading
 */
export type FileMetadata = {
  name: string;
  size: number;
  type: string;
  duration: number;
};

/**
 * Check if a file is a supported audio file
 */
export function isAudioFile(file: File): boolean {
  // Check MIME type
  if (
    SUPPORTED_AUDIO_TYPES.includes(
      file.type as (typeof SUPPORTED_AUDIO_TYPES)[number]
    )
  ) {
    return true;
  }

  // Fallback to extension check
  const name = file.name.toLowerCase();
  return SUPPORTED_EXTENSIONS.some((ext) => name.endsWith(ext));
}

/**
 * FileSource
 *
 * Loads and plays local audio files through Web Audio API.
 * Creates object URLs for file playback and properly revokes them on cleanup.
 */
export class FileSource {
  private audio: HTMLAudioElement;
  private source: MediaElementAudioSourceNode | null = null;
  private readonly context: AudioContext;
  private readonly callbacks: FileSourceCallbacks;
  private readonly sourceId: string;

  private _status: StreamStatus = "idle";
  private objectUrl: string | null = null;
  private _metadata: FileMetadata | null = null;

  constructor(
    context: AudioContext,
    sourceId: string,
    callbacks: FileSourceCallbacks = {}
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
    this.audio.preload = "metadata";

    this.audio.addEventListener("playing", this.handlePlaying);
    this.audio.addEventListener("pause", this.handlePaused);
    this.audio.addEventListener("ended", this.handleEnded);
    this.audio.addEventListener("error", this.handleError);
    this.audio.addEventListener("timeupdate", this.handleTimeUpdate);
    this.audio.addEventListener("waiting", this.handleWaiting);
    this.audio.addEventListener("canplay", this.handleCanPlay);
    this.audio.addEventListener("canplaythrough", this.handleCanPlayThrough);
  }

  /**
   * Get source ID
   */
  get id(): string {
    return this.sourceId;
  }

  /**
   * Get current status
   */
  get status(): StreamStatus {
    return this._status;
  }

  /**
   * Get file metadata (available after load)
   */
  get metadata(): FileMetadata | null {
    return this._metadata;
  }

  /**
   * Get audio output node for connecting to Web Audio graph
   */
  get output(): AudioNode | null {
    return this.source;
  }

  /**
   * Check if active (playing or paused with content loaded)
   */
  get isActive(): boolean {
    return (
      this._status === "streaming" ||
      this._status === "buffering" ||
      (this._status !== "idle" &&
        this._status !== "ended" &&
        this._status !== "error")
    );
  }

  /**
   * Get current playback position in seconds
   */
  get currentTime(): number {
    return this.audio.currentTime;
  }

  /**
   * Set current playback position in seconds
   */
  set currentTime(value: number) {
    this.audio.currentTime = Math.max(0, Math.min(value, this.duration));
  }

  /**
   * Get total duration in seconds
   */
  get duration(): number {
    return this.audio.duration || 0;
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
   * Check if currently playing
   */
  get isPlaying(): boolean {
    return !(this.audio.paused || this.audio.ended);
  }

  /**
   * Load a local audio file
   */
  async loadFile(file: File): Promise<void> {
    if (!isAudioFile(file)) {
      throw new Error(`Unsupported audio format: ${file.type || file.name}`);
    }

    // Cleanup previous file
    this.cleanup();

    // Create new audio element (MediaElementSource can only be created once per element)
    this.audio = new Audio();
    this.setupAudioElement();

    // Create object URL for the file
    this.objectUrl = URL.createObjectURL(file);
    this.audio.src = this.objectUrl;

    this._status = "connecting";

    // Create MediaElementSource
    this.source = this.context.createMediaElementSource(this.audio);

    // Wait for metadata to load
    await this.waitForMetadata(file);
  }

  /**
   * Wait for audio metadata to be available
   */
  private waitForMetadata(file: File): Promise<void> {
    return new Promise((resolve, reject) => {
      const onLoadedMetadata = (): void => {
        this.audio.removeEventListener("loadedmetadata", onLoadedMetadata);
        this.audio.removeEventListener("error", onError);

        this._metadata = {
          name: file.name,
          size: file.size,
          type: file.type,
          duration: this.audio.duration,
        };

        this._status = "buffering";
        this.callbacks.onReady?.();
        resolve();
      };

      const onError = (): void => {
        this.audio.removeEventListener("loadedmetadata", onLoadedMetadata);
        this.audio.removeEventListener("error", onError);
        const error = new Error(
          this.audio.error?.message || "Failed to load audio file"
        );
        this._status = "error";
        reject(error);
      };

      this.audio.addEventListener("loadedmetadata", onLoadedMetadata, {
        once: true,
      });
      this.audio.addEventListener("error", onError, { once: true });
      this.audio.load();
    });
  }

  /**
   * Start or resume playback
   */
  async play(): Promise<void> {
    if (this._status === "idle" || this._status === "error") {
      throw new Error("No file loaded - call loadFile() first");
    }

    await this.audio.play();
  }

  /**
   * Pause playback
   */
  pause(): void {
    this.audio.pause();
  }

  /**
   * Stop playback and reset position
   */
  stop(): void {
    this.audio.pause();
    this.audio.currentTime = 0;
    this._status = "ended";
    this.callbacks.onEnded?.();
  }

  /**
   * Seek to a specific time (in seconds)
   */
  seek(time: number): void {
    this.currentTime = time;
  }

  /**
   * Set playback rate (0.5 to 2.0)
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
   * Cleanup resources and revoke object URL
   */
  cleanup(): void {
    // Remove event listeners
    this.audio.removeEventListener("playing", this.handlePlaying);
    this.audio.removeEventListener("pause", this.handlePaused);
    this.audio.removeEventListener("ended", this.handleEnded);
    this.audio.removeEventListener("error", this.handleError);
    this.audio.removeEventListener("timeupdate", this.handleTimeUpdate);
    this.audio.removeEventListener("waiting", this.handleWaiting);
    this.audio.removeEventListener("canplay", this.handleCanPlay);
    this.audio.removeEventListener("canplaythrough", this.handleCanPlayThrough);

    this.audio.pause();
    this.audio.src = "";

    // Revoke object URL to prevent memory leak
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }

    safeDisconnect(this.source, "FileSource.cleanup");
    this.source = null;

    this._status = "idle";
    this._metadata = null;
  }

  // === Event Handlers ===

  private readonly handlePlaying = (): void => {
    this._status = "streaming";
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
    const error = this.audio.error;
    const errorMessage = error?.message || "Unknown audio error";
    this._status = "error";
    this.callbacks.onError?.(new Error(errorMessage));
  };

  private readonly handleTimeUpdate = (): void => {
    this.callbacks.onTimeUpdate?.(this.audio.currentTime, this.audio.duration);
  };

  private readonly handleWaiting = (): void => {
    this.callbacks.onBuffering?.(true);
  };

  private readonly handleCanPlay = (): void => {
    this.callbacks.onBuffering?.(false);
  };

  private readonly handleCanPlayThrough = (): void => {
    this.callbacks.onBuffering?.(false);
  };
}

/**
 * Create a file source
 */
export function createFileSource(
  context: AudioContext,
  sourceId: string,
  callbacks: FileSourceCallbacks = {}
): FileSource {
  return new FileSource(context, sourceId, callbacks);
}
