/**
 * Playback Module
 *
 * Thin playback infrastructure for browser-backed remote media, device input,
 * and worklet lifecycle.
 */

// Audio Context
export {
  type AudioContextPerformanceSnapshot,
  getAudioContext,
  getAudioContextManager,
  resumeAudioContext,
} from "./audio-context.js";
// Device Source (audio input devices)
export {
  type AudioDeviceInfo,
  type ChannelSelection,
  createDeviceSource,
  type DeviceAudioConstraints,
  DeviceSource,
  type DeviceSourceCallbacks,
} from "./device-source.js";
export { toPlaybackInput } from "./playback-input.js";
export type {
  PlaybackSource,
  PlaybackSourceCallbacks,
} from "./playback-source.js";
export {
  assertSupportedRadioGraph,
  createPlaybackSource,
} from "./playback-source-factory.js";

// Types
export {
  // Audio state types
  type AudioError,
  type AudioErrorCode,
  type AudioState,
  type AudioStateCallback,
  // Error tracking
  generateErrorId,
  initialAudioState,
  // Radio type
  type Radio,
  type Unsubscribe,
} from "./types.js";
// Worklet Manager
export {
  type FilterType,
  WorkletManager,
  type WorkletManagerEvents,
} from "./worklet-manager.js";
