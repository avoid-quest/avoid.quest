import type { BasePlayback } from "./base-playback.js";
import type { Sound } from "./sound.js";
import type { Synth } from "./synth.js";
import type { SynthPlayback } from "./synth-playback.js";

/**
 * Base events for all audio objects.
 */
export type BaseAudioEvents = {
  play: BasePlayback;
  stop: undefined;
  pause: undefined;
  resume: undefined;
  ended: undefined;
  volumeChange: number;
  error: PlaybackErrorEvent;
};

/**
 * Sound-specific events.
 */
export type SoundEvents = BaseAudioEvents & {
  loopEnd: undefined;
  rateChange: number;
  soundError: SoundErrorEvent;
};

/**
 * Playback-specific events.
 */
export type PlaybackEvents = BaseAudioEvents & {
  seek: number;
};

/**
 * Synthesizer-specific events.
 */
export type SynthEvents = Omit<BaseAudioEvents, "play"> & {
  play: SynthPlayback;
  frequencyChange: number;
  typeChange: OscillatorType;
  detuneChange: number;
};

/**
 * Global playback event fired when any Sound or Synth plays/stops/pauses.
 */
export type GlobalPlaybackEvent = {
  source: Sound | Synth;
  timestamp: number;
};

/**
 * Global Cacophony events including loading and cache operations.
 */
export type CacophonyEvents = {
  volumeChange: number;
  mute: undefined;
  unmute: undefined;
  suspend: undefined;
  resume: undefined;
  loadingStart: LoadingStartEvent;
  loadingProgress: LoadingProgressEvent;
  loadingComplete: LoadingCompleteEvent;
  loadingError: LoadingErrorEvent;
  cacheHit: CacheHitEvent;
  cacheMiss: CacheMissEvent;
  cacheError: CacheErrorEvent;
  globalPlay: GlobalPlaybackEvent;
  globalStop: GlobalPlaybackEvent;
  globalPause: GlobalPlaybackEvent;
};

/**
 * Fired when loading starts. Use for loading spinners.
 */
export type LoadingStartEvent = {
  url: string;
  timestamp: number;
};

/**
 * Progress updates. total=null means unknown size.
 * progress=-1 means indeterminate.
 */
export type LoadingProgressEvent = {
  url: string;
  loaded: number;
  total: number | null;
  progress: number; // 0-1, or -1 if total unknown
  timestamp: number;
};

/**
 * Fired when loading completes successfully.
 */
export type LoadingCompleteEvent = {
  url: string;
  duration: number;
  size: number;
  timestamp: number;
};

/**
 * Fired when loading fails.
 */
export type LoadingErrorEvent = {
  url: string;
  error: Error;
  errorType: "network" | "decode" | "abort" | "unknown";
  timestamp: number;
};

/**
 * Playback error with recovery information.
 */
export type PlaybackErrorEvent = {
  error: Error;
  errorType: "context" | "source" | "decode" | "unknown";
  timestamp: number;
  recoverable: boolean;
};

/**
 * Sound error with recovery information.
 */
export type SoundErrorEvent = {
  url?: string;
  error: Error;
  errorType: "load" | "playback" | "context" | "unknown";
  timestamp: number;
  recoverable: boolean;
};

/**
 * Cache hit from memory, browser cache, or 304 response.
 */
export type CacheHitEvent = {
  url: string;
  cacheType: "memory" | "browser" | "conditional";
  timestamp: number;
};

/**
 * Cache miss requiring network fetch.
 */
export type CacheMissEvent = {
  url: string;
  reason: "not-found" | "expired" | "invalid";
  timestamp: number;
};

/**
 * Cache operation error.
 */
export type CacheErrorEvent = {
  url: string;
  error: Error;
  operation: "get" | "set" | "delete" | "validate";
  timestamp: number;
};

/**
 * Loading event callbacks for cache operations.
 */
export type LoadingEventCallback = {
  onLoadingStart?: (event: LoadingStartEvent) => void;
  onLoadingProgress?: (event: LoadingProgressEvent) => void;
  onLoadingComplete?: (event: LoadingCompleteEvent) => void;
  onLoadingError?: (event: LoadingErrorEvent) => void;
};

/**
 * Error event callbacks.
 */
export type ErrorEventCallback = {
  onPlaybackError?: (event: PlaybackErrorEvent) => void;
  onSoundError?: (event: SoundErrorEvent) => void;
};

/**
 * Cache event callbacks.
 */
export type CacheEventCallback = {
  onCacheHit?: (event: CacheHitEvent) => void;
  onCacheMiss?: (event: CacheMissEvent) => void;
  onCacheError?: (event: CacheErrorEvent) => void;
};

/**
 * Combined event callbacks for cache operations.
 */
export interface AudioEventCallbacks
  extends LoadingEventCallback,
    ErrorEventCallback,
    CacheEventCallback {}
