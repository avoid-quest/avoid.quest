import type { PlatformMetadata } from "@avoid.quest/radio-shared";

/**
 * Radio station/stream configuration
 */
export type Radio = {
  id?: number;
  name: string;
  streamUrl: string;
  logoUrl?: string;
  description?: string;
  websiteUrl?: string;
  order?: number;
  enabled?: boolean;
  platformMetadata?: PlatformMetadata;
};

/**
 * Error information for audio playback issues
 */
export type AudioError = {
  message: string;
  code: AudioErrorCode;
  radio?: Radio;
  timestamp: number;
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
  | "WORKLET_LOAD_FAILED"
  | "WORKLET_CREATION_FAILED"
  | "SOURCE_NOT_FOUND"
  | "PLAYBACK_FAILED"
  | "LOAD_ERROR"
  | "PLAY_ERROR"
  | "UNKNOWN_ERROR";

/**
 * Current state of audio playback for a sound
 */
export type AudioState = {
  isPlaying: boolean;
  isLoading: boolean;
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
 * Configuration for stream source creation
 */
export type StreamSourceConfig = {
  url: string;
  sourceId: string;
  signal?: AbortSignal;
};

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
};

/**
 * Default stream buffer configuration
 */
export const defaultStreamBufferConfig: StreamBufferConfig = {
  minBufferSize: 128 * 1024, // 128KB
  maxBufferSize: 512 * 1024, // 512KB
  retainOnError: 64 * 1024, // 64KB
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
  | "STREAM_UNDERRUN"
  | "PEAK_METER";

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
 * Payload for source error event
 */
export type SourceErrorPayload = {
  sourceId: string;
  error: string;
};

/**
 * Callback for audio state changes
 */
export type AudioStateCallback = (state: AudioState) => void;

/**
 * Unsubscribe function returned by subscribe methods
 */
export type Unsubscribe = () => void;
