import type {
  BiquadFilterNode,
  ConvolverNode,
  DelayNode,
  DynamicsCompressorNode,
  GainNode,
  PannerNode,
  WaveShaperNode,
} from "../cacophony-types";
// AudioWorkletNode is a global Web Audio API type

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
  | "biquadFilter"
  | "plateReverb"
  | "standardReverb"
  | "phaseVocoder"
  | "delay"
  | "distortion"
  | "compressor"
  | "panner";

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

export interface BiquadFilterConfig extends BaseEffectConfig {
  type: "biquadFilter";
  filterType: FilterType;
  frequency: number;
  Q: number;
  gain: number;
}

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

export type EffectConfig =
  | BiquadFilterConfig
  | PlateReverbConfig
  | StandardReverbConfig
  | PhaseVocoderConfig
  | DelayConfig
  | DistortionConfig
  | CompressorConfig
  | PannerConfig;

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
