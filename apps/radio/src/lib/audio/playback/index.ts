/**
 * Playback Module
 *
 * Thin playback infrastructure for streaming audio from Icecast endpoints.
 * Provides audio context management, stream handling, and worklet lifecycle.
 */

// Audio Context
export {
  AudioContextManager,
  type ContextStateCallback,
  getAudioContext,
  getAudioContextManager,
  resumeAudioContext,
  suspendAudioContext,
} from "./audio-context.js";

// Stream Source
export {
  createStreamSource,
  StreamSource,
  type StreamSourceCallbacks,
  type StreamSourceEvents,
} from "./stream-source.js";
// Types
export {
  // Worklet message types
  type AddStreamChunkPayload,
  // Audio state types
  type AudioError,
  type AudioErrorCode,
  type AudioState,
  type AudioStateCallback,
  // Stream types
  defaultStreamBufferConfig,
  initialAudioState,
  // Radio type
  type Radio,
  type SourceEndedPayload,
  type SourceErrorPayload,
  type StartSourcePayload,
  type StreamBufferConfig,
  type StreamReadyPayload,
  type StreamSourceConfig,
  type StreamStatus,
  type Unsubscribe,
  type WorkletEvent,
  type WorkletEventType,
  type WorkletMessage,
  type WorkletMessageType,
} from "./types.js";
// Worklet Manager
export {
  createWorkletManager,
  type EffectType,
  type FilterType,
  WorkletManager,
  type WorkletManagerEvents,
} from "./worklet-manager.js";
