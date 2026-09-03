/**
 * Audio Module
 *
 * Self-contained audio system for radio streaming with DSP effects.
 *
 * Architecture:
 * - playback/: Thin playback infrastructure (context, transport, worklet)
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
export {
  canUseOfficialOpenDawRuntime,
  isOfficialOpenDawEffect,
  type OfficialOpenDawEffectType,
  OPENDAW_FACTORY_KEYS,
} from "./dsp/effects/official-opendaw-mapping.js";
// DSP effect defaults
export {
  AVAILABLE_EFFECTS,
  createDefaultEffectConfig,
  type EffectMetadata,
  getEffectMetadata,
  OPENDAW_AVAILABLE_EFFECTS,
  RADIO_AVAILABLE_EFFECTS,
} from "./dsp/effects/registry.js";
// DSP effect schema (declarative params)
export {
  convertEffectConfigToEngine,
  convertEffectParamValue,
  convertPartialEffectConfigToEngine,
  EFFECT_DEFINITIONS,
  EFFECT_PARAMETER_ROLE_MAP,
  EFFECT_SCHEMAS,
  type EffectDefinition,
  type EffectParamDef,
  type EffectParameterRole,
  type EffectSchema,
  type EngineEffectConfig,
  type EngineEffectParamValue,
  getEffectDefaultConfig,
  getEffectDefinition,
  getEffectMidiParamDefs,
  getEffectParamDefs,
  getEffectSchema,
  getEffectSliderParamDefs,
  type ParamDef,
  UNIVERSAL_EFFECT_PARAM_DEFS,
  UNIVERSAL_EFFECT_PARAMETER_ROLES,
  type VisualizationType,
} from "./dsp/effects/schema.js";
// DSP types (effect configs)
export type {
  AutotuneConfig,
  BaseEffectConfig,
  CheapReverbConfig,
  CompressorConfig,
  CrusherConfig,
  DelayConfig,
  DistortionConfig,
  EffectChainConfig,
  EffectConfig,
  EffectProcessor,
  EffectSidechainConfig,
  EffectType,
  FilterType,
  FoldConfig,
  FrequencySplitConfig,
  FxCompositeConfig,
  GateConfig,
  LimiterConfig,
  MaximizerConfig,
  NeuralAmpConfig,
  OpenDawEffectType,
  PitchShifterConfig,
  PlateReverbConfig,
  RadioEffectType,
  RevampConfig,
  StereoSplitConfig,
  StereoToolConfig,
  TempoDivision,
  TidalConfig,
  VocoderConfig,
  WaveshaperConfig,
  WaveshaperCurve,
  WerkstattConfig,
} from "./dsp/effects/types.js";
export {
  EFFECT_TYPES,
  isEffectType,
  OPENDAW_EFFECT_TYPES,
  RADIO_EFFECT_TYPES,
  TEMPO_DIVISIONS,
  WAVESHAPER_CURVES,
} from "./dsp/effects/types.js";
// DSP Processor types (for worklet communication)
export {
  type AnalysisData,
  MessageType,
  type MessageTypeValue,
} from "./dsp/processor.js";
// React hooks
export { useAudio, useAudioDevices } from "./hooks/index.js";
// High-level API (primary exports)
export {
  AUDIO_ENGINE_FACADE_PUBLIC_METHOD_BUDGET,
  type AudioEngineFacade,
  AudioManager,
  type CrossfadeCurve,
  type CrossfadeOptions,
  captureMobileAudioDiagnostic,
  countAudioEngineFacadeMethods,
  createAudioEngineFacade,
  crossfade,
  DEFAULT_OPENDAW_RUNTIME_URLS,
  duckSound,
  type EffectsGraphRuntime,
  type FilterConfig,
  fadeIn,
  fadeOut,
  OfficialOpenDawRuntime,
  type OpenDawRuntimeUrls,
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
  createMicSource,
  createPlaybackSource,
  createWorkletManager,
  type DeviceAudioConstraints,
  type DevicePermissionState,
  DeviceSource,
  type DeviceSourceCallbacks,
  defaultStreamBufferConfig,
  getAudioContext,
  getAudioContextManager,
  initialAudioState,
  MediaElementPlaybackSource,
  MicSource,
  type MicSourceCallbacks,
  type PlaybackSource,
  type PlaybackSourceCallbacks,
  type Radio,
  resumeAudioContext,
  suspendAudioContext,
  type Unsubscribe,
  WorkletManager,
} from "./playback/index.js";
