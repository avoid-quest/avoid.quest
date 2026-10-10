/**
 * DSP Effects Module
 *
 * Exports all effect processors and related types/utilities.
 */

// Effect Processors
export { BiquadFilter } from "./biquad-filter.js";
export { CrusherEffect } from "./crusher.js";
export {
  CTAGCompressor,
  type CTAGCompressorConfig,
  DEFAULT_CTAG_CONFIG,
} from "./ctag-compressor.js";
export { Delay } from "./delay.js";
export { Distortion } from "./distortion.js";
export { FoldEffect } from "./fold.js";
export { Limiter } from "./limiter.js";
export {
  canUseOfficialOpenDawRuntime,
  isOfficialOpenDawEffect,
  type OfficialOpenDawEffectType,
  OPENDAW_FACTORY_KEYS,
} from "./official-opendaw-mapping.js";
export { PhaseVocoder } from "./phase-vocoder.js";
// Registry
export {
  AVAILABLE_EFFECTS,
  createDefaultEffectConfig,
  type EffectMetadata,
  getEffectMetadata,
  OPENDAW_AVAILABLE_EFFECTS,
  RADIO_AVAILABLE_EFFECTS,
} from "./registry.js";
export { RevampEffect } from "./revamp.js";
export { DattorroReverb } from "./reverb.js";
export {
  convertEffectConfigToEngine,
  convertEffectParamValue,
  convertPartialEffectConfigToEngine,
  EFFECT_DEFINITIONS,
  EFFECT_SCHEMAS,
  type EffectDefinition,
  type EffectParamDef,
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
  type VisualizationType,
} from "./schema.js";
export { StereoToolEffect } from "./stereo-tool.js";
export { TidalEffect } from "./tidal.js";
// Types
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
  StereoChannels,
  StereoSplitConfig,
  StereoToolConfig,
  TempoDivision,
  TidalConfig,
  VocoderConfig,
  WaveshaperConfig,
  WaveshaperCurve,
  WerkstattConfig,
} from "./types.js";
export {
  EFFECT_TYPES,
  isEffectType,
  OPENDAW_EFFECT_TYPES,
  RADIO_EFFECT_TYPES,
  TEMPO_DIVISIONS,
  WAVESHAPER_CURVES,
} from "./types.js";
export {
  parseWerkstattDeclarations,
  reconcileWerkstattParameters,
  type WerkstattDeclarationSection,
  type WerkstattDeclarations,
  type WerkstattParamDeclaration,
  type WerkstattParamMapping,
} from "./werkstatt-declarations.js";
export {
  DEFAULT_WERKSTATT_SOURCE,
  WERKSTATT_PRESETS,
  type WerkstattPreset,
} from "./werkstatt-presets.js";
