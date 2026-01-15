import type {
  AudioContext,
  BiquadFilterNode,
  ConvolverNode,
  GainNode,
  PannerNode,
} from "../context.js";
// AudioWorkletNode is a global Web Audio API type

// Type aliases for audio nodes - using return types from AudioContext methods
export type DelayNode = ReturnType<AudioContext["createDelay"]>;
export type WaveShaperNode = ReturnType<AudioContext["createWaveShaper"]>;
export type DynamicsCompressorNode = ReturnType<
  AudioContext["createDynamicsCompressor"]
>;

// Re-export types from context
export type {
  BiquadFilterNode,
  ConvolverNode,
  GainNode,
  PannerNode,
};

export type FilterType =
  | "lowpass"
  | "highpass"
  | "bandpass"
  | "lowshelf"
  | "highshelf"
  | "peaking"
  | "notch"
  | "allpass";

export type EffectType =
  | "plateReverb"
  | "standardReverb"
  | "phaseVocoder"
  | "delay"
  | "distortion"
  | "compressor"
  | "panner"
  | "crusher"
  | "fold"
  | "stereoTool"
  | "revamp"
  | "tidal";

export type EffectNode =
  | BiquadFilterNode
  | globalThis.AudioWorkletNode
  | DelayNode
  | WaveShaperNode
  | DynamicsCompressorNode
  | ConvolverNode
  | PannerNode;

export type BaseEffectConfig = {
  id: string;
  type: EffectType;
  enabled: boolean;
  order: number;
  dryWet: number; // 0.0 = fully dry, 1.0 = fully wet
  inputGain: number; // Linear gain: 0.0 = -∞dB, 1.0 = 0dB, ~4.0 = +12dB
  outputGain: number; // Linear gain: 0.0 = -∞dB, 1.0 = 0dB, ~4.0 = +12dB
};

export interface PlateReverbConfig extends BaseEffectConfig {
  type: "plateReverb";
  preDelay: number;
  bandwidth: number;
  inputDiffusion1: number;
  inputDiffusion2: number;
  decay: number;
  decayDiffusion1: number;
  decayDiffusion2: number;
  damping: number;
  excursionRate: number;
  excursionDepth: number;
}

export interface StandardReverbConfig extends BaseEffectConfig {
  type: "standardReverb";
  roomSize: number;
  decayTime: number;
}

export interface PhaseVocoderConfig extends BaseEffectConfig {
  type: "phaseVocoder";
  pitchFactor: number;
}

export interface DelayConfig extends BaseEffectConfig {
  type: "delay";
  delayTime: number;
  feedback: number;
}

export interface DistortionConfig extends BaseEffectConfig {
  type: "distortion";
  amount: number;
  oversample: "none" | "2x" | "4x";
}

export interface CompressorConfig extends BaseEffectConfig {
  type: "compressor";
  threshold: number;
  ratio: number;
  attack: number;
  release: number;
  knee: number;
}

export interface PannerConfig extends BaseEffectConfig {
  type: "panner";
  coneInnerAngle: number;
  coneOuterAngle: number;
  coneOuterGain: number;
  distanceModel: "linear" | "inverse" | "exponential";
  maxDistance: number;
  refDistance: number;
  rolloffFactor: number;
  panningModel: "equalpower" | "HRTF";
  positionX: number;
  positionY: number;
  positionZ: number;
  orientationX: number;
  orientationY: number;
  orientationZ: number;
}

export interface CrusherConfig extends BaseEffectConfig {
  type: "crusher";
  crush: number; // 0-1 (inverted in processor: setCrush(1.0 - value))
  bitDepth: number; // 1-16
  boost: number; // dB
}

export interface FoldConfig extends BaseEffectConfig {
  type: "fold";
  amount: number; // dB (converted to linear gain)
  volume: number; // dB (converted to linear gain)
  oversample: 2 | 4 | 8;
}

export interface StereoToolConfig extends BaseEffectConfig {
  type: "stereoTool";
  volume: number; // dB (converted to linear gain)
  panning: number; // -1 to 1
  stereo: number; // -1 to 1 (stereo width)
  invertL: boolean;
  invertR: boolean;
  swap: boolean;
}

export interface RevampConfig extends BaseEffectConfig {
  type: "revamp";
  // Highpass
  highPassEnabled: boolean;
  highPassFrequency: number;
  highPassQ: number;
  highPassOrder: number;
  // Low shelf
  lowShelfEnabled: boolean;
  lowShelfFrequency: number;
  lowShelfGain: number;
  // Low bell
  lowBellEnabled: boolean;
  lowBellFrequency: number;
  lowBellGain: number;
  lowBellQ: number;
  // Mid bell
  midBellEnabled: boolean;
  midBellFrequency: number;
  midBellGain: number;
  midBellQ: number;
  // High bell
  highBellEnabled: boolean;
  highBellFrequency: number;
  highBellGain: number;
  highBellQ: number;
  // High shelf
  highShelfEnabled: boolean;
  highShelfFrequency: number;
  highShelfGain: number;
  // Lowpass
  lowPassEnabled: boolean;
  lowPassFrequency: number;
  lowPassQ: number;
  lowPassOrder: number;
}

export interface TidalConfig extends BaseEffectConfig {
  type: "tidal";
  rate: number; // multiplier (1.0 = no change)
  depth: number; // 0-1
  slope: number; // 0-1
  symmetry: number; // 0-1
  offset: number; // degrees 0-360
  channelOffset: number; // degrees 0-360
}

export type EffectConfig =
  | PlateReverbConfig
  | StandardReverbConfig
  | PhaseVocoderConfig
  | DelayConfig
  | DistortionConfig
  | CompressorConfig
  | PannerConfig
  | CrusherConfig
  | FoldConfig
  | StereoToolConfig
  | RevampConfig
  | TidalConfig;

export type EffectInstance = {
  config: EffectConfig;
  node: EffectNode | null;
  inputGainNode?: GainNode;
  outputGainNode?: GainNode;
  wetGain?: GainNode;
  dryGain?: GainNode;
  feedbackGain?: GainNode; // For delay feedback loop
  mergeNode?: GainNode; // For dry/wet mixing
};
