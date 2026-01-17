/**
 * Audio Module
 *
 * Self-contained audio system for radio streaming with DSP effects.
 *
 * Architecture:
 * - playback/: Thin playback infrastructure (context, streaming, worklet)
 * - dsp/: DSP processing (effects, analysis, routing)
 * - manager/: High-level API (AudioManager, crossfade)
 * - hooks/: React integration (useAudio, useSingleAudio, useDjAudio)
 */

// DSP Analysis
export {
  FFTAnalyzer,
  LevelMeter,
  PeakMeter,
  RMSMeter,
  SpectrumAnalyzer,
  type StereoLevels,
} from "./dsp/analysis/index.js";
// DSP effect defaults
export {
  AVAILABLE_EFFECTS,
  createDefaultEffectConfig,
  type EffectMetadata,
  getEffectMetadata,
} from "./dsp/effects/registry.js";
// DSP effect schema (declarative params)
export {
  EFFECT_SCHEMAS,
  type EffectSchema,
  getEffectSchema,
  type ParamDef,
  type VisualizationType,
} from "./dsp/effects/schema.js";
// DSP types (effect configs)
export type {
  BaseEffectConfig,
  CompressorConfig,
  CrusherConfig,
  DelayConfig,
  DistortionConfig,
  EffectConfig,
  EffectProcessor,
  EffectType,
  FilterType,
  FoldConfig,
  LimiterConfig,
  PitchShifterConfig,
  PlateReverbConfig,
  RevampConfig,
  StereoToolConfig,
  TidalConfig,
} from "./dsp/effects/types.js";
export { EFFECT_TYPES, isEffectType } from "./dsp/effects/types.js";
// DSP Processor types (for worklet communication)
export {
  type AnalysisData,
  MessageType,
  type MessageTypeValue,
} from "./dsp/processor.js";
// React hooks
export {
  type MultipleAudioSettings,
  type MultipleAudioState,
  useAudio,
  useDjAudio,
  useMultipleAudio,
  useSingleAudio,
} from "./hooks/index.js";
// HTML5 Audio (non-DJ modes)
export {
  type CrossfadeConfig,
  CrossfadeController,
  getCrossfadeContext,
  type HTML5AudioError,
  HTML5AudioManager,
  HTML5AudioPlayer,
  type HTML5AudioState,
  type HTML5AudioStateCallback,
  initialHTML5AudioState,
  resumeCrossfadeContext,
} from "./html5/index.js";
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
  createHtml5AudioSource,
  createMicSource,
  createWorkletManager,
  defaultStreamBufferConfig,
  getAudioContext,
  getAudioContextManager,
  Html5AudioSource,
  type Html5AudioSourceCallbacks,
  initialAudioState,
  MicSource,
  type MicSourceCallbacks,
  type Radio,
  resumeAudioContext,
  suspendAudioContext,
  type Unsubscribe,
  WorkletManager,
} from "./playback/index.js";
