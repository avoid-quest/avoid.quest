import type { RadioMetadataConfig } from "@/lib/metadata/types";
import type { PlatformMetadata } from "@/lib/platform-types";
import type { StreamFormat } from "./stream-format.js";

/**
 * Radio station/stream configuration
 */
export type Radio = {
  id?: string | number;
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
  isPlaying: false,
  isLoading: false,
  isBuffering: false,
  volume: 1,
  error: null,
  hasEnded: false,
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
 * Stream buffer configuration
 */
export type StreamBufferConfig = {
  /** Minimum bytes before attempting decode (default: 128KB) */
  minBufferSize: number;
  /** Maximum buffer size before forcing clear (default: 512KB) */
  maxBufferSize: number;
  /** Bytes to retain on decode error (default: 64KB) */
  retainOnError: number;
  /** Minimum decoded chunks before playback starts (default: 4 = ~800ms) */
  minPreBufferChunks: number;
  /** Low watermark - trigger buffering state when chunks drop below this (default: 2) */
  lowWatermarkChunks: number;
  /** High watermark - exit buffering state when chunks reach this (default: 4) */
  highWatermarkChunks: number;
};

/**
 * Default stream buffer configuration
 *
 * Lower values = more frequent, smaller decodes = smoother streaming
 * Higher values = fewer decodes but risk of playback gaps
 *
 * Note: With SharedArrayBuffer mode, watermarks are handled in samples by the
 * processor. These chunk-based values are for legacy mode and initial buffering.
 */
export const defaultStreamBufferConfig: StreamBufferConfig = {
  minBufferSize: 48 * 1024, // 48KB (~3 sec at 128kbps) - balanced startup vs codec alignment
  maxBufferSize: 512 * 1024, // 512KB - fewer partial decodes
  retainOnError: 64 * 1024, // 64KB - less data loss on failure
  minPreBufferChunks: 4, // 4 chunks = ~800ms of audio before playback
  lowWatermarkChunks: 2, // Enter buffering state when below 2 chunks (~400ms)
  highWatermarkChunks: 4, // Exit buffering state when reaching 4 chunks (~800ms)
};

/**
 * Worklet processor message types (main thread → worklet)
 */
export type WorkletMessageType =
  | "CREATE_SOURCE"
  | "START_SOURCE"
  | "STOP_SOURCE"
  | "PAUSE_SOURCE"
  | "RESUME_SOURCE"
  | "SEEK_SOURCE"
  | "SET_SOURCE_VOLUME"
  | "SET_SOURCE_PAN"
  | "ADD_STREAM_CHUNK"
  | "ADD_EFFECT"
  | "REMOVE_EFFECT"
  | "UPDATE_EFFECT"
  | "REORDER_EFFECTS";

/**
 * Worklet event types (worklet → main thread)
 */
export type WorkletEventType =
  | "SOURCE_ENDED"
  | "SOURCE_ERROR"
  | "STREAM_READY"
  | "STREAM_UNDERRUN";

/**
 * Generic message structure for worklet communication
 */
export type WorkletMessage<T = unknown> = {
  type: WorkletMessageType;
  payload: T;
};

/**
 * Generic event structure from worklet
 */
export type WorkletEvent<T = unknown> = {
  type: WorkletEventType;
  payload: T;
};

/**
 * Payload for starting a source
 */
export type StartSourcePayload = {
  sourceId: string;
  when?: number;
  offset?: number;
  duration?: number;
};

/**
 * Payload for adding a stream chunk
 */
export type AddStreamChunkPayload = {
  sourceId: string;
  chunk: Float32Array[];
};

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
export type WorkletErrorCode =
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
