import type { RadioMetadataConfig } from "@/lib/metadata/types";
import type { PlatformMetadata } from "@/lib/platform-types";
import type { StreamFormat } from "./stream-format.js";

/**
 * Radio station/stream configuration
 */
export type Radio = {
  id?: string | number;
  /** Immutable public catalog identity; separate from the listener's local id. */
  publicId?: string;
  name: string;
  streamUrl: string;
  streamFormat?: StreamFormat;
  logoUrl?: string;
  description?: string;
  websiteUrl?: string;
  placeTitle?: string;
  countryTitle?: string;
  order?: number;
  enabled?: boolean;
  platformMetadata?: PlatformMetadata;
  metadataConfig?: RadioMetadataConfig;
  /** Whether this is a system-provided radio (from const.ts defaults) */
  isSystem?: boolean;
};

/**
 * Generate a unique error tracking ID
 */
export function generateErrorId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `err_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Error information for audio playback issues
 */
export type AudioError = {
  /** Unique identifier for error tracking/correlation */
  id: string;
  message: string;
  code: AudioErrorCode;
  /** Original exception and whether the start promise owns reporting. */
  cause?: unknown;
  duringStart?: boolean;
  /** Companion failure emitted while the caller may be renewing a finite URL. */
  recoveryPending?: boolean;
  radio?: Radio;
  timestamp: number;
  /** Source ID if error originated from a specific source/effect */
  sourceId?: string;
  /** Playback position in seconds when error occurred (for stream refresh) */
  position?: number;
};

/**
 * Error codes for audio playback
 */
export type AudioErrorCode =
  | "CONTEXT_CREATION_FAILED"
  | "CONTEXT_RESUME_FAILED"
  | "STREAM_FETCH_FAILED"
  | "STREAM_DECODE_FAILED"
  | "STREAM_ABORTED"
  | "STREAM_INTERRUPTED"
  | "WORKLET_LOAD_FAILED"
  | "WORKLET_CREATION_FAILED"
  | "WORKLET_INIT_TIMEOUT"
  | "WORKLET_UNAVAILABLE"
  | "SOURCE_NOT_FOUND"
  | "PLAYBACK_FAILED"
  | "LOAD_ERROR"
  | "PLAY_ERROR"
  | "EFFECT_INIT_FAILED"
  | "EFFECT_PROCESS_FAILED"
  | "UNKNOWN_ERROR";

/**
 * Current state of audio playback for a sound
 */
export type AudioState = {
  isPlaying: boolean;
  isLoading: boolean;
  /** True when recovering from buffer underrun (distinct from initial load) */
  isBuffering: boolean;
  volume: number;
  error: AudioError | null;
  hasEnded: boolean;
};

/**
 * Initial default audio state
 */
export const initialAudioState: AudioState = {
  error: null,
  hasEnded: false,
  isBuffering: false,
  isLoading: false,
  isPlaying: false,
  volume: 1,
};

/**
 * Stream source status
 */
export type StreamStatus =
  | "idle"
  | "connecting"
  | "buffering"
  | "streaming"
  | "ended"
  | "error";

/**
 * Payload for stream ready event
 */
export type StreamReadyPayload = {
  sourceId: string;
};

/**
 * Payload for source ended event
 */
export type SourceEndedPayload = {
  sourceId: string;
};

/**
 * Error codes specific to worklet/DSP errors
 */
type WorkletErrorCode =
  | "EFFECT_INIT_FAILED"
  | "EFFECT_PROCESS_FAILED"
  | "SOURCE_NOT_FOUND"
  | "UNKNOWN_ERROR";

/**
 * Payload for source error event
 */
export type SourceErrorPayload = {
  /** Unique error ID for tracking/correlation */
  id: string;
  sourceId: string;
  /** Human-readable error message */
  error: string;
  /** Error code for programmatic handling */
  code: WorkletErrorCode;
  /** Effect ID if error originated from a specific effect */
  effectId?: string;
  /** Timestamp when error occurred */
  timestamp: number;
};

/**
 * Callback for audio state changes
 */
export type AudioStateCallback = (state: AudioState) => void;

/**
 * Unsubscribe function returned by subscribe methods
 */
export type Unsubscribe = () => void;
