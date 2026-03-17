/**
 * DSP Module
 *
 * openDAW-powered DSP processing for audio effects, analysis, and routing.
 */

// Analysis
export { FFTAnalyzer, PeakMeter, RMSMeter } from "./analysis/index.js";
// Effects
export {
  AVAILABLE_EFFECTS,
  type BaseEffectConfig,
  BiquadFilter,
  type BiquadFilterParams,
  type BiquadFilterType,
  Compressor,
  type CompressorConfig,
  type CrusherConfig,
  CrusherEffect,
  createDefaultEffectConfig,
  DattorroReverb,
  Delay,
  type DelayConfig,
  Distortion,
  type DistortionConfig,
  type EffectConfig,
  type EffectMetadata,
  type EffectProcessor,
  type EffectType,
  type FilterType,
  type FoldConfig,
  FoldEffect,
  getEffectMetadata,
  Limiter,
  type LimiterConfig,
  PhaseVocoder,
  VarispeedEffect,
  type PitchShifterConfig,
  type PlateReverbConfig,
  type RevampConfig,
  RevampEffect,
  type StereoToolConfig,
  StereoToolEffect,
  type TidalConfig,
  TidalEffect,
} from "./effects/index.js";
// Processor
export {
  DSPProcessor,
  MessageType,
  type MessageTypeValue,
} from "./processor.js";
// Routing
export {
  EffectChain,
  type EffectChainConfig,
  type EffectInstance,
} from "./routing/index.js";
