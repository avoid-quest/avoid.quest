/**
 * DSP Effects Module
 *
 * Exports all effect processors and related types/utilities.
 */

// Effect Processors
export {
  BiquadFilter,
  type BiquadFilterParams,
  type BiquadFilterType,
} from "./biquad-filter.js";
export { Compressor } from "./compressor.js";
export { CrusherEffect } from "./crusher.js";
export {
  CTAGCompressor,
  type CTAGCompressorConfig,
  DEFAULT_CTAG_CONFIG,
} from "./ctag-compressor.js";
export { Delay } from "./delay.js";
export { Distortion } from "./distortion.js";
export { FoldEffect } from "./fold.js";
export { FreeVerbReverb } from "./freeverb.js";
export { Limiter } from "./limiter.js";
export { PhaseVocoder } from "./phase-vocoder.js";
// Registry
export {
  AVAILABLE_EFFECTS,
  createDefaultEffectConfig,
  type EffectMetadata,
  getEffectMetadata,
} from "./registry.js";
export { RevampEffect } from "./revamp.js";
export { DattorroReverb } from "./reverb.js";
export { StereoToolEffect } from "./stereo-tool.js";
export { TidalEffect } from "./tidal.js";
// Types
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
  StereoChannels,
  StereoToolConfig,
  TidalConfig,
} from "./types.js";
