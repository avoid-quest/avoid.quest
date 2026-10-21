/**
 * Audio Module
 *
 * Self-contained audio system for radio streaming with DSP effects.
 *
 * Architecture:
 * - playback/: Thin playback infrastructure (context, transport, worklet)
 * - dsp/: DSP processing (effects, routing)
 * - manager/: High-level API (AudioManager, crossfade)
 * - hooks/: React integration (useAudioDevices)
 */

// DSP effect defaults
export {
  AVAILABLE_EFFECTS,
  createDefaultEffectConfig,
  getEffectMetadata,
} from "./dsp/effects/registry.js";
// DSP types (effect configs)
export type {
  CompressorConfig,
  EffectChainConfig,
  EffectConfig,
  EffectType,
  FrequencySplitConfig,
  RevampConfig,
} from "./dsp/effects/types.js";
// React hooks
export { useAudioDevices } from "./hooks/index.js";
// High-level API (primary exports)
export {
  type AudioEngineFacade,
  AudioManager,
  captureMobileAudioDiagnostic,
  createAudioEngineFacade,
  type FilterConfig,
  fadeOut,
} from "./manager/index.js";
// Playback infrastructure
export {
  type AudioDeviceInfo,
  type AudioError,
  type AudioErrorCode,
  type AudioState,
  type ChannelSelection,
  type DeviceAudioConstraints,
  getAudioContext,
  type Radio,
  resumeAudioContext,
} from "./playback/index.js";
