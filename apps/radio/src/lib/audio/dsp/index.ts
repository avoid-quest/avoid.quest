/**
 * DSP Module
 *
 * openDAW-powered DSP processing for audio effects and routing.
 */

// Effects
export {
  AVAILABLE_EFFECTS,
  type BaseEffectConfig,
  BiquadFilter,
  type CompressorConfig,
  type CrusherConfig,
  CrusherEffect,
  convertEffectConfigToEngine,
  convertEffectParamValue,
  convertPartialEffectConfigToEngine,
  createDefaultEffectConfig,
  DattorroReverb,
  Delay,
  type DelayConfig,
  Distortion,
  type DistortionConfig,
  EFFECT_DEFINITIONS,
  EFFECT_SCHEMAS,
  type EffectConfig,
  type EffectDefinition,
  type EffectMetadata,
  type EffectParamDef,
  type EffectProcessor,
  type EffectSchema,
  type EffectType,
  type EngineEffectConfig,
  type EngineEffectParamValue,
  type FilterType,
  type FoldConfig,
  FoldEffect,
  getEffectDefaultConfig,
  getEffectDefinition,
  getEffectMetadata,
  getEffectMidiParamDefs,
  getEffectParamDefs,
  getEffectSchema,
  getEffectSliderParamDefs,
  Limiter,
  type LimiterConfig,
  type ParamDef,
  PhaseVocoder,
  type PitchShifterConfig,
  type PlateReverbConfig,
  type RevampConfig,
  RevampEffect,
  type StereoToolConfig,
  StereoToolEffect,
  type TidalConfig,
  TidalEffect,
  UNIVERSAL_EFFECT_PARAM_DEFS,
  type VisualizationType,
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
