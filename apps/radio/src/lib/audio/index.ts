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
  type SingleAudioSettings,
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
