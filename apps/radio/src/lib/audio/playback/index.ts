/**
 * Playback Module
 *
 * Thin playback infrastructure for browser-backed remote media, device input,
 * and worklet lifecycle.
 */

// Audio Context
export {
  AudioContextManager,
  type AudioContextPerformanceSnapshot,
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
export { MediaElementPlaybackSource } from "./media-element-playback-source.js";
export { isMediaVolumeLocked } from "./media-element-volume-control.js";
// Microphone Source (for future live looper)
export {
  createMicSource,
  type MicPermissionState,
  MicSource,
  type MicSourceCallbacks,
} from "./mic-source.js";
export { toPlaybackInput } from "./playback-input.js";
export type {
  PlaybackInput,
  PlaybackSource,
  PlaybackSourceCallbacks,
} from "./playback-source.js";
export {
  assertSupportedRadioGraph,
  createPlaybackSource,
} from "./playback-source-factory.js";

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
