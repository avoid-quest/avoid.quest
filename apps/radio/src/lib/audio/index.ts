/**
 * Audio Module
 *
 * Self-contained audio system for radio streaming with DSP effects.
 *
 * Architecture:
 * - playback/: Thin playback infrastructure (context, streaming, worklet)
 * - dsp/: DSP processing (effects, analysis, routing)
 * - manager/: High-level API (AudioManager, crossfade)
 */

// DSP effect defaults
export {
  AVAILABLE_EFFECTS,
  createDefaultEffectConfig,
  type EffectMetadata,
  getEffectMetadata,
} from "./dsp/effects/registry.js";
// DSP types (effect configs)
export type {
  BaseEffectConfig,
  BiquadFilterConfig,
  CompressorConfig,
  CrusherConfig,
  DelayConfig,
  DistortionConfig,
  EffectConfig,
  EffectProcessor,
  EffectType,
  FilterType,
  FoldConfig,
  PhaseVocoderConfig,
  PlateReverbConfig,
  RevampConfig,
  StandardReverbConfig,
  StereoToolConfig,
  TidalConfig,
} from "./dsp/effects/types.js";
// High-level API (primary exports)
export {
  AudioManager,
  type CrossfadeCurve,
  type CrossfadeOptions,
  crossfade,
  duckSound,
  type FilterConfig,
  fadeIn,
  fadeOut,
  setWorkletProcessorUrl,
} from "./manager/index.js";
// Playback infrastructure
export {
  AudioContextManager,
  type AudioError,
  type AudioErrorCode,
  type AudioState,
  type AudioStateCallback,
  createStreamSource,
  createWorkletManager,
  defaultStreamBufferConfig,
  getAudioContext,
  getAudioContextManager,
  initialAudioState,
  type Radio,
  resumeAudioContext,
  StreamSource,
  type StreamSourceCallbacks,
  type StreamSourceEvents,
  suspendAudioContext,
  type Unsubscribe,
  WorkletManager,
} from "./playback/index.js";
