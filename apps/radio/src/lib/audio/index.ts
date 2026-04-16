/**
 * Audio Module
 *
 * Self-contained audio system for radio streaming with DSP effects.
 *
 * Architecture:
 * - playback/: Thin playback infrastructure (context, streaming, worklet)
 * - dsp/: DSP processing (effects, analysis, routing)
 * - manager/: High-level API (AudioManager, crossfade)
 * - hooks/: React integration (useAudio, useAudioDevices)
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
export type { MultipleAudioState } from "./hooks/index.js";
// React hooks
export {
  useAudio,
  useAudioDevices,
  useMultipleAudio,
  useSingleAudio,
} from "./hooks/index.js";
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
  type AudioDeviceInfo,
  type AudioError,
  type AudioErrorCode,
  type AudioState,
  type AudioStateCallback,
  type ChannelSelection,
  createDeviceSource,
  createHtml5AudioSource,
  createMicSource,
  createWorkletManager,
  type DeviceAudioConstraints,
  type DevicePermissionState,
  DeviceSource,
  type DeviceSourceCallbacks,
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
// Routing (output device selection, CUE monitoring, delays)
export {
  CueBus,
  type CueBusCallbacks,
  type CueBusState,
  type CueMode,
  createCueBus,
  createOutputRouter,
  isSinkIdSupported,
  OutputRouter,
  type OutputRouterCallbacks,
  type OutputRouterState,
  safeDisconnectFrom,
} from "./routing/index.js";
