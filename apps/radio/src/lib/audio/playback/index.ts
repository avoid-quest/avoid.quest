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
// Device Source (audio input devices)
export {
  type AudioDeviceInfo,
  type ChannelSelection,
  createDeviceSource,
  type DeviceAudioConstraints,
  type DevicePermissionState,
  DeviceSource,
  type DeviceSourceCallbacks,
} from "./device-source.js";
// HTML5 Audio Source (primary - uses native <audio> element)
export {
  createHtml5AudioSource,
  Html5AudioSource,
  type Html5AudioSourceCallbacks,
} from "./html5-source.js";
// Microphone Source (for future live looper)
export {
  createMicSource,
  type MicPermissionState,
  MicSource,
  type MicSourceCallbacks,
} from "./mic-source.js";

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
  // Error tracking
  generateErrorId,
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
  type WorkletErrorCode,
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
